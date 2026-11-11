import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPatterns, loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import { runP11RuntimeQuery } from '../../reference-graph/p11-runtime-router.mjs';
import { createP65ServerShadowAdapter } from '../../reference-graph/p65-server-shadow-adapter.mjs';

const checkoutSha = '6de6795f7f07a954958319f41d45225351bf6bf1';
const project = 'vrznfnxzlxaavpqbzbzd';
const now = new Date('2026-11-11T06:32:00.000Z');
const records = loadRecords();
const patterns = loadPatterns();
const request = {
  profile: 'standard', limit: 12, surface: 'public-home',
  platform: 'web-responsive', job: 'creator product landing page with clear primary CTA',
  dimensions: 'visual-world,topology',
};
const scope = {
  mode: 'isolated-server-shadow-rehearsal', project_ref: project,
  source_commit_sha: checkoutSha, profiles: ['standard', 'deep'],
  default_off: true, production_route_wiring: false,
};
const exact = {
  status: 'exact', record_order_exact: true, pattern_order_exact: true,
  authoritative_source: 'legacy-control', graph_runtime_activated: false,
  activation_authorized: false,
};
const run = (adapter, overrides = {}) => adapter.run({
  records, patterns, request, now, ...overrides,
});
const legacy = () => runP11RuntimeQuery({
  records, patterns, request, now, graphMode: 'legacy',
  recordUsageEnabled: false,
});
const make = (overrides = {}) => createP65ServerShadowAdapter({
  checkoutSha, auditShadow: () => exact, ...overrides,
});

test('P65 defaults OFF and returns byte-equivalent authentic Legacy output without GET', async () => {
  let probes = 0;
  const adapter = make({ auditShadow() { probes++; return exact; } });
  const [actual, baseline] = await Promise.all([run(adapter), legacy()]);
  assert.deepEqual(actual.result, baseline.result);
  assert.deepEqual(actual.routing, baseline.routing);
  assert.equal(actual.shadow.status, 'off');
  assert.equal(adapter.status().shadow_only, true);
  assert.equal(adapter.status().production_graph_activated, false);
  assert.equal(probes, 0);
});

test('P65 accepts only exact versioned isolated scope, never a production or Quick scope', async () => {
  const adapter = make();
  for (const invalid of [
    { ...scope, source_commit_sha: 'a'.repeat(40) },
    { ...scope, project_ref: 'wrong-project' },
    { ...scope, default_off: false },
    { ...scope, production_route_wiring: true },
    { ...scope, profiles: ['quick'] },
    { ...scope, profiles: ['standard', 'standard'] },
    { ...scope, unexpected_release: true },
    { ...scope, mode: 'production' },
  ]) assert.throws(() => adapter.armForRehearsal(invalid), /scope rejected/);
  assert.equal(adapter.status().local_probe_enabled, false);
  assert.throws(() => make({ checkoutSha: 'invalid' }), /configuration/);
  assert.throws(() => run(adapter, {request: {...request, profile: 'quick'}}),
    /Standard\/Deep/);
});

test('P65 exact isolated rehearsal calls P41 interface on server and keeps Legacy public result', async () => {
  let calls = 0;
  const secret = 'sb_secret_p65_unit_test_only';
  const adapter = make({ serviceKey: secret,
    sourceWitnessJson: '{"test":true}', sourceWitnessSha256: 'b'.repeat(64),
    auditShadow(input) {
      calls++;
      assert.equal(input.serviceKey, secret);
      assert.equal(input.accessMode, 'server');
      assert.equal(input.supabaseUrl, `https://${project}.supabase.co/`);
      assert.equal(input.request.profile, 'standard');
      assert.equal(input.signal.aborted, false);
      return exact;
    },
  });
  adapter.armForRehearsal(scope);
  const [actual, baseline] = await Promise.all([run(adapter), legacy()]);
  assert.equal(calls, 1);
  assert.equal(actual.shadow.status, 'exact');
  assert.deepEqual(actual.result, baseline.result);
  assert.deepEqual(actual.routing, baseline.routing);
  assert.equal(actual.shadow.production_rollback_performed, false);
  assert.equal(JSON.stringify(actual).includes(secret), false);
  assert.throws(() => adapter.armForRehearsal(scope), /cannot arm/);
});

test('P65 mismatch latches OFF, blocks later transport, and preserves Legacy output', async () => {
  let calls = 0;
  const adapter = make({ auditShadow() { calls++; return {...exact, pattern_order_exact: false}; } });
  adapter.armForRehearsal(scope);
  const baseline = await legacy();
  const failed = await run(adapter), later = await run(adapter);
  assert.equal(failed.shadow.status, 'blocked');
  assert.equal(failed.shadow.reason, 'parity-mismatch');
  assert.equal(failed.shadow.local_kill_switch_latched, true);
  assert.equal(later.shadow.status, 'off');
  assert.equal(calls, 1);
  assert.deepEqual(failed.result, baseline.result);
  assert.deepEqual(later.result, baseline.result);
  assert.throws(() => adapter.armForRehearsal(scope), /cannot arm/);
});

