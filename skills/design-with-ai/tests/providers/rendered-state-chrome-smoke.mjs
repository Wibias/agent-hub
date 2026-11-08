#!/usr/bin/env node
// Real Chrome/CDP regression harness for the optional runtime state probe.
// Uses Node's built-in WebSocket and a local HTTP fixture. No npm install.
// The test-only CDP adapter implements the probe's narrow Playwright interface.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { probeRenderedState } from '../../scripts/providers/rendered-state-probe.mjs';

const widths = [1440, 768, 390];
const marker = '<div data-game-phase="live">Playing now</div>';
const page = (html) => '<!doctype html><html><head><meta charset="utf-8"></head><body>' + html + '</body></html>';

const cases = {
  '/ready': page('<div style="opacity:0"><div data-game-phase="live">Hidden first</div><p>Ghost content</p></div>' +
    marker + '<div style="margin-top:1400px">Loading below fold</div>'),
  '/hidden': page('<div style="opacity:0">' + marker + '</div>'),
  '/below': page(marker + '<div style="margin-top:1400px">Below requirement</div>'),
  '/blocked': page(marker + '<div data-access-blocker>Checking access</div>'),
  '/forbidden': page(marker + '<p>Access denied</p>'),
};

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.eventWaits = new Set();
    const rejectOutstanding = (reason) => {
      for (const call of this.pending.values()) {
        clearTimeout(call.timeout);
        call.reject(new Error(reason));
      }
      this.pending.clear();
      for (const cancel of [...this.eventWaits]) cancel(new Error(reason));
    };
    socket.addEventListener('close', () =>
      rejectOutstanding('Chrome CDP WebSocket closed'));
    socket.addEventListener('error', () =>
      rejectOutstanding('Chrome CDP WebSocket error'));
    socket.addEventListener('message', ({ data }) => {
      const m = JSON.parse(String(data));
      if (m.id) {
        const call = this.pending.get(m.id);
        if (!call) return;
        this.pending.delete(m.id);
        clearTimeout(call.timeout);
        if (m.error) call.reject(new Error(m.error.message));
        else call.resolve(m.result ?? {});
      } else for (const listener of this.listeners) listener(m);
    });
  }
  send(method, params = {}, sessionId = null) {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('Chrome CDP disconnected');
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20_000);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  on(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  once(method, sessionId) {
    let off;
    let timeout;
    return new Promise((resolve, reject) => {
      const cancel = (error) => {
        clearTimeout(timeout);
        off();
        this.eventWaits.delete(cancel);
        reject(error);
      };
      off = this.on((m) => {
        if (m.method !== method || m.sessionId !== sessionId) return;
        clearTimeout(timeout);
        off();
        this.eventWaits.delete(cancel);
        resolve(m.params);
      });
      this.eventWaits.add(cancel);
      timeout = setTimeout(() =>
        cancel(new Error('CDP event timeout: ' + method)), 20_000);
    });
  }
  close() { this.socket.close(); }
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome CDP WebSocket timeout')), 10_000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Chrome CDP WebSocket error')); }, { once: true });
  });
  return new Cdp(socket);
}

// A failed spawn does not have a PID and may never emit 'exit'. Close
// cleanup on actual child processes also needs a finite deadline.
async function stopChromeChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill('SIGKILL'); } catch { /* Process may already be gone. */ }
  await Promise.race([
    new Promise((resolve) => child.once('close', resolve)),
    sleep(2_000),
  ]);
}

async function startChrome(executable, root) {
  const profile = join(root, 'chrome-profile');
  mkdirSync(profile);
  const child = spawn(executable, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--no-proxy-server', '--disable-background-networking', '--disable-dev-shm-usage',
    '--disable-extensions', '--no-sandbox',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: 'ignore' });
  // Register immediately: ENOENT/permissions may emit 'error', not 'exit'.
  // Consume rejection even if Chrome reaches its DevTools port first.
  const spawnFailure = new Promise((_, reject) => {
    child.once('error', () => reject(new Error('Chrome spawn failed')));
  });
  spawnFailure.catch(() => {});
  let cdp;
  try {
    const path = join(profile, 'DevToolsActivePort');
    let lines;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Chrome exited early');
      if (existsSync(path)) {
        // Chrome can create DevToolsActivePort before its two lines have
        // been flushed. Existence alone is not a ready CDP endpoint.
        const candidate = readFileSync(path, 'utf8').trim().split(/\r?\n/);
        if (/^\d+$/.test(candidate[0]) &&
            candidate[1]?.startsWith('/devtools/browser/')) {
          lines = candidate;
          break;
        }
      }
      await Promise.race([sleep(100), spawnFailure]);
    }
    assert.ok(lines?.[0] && lines?.[1], 'Chrome debugging endpoint unavailable');
    cdp = await connect('ws://127.0.0.1:' + lines[0] + lines[1]);
  } catch (error) {
    await stopChromeChild(child);
    throw error;
  }
  return {
    cdp,
    async close() {
      cdp.close();
      await stopChromeChild(child);
    },
  };
}

