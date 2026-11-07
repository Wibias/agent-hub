#!/usr/bin/env node
// Real Playwright transport regression: exercise production loadPlaywright,
// chromium.launch, browser.newContext, page.goto/evaluate/screenshot and redirects.
// All pages are anonymous loopback fixtures, not Taste Skill browser contexts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeRenderedState } from '../../scripts/providers/rendered-state-probe.mjs';

const widths = [1440, 768, 390];
const marker = '<div data-game-phase="live">Playing now</div>';
const page = (html) => '<!doctype html><html><head><meta charset="utf-8"></head><body>' + html + '</body></html>';
const pages = {
  '/ready': page('<div style="opacity:0"><div data-game-phase="live">Hidden first</div></div>' +
    marker + '<div style="margin-top:1400px">Loading below fold</div>'),
  '/hidden': page('<div style="opacity:0">' + marker + '</div>'),
  '/clipped-marker': page('<div style="height:0;overflow:hidden">' + marker + '</div>'),
  '/clipped-forbidden': page(marker +
    '<div style="height:0;overflow:hidden"><p>Access denied</p></div>'),
  '/contents-forbidden': page(marker +
    '<div style="display:contents">Access denied</div>'),
  '/split-forbidden': page(marker + '<p>Access den<span>i</span>ed</p>'),
  '/split-required': page('<div data-game-phase="live">Play<span>ing</span> now</div>'),
  '/visible-override': page('<div style="visibility:hidden">' +
    '<div style="visibility:visible" data-game-phase="live">Playing now</div></div>'),
  '/blocked': page(marker + '<div data-access-blocker>Checking access</div>'),
  '/forbidden': page(marker + '<p>Access denied</p>'),
  '/below': page(marker + '<div style="margin-top:1400px">Below requirement</div>'),
  '/bounce': page(marker + '<script>if (!sessionStorage.getItem("dwa-once")) {' +
    'sessionStorage.setItem("dwa-once", "1");' +
    'setTimeout(() => { location.href = "/bounce-hop"; }, 100);}</script>'),
};

const playwrightRoot = process.env.DWA_PLAYWRIGHT_ROOT;
const chromePath = process.env.CHROME_PATH;
assert.ok(playwrightRoot && existsSync(join(playwrightRoot, 'index.mjs')),
  'DWA_PLAYWRIGHT_ROOT must reference the pinned installed playwright-core package');
assert.ok(chromePath && existsSync(chromePath),
  'CHROME_PATH must reference the installed Chrome executable');

