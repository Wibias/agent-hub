#!/usr/bin/env node
// Real isolated Chrome smoke for the optional internal Impeccable Live overlay.
// This proves script initialization and visible overlay, not variant acceptance.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(root, 'internal/impeccable/scripts/live-server.mjs');
const playwrightRoot = process.env.DWA_PLAYWRIGHT_ROOT;
const chrome = process.env.CHROME_PATH;
assert.ok(playwrightRoot && existsSync(path.join(playwrightRoot, 'index.mjs')));
assert.ok(chrome && existsSync(chrome));
const { chromium } = await import(pathToFileURL(path.join(playwrightRoot, 'index.mjs')).href);

function ready(child) {
  return new Promise((resolve, reject) => {
    let output = '', errors = '', finished = false;
    const timer = setTimeout(() => end(new Error('Live helper startup timed out')), 12000);
    const end = (err, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (err) reject(new Error(err.message + ': ' + errors.slice(-500)));
      else resolve(value);
    };
    child.stderr.on('data', chunk => { errors += chunk.toString(); });
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const p = output.match(/Impeccable live server running on http:\/\/localhost:(\d+)/);
      const t = output.match(/Token: ([0-9a-f-]{36})/i);
      if (p && t) end(null, { port: Number(p[1]), token: t[1] });
    });
    child.once('error', err => end(err));
    child.once('exit', code => end(new Error('Live helper exited before ready: ' + code)));
  });
}

const project = mkdtempSync(path.join(tmpdir(), 'dwa-live-chrome-'));
writeFileSync(path.join(project, 'index.html'), '<main><button id="fixture">Local fixture</button></main>');
const helper = spawn(process.execPath, [serverScript], {
  cwd: project, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
  windowsHide: true,
});
let browser;
try {
  const { port, token } = await ready(helper);
  browser = await chromium.launch({
    executablePath: chrome, headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('data:text/html,' + encodeURIComponent('<!DOCTYPE html><html><body><main><button id="fixture">Local fixture</button></main></body></html>'));
  const scriptUrl = 'http://127.0.0.1:' + port + '/live.js?token=' + encodeURIComponent(token);
  await page.addScriptTag({ url: scriptUrl });
  await page.waitForFunction(() =>
    window.__IMPECCABLE_LIVE_INIT__ === true &&
    !!document.getElementById('impeccable-live-global-bar'), { timeout: 12000 });
  assert.equal(await page.locator('#fixture').count(), 1, 'must preserve product content');
  assert.equal(errors.length, 0, 'browser script must not raise page exceptions: ' + errors.join('; '));
  const state = await page.evaluate(() => ({
    initialized: window.__IMPECCABLE_LIVE_INIT__,
    overlay: !!document.getElementById('impeccable-live-global-bar'),
    tokenExposed: Object.prototype.hasOwnProperty.call(window, '__IMPECCABLE_TOKEN__'),
  }));
  assert.equal(state.initialized, true);
  assert.equal(state.overlay, true);
  assert.equal(state.tokenExposed, false, 'script must clear token-bearing bootstrap global');
  await context.close();
  console.log('PASS: internal Live overlay initialized in real isolated Chrome; product DOM preserved.');
} finally {
  if (browser) await browser.close().catch(() => {});
  if (helper.exitCode === null) helper.kill('SIGTERM');
  if (helper.exitCode === null) await Promise.race([
    once(helper, 'exit').catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 1500)),
  ]);
  rmSync(project, { recursive: true, force: true });
}
