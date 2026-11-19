#!/usr/bin/env node
// Real Chrome smoke for the reusable offline design-playground starter.
// Tests the template only, not an actual product design or user approval.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const template = path.resolve(here, '../templates/design-playground.html');
const playwrightRoot = process.env.DWA_PLAYWRIGHT_ROOT;
const chromePath = process.env.CHROME_PATH;
assert.ok(existsSync(template), 'The versioned playground starter must exist');
assert.ok(playwrightRoot && existsSync(path.join(playwrightRoot, 'index.mjs')),
  'DWA_PLAYWRIGHT_ROOT must name the pinned playwright-core install');
assert.ok(chromePath && existsSync(chromePath),
  'CHROME_PATH must name a runnable Chrome/Chromium browser');

const { chromium } = await import(pathToFileURL(path.join(playwrightRoot, 'index.mjs')).href);
const temp = mkdtempSync(path.join(tmpdir(), 'agenthub-playground-browser-'));
let browser;
try {
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const pageErrors = [];
  const networkRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (/^https?:/i.test(request.url())) networkRequests.push(request.url());
  });
  await page.goto(pathToFileURL(template).href, { waitUntil: 'load' });
  assert.match(await page.title(), /Illustrative Starter/);
  assert.equal(await page.locator('#spacing-value').innerText(), '20px');
  assert.equal(await page.locator('#preview-card').evaluate(el => getComputedStyle(el).paddingTop), '20px');
  assert.match(await page.locator('#change-request').inputValue(), /No changes selected/);

  await page.locator('#spacing').evaluate(el => {
    el.value = '30';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.locator('#spacing-value').innerText(), '30px');
  assert.equal(await page.locator('#preview-card').evaluate(el => getComputedStyle(el).paddingTop), '30px');
  assert.match(await page.locator('#change-request').inputValue(), /card spacing 30px/);
  assert.doesNotMatch(await page.locator('#change-request').inputValue(), /corner radius 12px/);

  await page.locator('#radius').evaluate(el => {
    el.value = '8';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.locator('#preview-card').evaluate(el => getComputedStyle(el).borderTopLeftRadius), '8px');
  await page.locator('#font-size').evaluate(el => {
    el.value = '18';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.locator('#preview-card').evaluate(el => getComputedStyle(el).fontSize), '18px');
  await page.locator('#accent').selectOption('#0f766e');
  assert.equal(await page.locator('#preview-card').evaluate(el => getComputedStyle(el).getPropertyValue('--demo-accent').trim()), '#0f766e');
  assert.match(await page.locator('#change-request').inputValue(), /demo accent color #0f766e/);

  await page.locator('[data-preset="compact"]').click();
  assert.equal(await page.locator('#spacing').inputValue(), '12');
  assert.equal(await page.locator('[data-preset="compact"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#reset').click();
  assert.equal(await page.locator('#spacing').inputValue(), '20');
  assert.equal(await page.locator('#radius').inputValue(), '12');
  assert.equal(await page.locator('#font-size').inputValue(), '16');
  assert.equal(await page.locator('#accent').inputValue(), '#2563eb');
  assert.equal(await page.locator('[data-preset="balanced"]').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#change-request').inputValue(), /No changes selected/);

  const details = page.locator('#details');
  assert.equal(await details.getAttribute('aria-expanded'), 'false');
  await details.click();
  assert.equal(await details.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#more').isVisible(), true);
  await details.click();
  assert.equal(await page.locator('#more').isVisible(), false);

  // Exercise both clipboard success and honest fallback without requiring OS clipboard access.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async text => { window.__copied = text; } },
  }));
  await page.locator('#copy').click();
  assert.equal(await page.locator('#copy-status').innerText(), 'Change request copied.');
  assert.equal(await page.evaluate(() => window.__copied), await page.locator('#change-request').inputValue());
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => { throw new Error('blocked'); } },
  }));
  await page.locator('#copy').click();
  assert.match(await page.locator('#copy-status').innerText(), /Copy the selected text manually/);

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, 'Mobile layout must not overflow viewport');
  const screenshot = path.join(temp, 'starter-mobile.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  assert.ok(statSync(screenshot).size > 1000, 'Actual Chrome viewport must render as PNG');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(networkRequests, []);
  console.log(JSON.stringify({
    status: 'PASS', surface: 'standalone-offline-playground',
    controls: ['spacing', 'radius', 'font-size', 'accent'],
    presets: 3, clipboardFallback: true, mobileWidth: 390,
    pngRendered: true, productVisualAcceptance: false,
  }));
} finally {
  await browser?.close();
  rmSync(temp, { recursive: true, force: true });
}
