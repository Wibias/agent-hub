#!/usr/bin/env node
// Real Chrome/Playwright smoke for a locally served, lazy-loading reference page.
// No remote site, no credentials, no product CI claims.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkReferenceCapture } from '../scripts/reference-capture-check.mjs';

const playwrightRoot = process.env.DWA_PLAYWRIGHT_ROOT;
const chromePath = process.env.CHROME_PATH;
assert.ok(playwrightRoot && existsSync(path.join(playwrightRoot, 'index.mjs')),
  'DWA_PLAYWRIGHT_ROOT must be the pinned playwright-core install');
assert.ok(chromePath && existsSync(chromePath), 'CHROME_PATH must name installed Chrome');

const { chromium } = await import(pathToFileURL(path.join(playwrightRoot, 'index.mjs')).href);
const html = [
  '<!doctype html><html><head><meta charset="utf-8"><style>',
  'body { margin:0; font:24px system-ui; }',
  'header { position:sticky; top:0; height:48px; background:navy; color:white; z-index:5; }',
  'section { min-height:550px; border-bottom:3px solid #aaa; padding:20px; box-sizing:border-box; }',
  '</style></head><body>',
  '<header>Navigation</header>',
  '<section id="top">A first-screen reference section</section>',
  '<section id="second">A following section with a real viewport state</section>',
  '<section id="third"><span id="lazy">Waiting for scrolling</span></section>',
  '<section id="footer">Final section / reference footer</section>',
  '<script>',
  "addEventListener('scroll', () => {",
  "  if (scrollY > 650) document.getElementById('lazy').textContent = 'LAZY_MEDIA_READY';",
  "}, { passive: true });",
  '</script></body></html>',
].join('');
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
});
const out = mkdtempSync(path.join(tmpdir(), 'dwa-capture-browser-'));
let browser;
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  browser = await chromium.launch({ executablePath: chromePath, headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1 });
  const page = await context.newPage();
  const sourceUrl = 'http://127.0.0.1:' + server.address().port + '/reference';
  const response = await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  assert.equal(response.status(), 200);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction(() => document.querySelector('#lazy')?.textContent ===
    'LAZY_MEDIA_READY', null, { timeout: 5000 });
  await page.evaluate(() => scrollTo(0, 0));
  const documentHeight = await page.evaluate(() => Math.max(
    document.documentElement.scrollHeight, document.body.scrollHeight,
  ));
  const manifest = {
    schemaVersion: 1,
    sourceUrl,
    capturedAt: new Date().toISOString(),
    viewport: { width: 800, height: 600 },
    documentHeight,
    segments: [],
  };
  for (let requestY = 0, iteration = 0; iteration < 30; iteration++) {
    await page.evaluate(y => scrollTo(0, y), requestY);
    const actualTop = await page.evaluate(() => scrollY);
    if (manifest.segments.length &&
        actualTop === manifest.segments[manifest.segments.length - 1].top) break;
    await page.waitForTimeout(60);
    const file = 'segment-' + String(iteration + 1).padStart(2, '0') + '.png';
    await page.screenshot({ path: path.join(out, file), fullPage: false });
    manifest.segments.push({
      file, top: actualTop, bottom: Math.min(documentHeight, actualTop + 600),
      settled: true,
    });
    if (actualTop + 600 >= documentHeight) break;
    requestY = Math.min(documentHeight - 600, actualTop + 450);
  }
  assert.ok(manifest.segments.length >= 4);
  assert.equal(manifest.segments.at(-1).bottom, documentHeight);
  assert.equal(await page.locator('#lazy').textContent(), 'LAZY_MEDIA_READY');
  assert.equal(await page.locator('#footer').count(), 1);
  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest));
  const result = checkReferenceCapture(manifest, out);
  assert.equal(result.status, 'GEOMETRY_CHECKED', JSON.stringify(result));
  assert.equal(result.composite, 'NOT_PROVIDED');
  const incomplete = { ...manifest, segments: manifest.segments.slice(0, -1) };
  assert.equal(checkReferenceCapture(incomplete, out).status, 'BLOCKED');
  process.stdout.write(JSON.stringify({ status: 'PASS', source: 'loopback-live-browser',
    segments: manifest.segments.length, lazyDomObserved: true,
    manifestStatus: result.status, visualContentAttested: false }) + '\n');
  // Optional, one-off public-reference exercise; never stores images in Git.
  // This is browser/geometry verification, not a visual-craft or rights verdict.
  if (process.env.DWA_PUBLIC_REFERENCE_URL) {
    const externalUrl = process.env.DWA_PUBLIC_REFERENCE_URL;
    if (!externalUrl.startsWith('https://design-system.service.gov.uk/')) {
      throw new Error('Unexpected external reference origin');
    }
    const res = await page.goto(externalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert.equal(res.status(), 200, 'External reference must respond successfully');
    await page.locator('h1').first().waitFor({ state: 'visible', timeout: 10000 });
    const heading = await page.locator('h1').first().innerText();
    assert.match(heading, /Accordion|Components/i, 'Expected real design system documentation');
    await page.evaluate(() => document.fonts.ready);
    let firstHeight = await page.evaluate(() => Math.max(
      document.documentElement.scrollHeight, document.body.scrollHeight,
    ));
    for (let y = 0; y < firstHeight; y += 540) {
      await page.evaluate(pos => scrollTo(0, pos), y);
      await page.waitForTimeout(120);
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(350);
    const fullHeight = await page.evaluate(() => Math.max(
      document.documentElement.scrollHeight, document.body.scrollHeight,
    ));
    assert.ok(fullHeight > 1800 && fullHeight <= 30000,
      'External reference height must be in bounded long-page range');
    const manifestExternal = {
      schemaVersion: 1,
      sourceUrl: externalUrl,
      capturedAt: new Date().toISOString(),
      viewport: { width: 800, height: 600 },
      documentHeight: fullHeight,
      segments: [],
    };
    for (let y = 0, index = 0; index < 100; index++) {
      await page.evaluate(pos => scrollTo(0, pos), y);
      const top = await page.evaluate(() => scrollY);
      if (manifestExternal.segments.at(-1)?.top === top) break;
      await page.waitForTimeout(200);
      const file = 'public-reference-' + String(index).padStart(2, '0') + '.png';
      await page.screenshot({ path: path.join(out, file), fullPage: false });
      manifestExternal.segments.push({
        file, top, bottom: Math.min(fullHeight, top + 600), settled: true,
      });
      if (top + 600 >= fullHeight) break;
      y = Math.min(fullHeight - 600, top + 500);
    }
    const checked = checkReferenceCapture(manifestExternal, out);
    assert.equal(checked.status, 'GEOMETRY_CHECKED', JSON.stringify(checked));
    assert.ok(manifestExternal.segments.length >= 4);
    process.stdout.write(JSON.stringify({
      status: 'PASS', source: 'external-public-design-reference',
      url: externalUrl, heading, frames: manifestExternal.segments.length,
      coverage: checked.status, visualContentAttested: false,
    }) + '\\n');
  }
  await context.close();
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  rmSync(out, { recursive: true, force: true });
}