const root = mkdtempSync(join(tmpdir(), 'dwa-state-playwright-'));
const readyCookies = [];
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.url === '/ready') {
    readyCookies.push(request.headers.cookie ?? '');
    response.setHeader('Set-Cookie', 'dwa-context-isolation=1; Path=/; SameSite=Lax');
  }
  if (request.url === '/bounce-hop') {
    return response.end(page('<script>location.replace("/bounce")</script>'));
  }
  if (request.url === '/redirect') {
    if (!request.headers.cookie?.includes('return=1')) {
      response.writeHead(302, { Location: '/redirect', 'Set-Cookie': 'return=1; Path=/; SameSite=Lax' });
      return response.end();
    }
    return response.end(page(marker));
  }
  if (pages[request.url]) return response.end(pages[request.url]);
  response.writeHead(404);
  response.end('Not found');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  const contract = {
    schemaVersion: 1, stateKey: 'game-live', readySelector: '[data-game-phase="live"]',
    requiredText: ['Playing now'], forbiddenText: ['Loading'],
  };
  const probe = (route, overrides = {}) => probeRenderedState({
    baseUrl, route, playwrightRoot, chromePath, outRoot: root,
    contract: { ...contract, ...overrides },
  });
  const assertWidths = (report, status) => {
    assert.equal(report.status, status, JSON.stringify(report));
    assert.deepEqual(report.observations.map((observation) => observation.width), widths);
    assert.equal(report.productCompletionEligible, false);
    assert.equal(report.tasteFramesVerified, false);
    assert.equal(report.authenticatedSessionVerified, false);
    assert.equal(report.gamePhaseVerified, false);
  };

  const ready = await probe('/ready');
  assertWidths(ready, 'DOM_SIGNALS_OBSERVED');
  assert.equal(ready.declaredDomStateObserved, true);
  assert.equal(readyCookies.length, widths.length, 'One anonymous navigation per context');
  assert.ok(readyCookies.every((cookie) => !cookie.includes('dwa-context-isolation')),
    'No cookie from a preceding viewport context may leak into the next one');
  for (const observation of ready.observations) {
    assert.equal(observation.status, 'DOM_SIGNALS_OBSERVED');
    assert.equal(observation.httpStatus, 200);
    assert.equal(observation.redirectChainPresent, false);
    assert.equal(observation.signals.first.markerVisible, true,
      'Visible second ready marker must count');
    assert.deepEqual(observation.signals.first.missingText, []);
    assert.deepEqual(observation.signals.first.forbiddenTextVisible, [],
      'Below-fold text must not cause a false failure');
    const screenshot = readFileSync(observation.screenshot);
    assert.equal(screenshot.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(observation.screenshotSha256, createHash('sha256').update(screenshot).digest('hex'));
  }

  const hidden = await probe('/hidden', { requiredText: [], forbiddenText: [] });
  assertWidths(hidden, 'INCOMPLETE');
  assert.ok(hidden.observations.every((x) => x.signals?.first.markerVisible === false),
    'An opacity-zero ancestor must hide the ready marker');

  const clippedMarker = await probe('/clipped-marker', {
    requiredText: ['Playing now'], forbiddenText: [],
  });
  assertWidths(clippedMarker, 'INCOMPLETE');
  assert.ok(clippedMarker.observations.every((x) =>
    x.signals?.first.markerVisible === false &&
    x.signals?.first.missingText?.includes('Playing now')),
  'A zero-height overflow:hidden ancestor cannot attest readiness or text');

  const clippedForbidden = await probe('/clipped-forbidden', {
    forbiddenText: ['Access denied'],
  });
  assertWidths(clippedForbidden, 'DOM_SIGNALS_OBSERVED');

  const contentsForbidden = await probe('/contents-forbidden', {
    forbiddenText: ['Access denied'],
  });
  assertWidths(contentsForbidden, 'INCOMPLETE');
  assert.ok(contentsForbidden.observations.every((x) =>
    x.signals?.first.forbiddenTextVisible?.includes('Access denied')),
  'display:contents has no box, but its text is visibly painted');

  const splitForbidden = await probe('/split-forbidden', {
    forbiddenText: ['Access denied'],
  });
  assertWidths(splitForbidden, 'INCOMPLETE');
  assert.ok(splitForbidden.observations.every((x) =>
    x.signals?.first.forbiddenTextVisible?.includes('Access denied')),
  'Forbidden words split across inline spans cannot be skipped');

  const splitRequired = await probe('/split-required', {
    requiredText: ['Playing now'],
  });
  assertWidths(splitRequired, 'DOM_SIGNALS_OBSERVED');

  const overrideVisible = await probe('/visible-override');
  assertWidths(overrideVisible, 'DOM_SIGNALS_OBSERVED');

  const blocked = await probe('/blocked', {
    forbiddenSelectors: ['[data-access-blocker]'], forbiddenText: [],
  });
  assertWidths(blocked, 'INCOMPLETE');
  assert.ok(blocked.observations.every((x) =>
    x.signals?.first.blockersVisible?.includes('[data-access-blocker]')),
  'A visible blocking element must prevent readiness');

  const forbidden = await probe('/forbidden', { forbiddenText: ['Access denied'] });
  assertWidths(forbidden, 'INCOMPLETE');
  assert.ok(forbidden.observations.every((x) =>
    x.signals?.first.forbiddenTextVisible?.includes('Access denied')),
  'Visible forbidden text must prevent readiness');

  const belowRequired = await probe('/below', {
    requiredText: ['Below requirement'], forbiddenText: [],
  });
  assertWidths(belowRequired, 'INCOMPLETE');
  assert.ok(belowRequired.observations.every((x) =>
    x.signals?.first.missingText?.includes('Below requirement')),
  'Required text outside the viewport cannot count as visible');

  const belowForbidden = await probe('/below', {
    requiredText: ['Playing now'], forbiddenText: ['Below requirement'],
  });
  assertWidths(belowForbidden, 'DOM_SIGNALS_OBSERVED');

  const redirected = await probe('/redirect', { forbiddenText: [] });
  assertWidths(redirected, 'INCOMPLETE');
  assert.ok(redirected.observations.every((x) =>
    x.httpStatus === 200 && x.redirectChainPresent === true &&
    x.finalPath === '/redirect' && x.signals?.first.markerVisible === true),
  'Same-route HTTP redirect chains must invalidate otherwise-ready Playwright evidence');

  const jsBounce = await probe('/bounce', { forbiddenText: [] });
  assertWidths(jsBounce, 'INCOMPLETE');
  assert.ok(jsBounce.observations.every((x) =>
    x.httpStatus === 200 && x.finalPath === '/bounce' &&
    x.mainFrameNavigationCount >= 3 && x.signals?.afterScreenshot?.markerVisible === true),
  'JS redirect away and back must fail despite an otherwise-ready same-route screenshot');

  console.log('Real production Playwright transport passed: 14 scenarios at 1440/768/390, including clipped ancestors, display:contents text, split words, visibility override, redirects, context isolation and PNG hashes.');
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