async function openPage(cdp, width, height) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Network.enable', {}, sessionId);
  await cdp.send('Network.setBypassServiceWorker', { bypass: true }, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  }, sessionId);
  let url = 'about:blank';
  let redirectCount = 0;
  let finalStatus = null;
  const pageErrorHandlers = new Set();
  const frameNavigationHandlers = new Set();
  const mainFrame = {};
  const off = cdp.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) {
      url = m.params.frame.url;
      if (url !== 'about:blank') for (const cb of frameNavigationHandlers) cb(mainFrame);
    }
    if (m.method === 'Page.navigatedWithinDocument') {
      url = m.params.url;
      for (const cb of frameNavigationHandlers) cb(mainFrame);
    }
    if (m.method === 'Network.requestWillBeSent' &&
        m.params.type === 'Document' && m.params.redirectResponse) redirectCount++;
    if (m.method === 'Network.responseReceived' && m.params.type === 'Document') {
      finalStatus = m.params.response.status;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      for (const cb of pageErrorHandlers) cb(new Error('JS page exception'));
    }
  });
  const evaluate = async (fn, arg) => {
    const expression = '(' + fn.toString() + ')(' + JSON.stringify(arg) + ')';
    const response = await cdp.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    }, sessionId);
    if (response.exceptionDetails) {
      throw new Error('Browser evaluate exception: ' + response.exceptionDetails.text);
    }
    return response.result.value;
  };
  return {
    mainFrame() { return mainFrame; },
    on(event, listener) {
      if (event === 'pageerror') pageErrorHandlers.add(listener);
      if (event === 'framenavigated') frameNavigationHandlers.add(listener);
    },
    async goto(address) {
      redirectCount = 0; finalStatus = null;
      const loaded = cdp.once('Page.loadEventFired', sessionId);
      // Register rejection handling immediately: navigation can fail before
      // this await is reached, and the socket can reject the load waiter.
      loaded.catch(() => {});
      const nav = await cdp.send('Page.navigate', { url: address }, sessionId);
      if (nav.errorText) throw new Error('Chrome navigation: ' + nav.errorText);
      await loaded;
      return {
        status: () => finalStatus,
        request: () => ({ redirectedFrom: () => redirectCount > 0 ? { count: redirectCount } : null }),
      };
    },
    url() { return url; },
    evaluate,
    async waitForFunction(fn, arg, { timeout } = {}) {
      // Negative fixtures finish promptly; production retains its 15 s timeout.
      const deadline = Date.now() + Math.min(timeout ?? 15_000, 900);
      do {
        if (await evaluate(fn, arg)) return;
        await sleep(75);
      } while (Date.now() < deadline);
      throw new Error('Test Chrome marker wait timed out');
    },
    waitForTimeout: sleep,
    async screenshot({ path }) {
      const result = await cdp.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: false,
      }, sessionId);
      writeFileSync(path, Buffer.from(result.data, 'base64'));
    },
    async close() {
      off();
      await cdp.send('Target.disposeBrowserContext', { browserContextId });
    },
  };
}


// A closed Chrome socket must reject commands and event waits immediately,
// not leave unresolved promises behind until a 20-second CDP timeout.
async function assertDisconnectedSocketRejects() {
  for (const kind of ['close', 'error']) {
    const socket = new EventTarget();
    socket.readyState = WebSocket.OPEN;
    socket.send = () => {};
    socket.close = () => {};
    const cdp = new Cdp(socket);
    const pending = [
      cdp.send('Target.createTarget'),
      cdp.send('Page.navigate'),
      cdp.once('Page.loadEventFired', 'test-session'),
    ];
    socket.dispatchEvent(new Event(kind));
    const expected = kind === 'close' ? /WebSocket closed/ : /WebSocket error/;
    await Promise.all(pending.map((promise) =>
      assert.rejects(promise, expected)));
    assert.equal(cdp.pending.size, 0, 'disconnected commands must be cleared');
    assert.equal(cdp.eventWaits.size, 0, 'disconnected event waits must be cleared');
  }
  const socket = new EventTarget();
  socket.readyState = WebSocket.OPEN;
  socket.send = () => { throw new Error('synthetic send failure'); };
  const cdp = new Cdp(socket);
  await assert.rejects(cdp.send('Runtime.evaluate'), /synthetic send failure/);
  assert.equal(cdp.pending.size, 0, 'failed synchronous sends must not leave pending work');
}

