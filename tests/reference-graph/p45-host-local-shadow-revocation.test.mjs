import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadRecords, loadPatterns } from '../../knowledge/design-references/scripts/lib.mjs';
import { createP44IsolatedShadowRollbackHarness } from '../../reference-graph/p44-isolated-shadow-rollback.mjs';
import {
  isP45ShadowRevoked, revokeP45SharedShadow, wrapP45HostLocalShadow,
} from '../../reference-graph/p45-host-local-shadow-revocation.mjs';

const scope = {
  mode: 'isolated-shadow-rehearsal',
  default_off: true,
  production_route_wiring: false,
  profiles: ['standard', 'deep'],
};
const exact = {
  status: 'exact', record_order_exact: true, pattern_order_exact: true,
  authoritative_source: 'legacy-control',
  activation_authorized: false, graph_runtime_activated: false,
};
const req = {
  profile: 'standard', limit: 12, surface: 'public-home',
  platform: 'web-responsive', job: 'creator landing page',
  dimensions: 'visual-world,topology',
};
const records = loadRecords(), patterns = loadPatterns();
const now = new Date('2026-11-09T18:00:00.000Z');

function childRevoke(directory) {
  const script = [
    "import { revokeP45SharedShadow } from './reference-graph/p45-host-local-shadow-revocation.mjs';",
    "const result = revokeP45SharedShadow({ directory: process.argv[1], reason: 'manual-revoke' });",
    "if (!result.revoked || result.activation_authorized !== false) process.exitCode = 2;",
  ].join('\n');
  const child = spawnSync(process.execPath,
    ['--input-type=module', '--eval', script, directory],
    { encoding: 'utf8', cwd: process.cwd(), timeout: 10000 });
  assert.equal(child.status, 0, 'separate OS process did not revoke');
}

test('P45 denies nonexistent dir, wrong scope, and existing marker', async () => {
  const root = mkdtempSync(join(tmpdir(), 'p45-scope-'));
  try {
    assert.equal(isP45ShadowRevoked(join(root, 'missing')), true);
    assert.throws(() => wrapP45HostLocalShadow({
      directory: root, scope: { ...scope, production_route_wiring: true },
      shadowProbe: () => exact,
    }), /unavailable/);
    writeFileSync(join(root, 'p45-shadow-revoked'), '');
    assert.equal(isP45ShadowRevoked(root), true);
    assert.throws(() => wrapP45HostLocalShadow({
      directory: root, scope, shadowProbe: () => exact,
    }), /unavailable/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('P45 cross-process revoke survives worker restart and suppresses all new probes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'p45-process-'));
  try {
    let calls = 0;
    const probe = wrapP45HostLocalShadow({
      directory: root, scope,
      shadowProbe: async () => { calls++; return exact; },
    });
    assert.deepEqual(await probe({ request: req }), exact);
    childRevoke(root);
    assert.equal(isP45ShadowRevoked(root), true);
    await assert.rejects(probe({ request: req }), /BLOCKED/);
    assert.equal(calls, 1);
    const receipt = revokeP45SharedShadow({ directory: root, reason: 'manual-revoke' });
    assert.equal(receipt.revoked, true);
    assert.equal(receipt.activation_authorized, false);
    assert.throws(() => wrapP45HostLocalShadow({
      directory: root, scope, shadowProbe: () => exact,
    }), /unavailable/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('P45 a different OS process aborts an already in-flight local probe', { timeout: 10000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'p45-flight-'));
  try {
    let started;
    const entering = new Promise(resolve => { started = resolve; });
    let receivedAbort = false;
    const probe = wrapP45HostLocalShadow({
      directory: root, scope, pollMs: 10,
      shadowProbe: ({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          receivedAbort = true;
          reject(new Error('secret payload never exposed'));
        }, { once: true });
        started();
      }),
    });
    const inFlight = probe({ request: req });
    await entering;
    childRevoke(root);
    await assert.rejects(inFlight, /P45 shared shadow BLOCKED/);
    assert.equal(receivedAbort, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('P45 with P44 preserves Legacy result and latches after remote revoke', async () => {
  const root = mkdtempSync(join(tmpdir(), 'p45-p44-'));
  try {
    let calls = 0;
    const probe = wrapP45HostLocalShadow({
      directory: root, scope,
      shadowProbe: async () => { calls++; return exact; },
    });
    const p44 = createP44IsolatedShadowRollbackHarness({ shadowProbe: probe });
    p44.armForRehearsal(scope);
    const base = { records, patterns, request: req, now };
    const initial = await p44.run(base);
    assert.equal(initial.shadow.status, 'exact');
    childRevoke(root);
    const after = await p44.run(base);
    assert.equal(after.shadow.status, 'blocked');
    assert.equal(after.routing.authoritative_source, 'legacy-control');
    assert.equal(after.shadow.local_kill_switch_latched, true);
    const next = await p44.run(base);
    assert.equal(next.shadow.status, 'off');
    assert.equal(calls, 1);
    assert.equal(next.shadow.production_graph_activated, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('P45 parity mismatch persists a shared OFF marker without activation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'p45-mismatch-'));
  try {
    const probe = wrapP45HostLocalShadow({
      directory: root, scope,
      shadowProbe: async () => ({ ...exact, pattern_order_exact: false }),
    });
    await assert.rejects(probe({ request: req }), /BLOCKED/);
    assert.equal(isP45ShadowRevoked(root), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
