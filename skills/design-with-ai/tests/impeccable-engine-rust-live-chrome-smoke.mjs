#!/usr/bin/env node
// Real Chrome smoke of upstream Rust-served Live assets, deliberately separate
// from the AgentHub-owned JS helper and its canonical DWA command overlay.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const engine = process.env.IMPECCABLE_TEST_ENGINE_PATH;
const playwrightRoot = process.env.DWA_PLAYWRIGHT_ROOT;
const chrome = process.env.CHROME_PATH;
assert.ok(engine && existsSync(engine), 'Verified native Rust engine path is required');
assert.ok(playwrightRoot && existsSync(path.join(playwrightRoot, 'index.mjs')), 'Pinned Playwright transport is required');
assert.ok(chrome && existsSync(chrome), 'Installed Chrome executable is required');
const { chromium } = await import(pathToFileURL(path.join(playwrightRoot, 'index.mjs')).href);

async function infoFrom(file, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Rust Live exited before startup');
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (Number.isInteger(data.port) && typeof data.token === 'string' && data.token.length >= 8) {
        return data;
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error('Rust Live startup metadata was not created in time');
}

const root = mkdtempSync(path.join(tmpdir(), 'dwa-rust-live-browser-'));
mkdirSync(path.join(root, '.impeccable', 'live'), { recursive: true });
mkdirSync(path.join(root, 'prototype'), { recursive: true });
writeFileSync(path.join(root, 'prototype', 'index.html'), '<html><body><button id="fixture">Product state preserved</button></body></html>');
writeFileSync(path.join(root, '.impeccable', 'live', 'config.json'), JSON.stringify({
  files: ['prototype/*.html'], insertBefore: '</body>', commentSyntax: 'html',
}));
const helper = spawn(engine, ['live-server', '--port=0'], {
  cwd: root,
  env: {
    ...process.env,
    IMPECCABLE_LIVE_COPY_AGENT: 'off',
    IMPECCABLE_HOME: path.join(root, 'isolated-engine-home'),
    IMPECCABLE_PROVIDER_ID: 'source',
  },
  stdio: ['ignore', 'ignore', 'ignore'],
});
helper.on('error', () => {});
let browser;
try {
  const { port, token } = await infoFrom(path.join(root, '.impeccable', 'live', 'server.json'), helper);
  const origin = 'http://127.0.0.1:' + port;
  browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 300)));
  await page.goto(origin + '/health');
  await page.setContent('<!DOCTYPE html><html><body><button id="fixture">Product state preserved</button></body></html>');
  const asset = origin + '/live.js?token=' + encodeURIComponent(token);
  const response = await page.request.get(asset);
  assert.equal(response.status(), 200, 'Rust Live must serve its token-authenticated browser asset');
  await page.addScriptTag({ url: asset });
  await page.waitForFunction(() =>
    window.__IMPECCABLE_LIVE_INIT__ === true &&
    !!document.getElementById('impeccable-live-global-bar'), null, { timeout: 14000 });
  assert.equal(await page.locator('#fixture').count(), 1, 'Rust Live must preserve the product UI');
  assert.deepEqual(errors, [], 'Rust-served browser script emitted an uncaught page error');
  const { initialized, bar, commandPrefix, leakedToken } = await page.evaluate(() => ({
    initialized: window.__IMPECCABLE_LIVE_INIT__ === true,
    bar: !!document.getElementById('impeccable-live-global-bar'),
    commandPrefix: window.__IMPECCABLE_COMMAND_PREFIX__,
    leakedToken: Object.prototype.hasOwnProperty.call(window, '__IMPECCABLE_TOKEN__'),
  }));
  assert.equal(initialized, true);
  assert.equal(bar, true);
  assert.equal(leakedToken, false, 'Rust Live must not retain an exposed bootstrap token');
  assert.ok(commandPrefix === '/' || commandPrefix === '$', 'Unexpected upstream command prefix');
  // Verify a user-visible instruction, not just a script bootstrap prefix.
  await page.locator('#impeccable-live-design-toggle').click();
  await page.waitForFunction(() => {
    const host = document.getElementById('impeccable-live-design-host');
    const instruction = host?.shadowRoot?.querySelector('#panel-body .empty code');
    return !!instruction && !!instruction.textContent?.includes(' document');
  }, null, { timeout: 12000 });
  const shownCommand = await page.evaluate(() => {
    const host = document.getElementById('impeccable-live-design-host');
    return host?.shadowRoot?.querySelector('#panel-body .empty code')?.textContent?.trim() || '';
  });
  assert.equal(shownCommand, commandPrefix + 'impeccable document',
    'Rendered Rust Live instruction must match the upstream prefix');
  assert.notEqual(shownCommand, '$design-with-ai impeccable document',
    'Native Rust Live command is not canonical DWA and remains gated');
  console.log('LIMITATION: Native Rust Live panel shows ' + JSON.stringify(shownCommand)
    + ', not the canonical DWA command.');
  await context.close();
  const stop = await fetch(origin + '/stop?token=' + encodeURIComponent(token), {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(stop.ok, true);
  console.log('PASS: native Rust Live script initialized inside real isolated Chrome and preserved product DOM.');
} finally {
  if (browser) await browser.close().catch(() => {});
  if (helper.exitCode === null && helper.signalCode === null) {
    helper.kill();
    await Promise.race([
      once(helper, 'exit').catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
  rmSync(root, { recursive: true, force: true });
}