async function main() {
  await assertDisconnectedSocketRejects();
  const root = mkdtempSync(join(tmpdir(), 'dwa-state-real-chrome-'));
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/redirect') {
      if (!request.headers.cookie?.includes('return=1')) {
        response.writeHead(302, { Location: '/redirect', 'Set-Cookie': 'return=1; SameSite=Lax' });
        return response.end();
      }
      return response.end(page(marker));
    }
    if (cases[request.url]) return response.end(cases[request.url]);
    response.writeHead(404); response.end('Not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let chrome;
  try {
    // ENOENT must reject promptly, without an unhandled child error or
    // waiting forever for an exit event from a process that never started.
    const missing = join(root, 'missing-chrome-test');
    mkdirSync(missing);
    await assert.rejects(
      startChrome(join(missing, 'nonexistent-chrome'), missing),
      /Chrome spawn failed/);
    chrome = await startChrome(process.env.CHROME_PATH ?? 'google-chrome', root);
    const baseUrl = 'http://127.0.0.1:' + server.address().port;
    const playwrightRoot = join(root, 'test-playwright-stub');
    mkdirSync(playwrightRoot);
    writeFileSync(join(playwrightRoot, 'index.mjs'), '// Injected CDP test adapter; no Playwright import.\n');
    const browserFactory = async () => ({ launch: async () => ({
      newContext: async ({ viewport, serviceWorkers, storageState }) => {
        assert.equal(serviceWorkers, 'block');
        assert.deepEqual(storageState, { cookies: [], origins: [] });
        let page;
        let notifyPage = () => {};
        return {
          on: (event, listener) => {
            if (event === 'page') notifyPage = listener;
          },
          newPage: async () => {
            page = await openPage(chrome.cdp, viewport.width, viewport.height);
            // Simulate Playwright BrowserContext's primary "page" event.
            // The probe must not classify that primary page as a popup.
            notifyPage(page);
            return page;
          },
          close: async () => { await page?.close(); },
        };
      },
      close: async () => {}, // The harness owns the real Chrome process.
    }) });
    const contract = {
      schemaVersion: 1, stateKey: 'game-live', readySelector: '[data-game-phase="live"]',
      requiredText: ['Playing now'], forbiddenText: ['Loading'],
    };
    const probe = (route, change = {}) => probeRenderedState({
      baseUrl, route, playwrightRoot, outRoot: root,
      contract: { ...contract, ...change },
    }, { browserFactory });
    const complete = await probe('/ready');
    assert.equal(complete.status, 'DOM_SIGNALS_OBSERVED', JSON.stringify(complete));
    assert.deepEqual(complete.observations.map((x) => x.width), widths);
    for (const obs of complete.observations) {
      assert.equal(obs.httpStatus, 200);
      assert.equal(obs.redirectChainPresent, false);
      assert.equal(obs.signals.first.markerVisible, true, 'visible second marker must count');
      assert.deepEqual(obs.signals.first.missingText, []);
      assert.deepEqual(obs.signals.first.forbiddenTextVisible, [], 'below-fold blocker must not count');
      assert.match(obs.screenshotSha256, /^[a-f0-9]{64}$/);
    }
    const hidden = await probe('/hidden', { requiredText: [], forbiddenText: [] });
    assert.equal(hidden.status, 'INCOMPLETE');
    assert.ok(hidden.observations.every((x) => x.status === 'INCOMPLETE' &&
      x.signals?.first.markerVisible === false), 'opacity:0 ancestor must never pass');
    const belowRequired = await probe('/below', {
      requiredText: ['Below requirement'], forbiddenText: [],
    });
    assert.equal(belowRequired.status, 'INCOMPLETE');
    assert.ok(belowRequired.observations.every((x) =>
      x.signals?.first.missingText?.includes('Below requirement')),
    'required text only below the viewport must be missing');
    const belowForbidden = await probe('/below', {
      requiredText: ['Playing now'], forbiddenText: ['Below requirement'],
    });
    assert.equal(belowForbidden.status, 'DOM_SIGNALS_OBSERVED', JSON.stringify(belowForbidden));
    const blocked = await probe('/blocked', {
      forbiddenSelectors: ['[data-access-blocker]'], forbiddenText: [],
    });
    assert.equal(blocked.status, 'INCOMPLETE');
    assert.ok(blocked.observations.every((x) =>
      x.status === 'INCOMPLETE' && x.signals?.first.markerVisible === true &&
      x.signals?.first.blockersVisible?.includes('[data-access-blocker]')),
    'a visible blocking selector must prevent DOM readiness at every viewport');
    const forbidden = await probe('/forbidden', { forbiddenText: ['Access denied'] });
    assert.equal(forbidden.status, 'INCOMPLETE');
    assert.ok(forbidden.observations.every((x) =>
      x.status === 'INCOMPLETE' && x.signals?.first.markerVisible === true &&
      x.signals?.first.forbiddenTextVisible?.includes('Access denied')),
    'visible forbidden text must prevent DOM readiness at every viewport');
    const redirected = await probe('/redirect', { forbiddenText: [] });
    assert.equal(redirected.status, 'INCOMPLETE');
    assert.ok(redirected.observations.every((x) =>
      x.httpStatus === 200 && x.finalPath === '/redirect' &&
      x.redirectChainPresent === true && x.signals?.first.markerVisible === true),
    'an otherwise-ready same-route redirect cannot pass');
    for (const report of [complete, hidden, belowRequired, belowForbidden, blocked, forbidden, redirected]) {
      assert.equal(report.tasteFramesVerified, false);
      assert.equal(report.productCompletionEligible, false);
      assert.equal(report.authenticatedSessionVerified, false);
      assert.equal(report.gamePhaseVerified, false);
    }
    console.log('Real Chrome DOM state probe passed: 7 scenarios at 1440/768/390, including hidden ancestors, viewport text, blockers, forbidden text and same-route HTTP redirects.');
  } finally {
    await chrome?.close();
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

await main();