test('P65 explicit revocation aborts an in-flight shadow and a new instance restarts OFF', async () => {
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  let aborted = 0, requests = 0;
  const adapter = make({ timeoutMs: 2000,
    auditShadow({ signal }) {
      requests++;
      started();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted++;
          reject(new Error('sensitive-probe-error'));
        }, { once: true });
      });
    },
  });
  adapter.armForRehearsal(scope);
  const inflight = run(adapter);
  await pending;
  adapter.revokeForRehearsal();
  const stopped = await inflight;
  assert.equal(stopped.shadow.reason, 'manual-revoke');
  assert.equal(stopped.shadow.local_kill_switch_latched, true);
  assert.equal(aborted, 1);
  assert.equal(requests, 1);
  assert.equal(JSON.stringify(stopped).includes('sensitive-probe-error'), false);
  await run(adapter);
  assert.equal(requests, 1);
  const restarted = make({ auditShadow() { requests++; return exact; } });
  await run(restarted);
  assert.equal(restarted.status().local_probe_enabled, false);
  assert.equal(requests, 1);
});

test('P65 fails closed on a thrown error and a timeout, without exposing probe errors', async () => {
  for (const failure of ['throw', 'timeout']) {
    let calls = 0;
    const adapter = make({ timeoutMs: 20, auditShadow() {
      calls++;
      if (failure === 'throw') throw new Error('private service key!');
      return new Promise(() => {});
    } });
    adapter.armForRehearsal(scope);
    const result = await run(adapter);
    assert.equal(result.shadow.status, 'blocked');
    assert.equal(result.shadow.reason, failure === 'throw' ? 'http-error' : 'timeout');
    assert.equal(result.shadow.local_kill_switch_latched, true);
    assert.equal(JSON.stringify(result).includes('private service key!'), false);
    await run(adapter);
    assert.equal(calls, 1);
  }
});

test('P65 can wire genuine P41 and a mocked bounded service-only P30 GET', async () => {
  const candidates = buildP28OfflineProfileCandidatePool({
    records, now: new Date('2026-11-11T00:00:00.000Z'),
  });
  const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
  const idSha = hash(candidates.map(item => item.legacy_id).sort().join('\n'));
  const witness = {
    schema_version: 'reference-graph.p40-readonly-source-witness.v1',
    source_method: 'p7-vs-p31-read-only', project_ref: project,
    projection_version: 'reference-graph.profile-runtime.p30.v1',
    snapshot_date: '2026-11-11', refreshed_at: '2026-11-11T06:30:00.000Z',
    observed_at: '2026-11-11T06:31:00.000Z',
    expected_candidate_count: candidates.length,
    expected_candidate_id_set_sha256: idSha,
    published_candidate_count: candidates.length,
    published_candidate_id_set_sha256: idSha,
    membership_mismatch_count: 0, metadata_mismatch_count: 0,
    refresh_instant_count: 1, activation_authorized: false,
    repository_default_graph_enabled: false,
  };
  const rows = [...candidates].sort((a,b) =>
    a.asset_id < b.asset_id ? -1 : a.asset_id > b.asset_id ? 1 : 0).map(row => ({
    ...row, projection_version: 'reference-graph.profile-runtime.p30.v1',
    snapshot_date: '2026-11-11', refreshed_at: '2026-11-11T06:30:00+00:00',
  }));
  const raw = JSON.stringify(witness);
  let gets = 0;
  const adapter = createP65ServerShadowAdapter({
    checkoutSha, sourceWitnessJson: raw,
    sourceWitnessSha256: hash(raw), serviceKey: 'sb_secret_p65_mock_only',
    fetchImpl: async (url, options) => {
      gets++;
      assert.equal(new URL(url).pathname,
        '/rest/v1/reference_graph_profile_candidates_server_p30_v1');
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined);
      const parsed = new URL(url);
      const offset = Number(parsed.searchParams.get('offset'));
      const limit = Number(parsed.searchParams.get('limit'));
      const page = rows.slice(offset, offset + limit);
      return {
        ok: true, status: 206,
        headers: { get(key) { return key.toLowerCase() === 'content-range'
          ? `${offset}-${offset + page.length - 1}/${rows.length}` : null; } },
        async json() { return page; },
      };
    },
  });
  await run(adapter);
  assert.equal(gets, 0);
  adapter.armForRehearsal(scope);
  const output = await run(adapter);
  assert.equal(output.shadow.status, 'exact');
  assert.equal(output.routing.authoritative_source, 'legacy-control');
  assert.equal(output.shadow.production_graph_activated, false);
  assert.equal(gets, 1);
});

test('P65 never enters the public router or CLI, and has no release side effects', () => {
  const source = readFileSync('reference-graph/p65-server-shadow-adapter.mjs','utf8');
  const router = readFileSync('reference-graph/p11-runtime-router.mjs','utf8');
  const cli = readFileSync('knowledge/design-references/scripts/query.mjs','utf8');
  assert.doesNotMatch(router, /p65-server-shadow-adapter/);
  assert.doesNotMatch(cli, /p65-server-shadow-adapter|P40_SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(source, /process\.env|writeFile|apply_migration|recordUsageFn/);
});
