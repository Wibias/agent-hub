import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchP10QuickCandidatePool } from '../../reference-graph/p10-runtime-client.mjs';
import { runP11RuntimeQuery } from '../../reference-graph/p11-runtime-router.mjs';
import { probeP17Runtime } from '../../reference-graph/p17-activation-runner.mjs';
import { sampleP19ProductionHealth } from '../../reference-graph/p19-production-soak.mjs';
import { loadRecords, loadPatterns } from '../../knowledge/design-references/scripts/lib.mjs';

const PROD_URL = 'https://vrznfnxzlxaavpqbzbzd.supabase.co';
const NOW = new Date('2026-10-23T12:00:00.000Z');

function candidate() {
  return {
    asset_id: '11111111-1111-5111-8111-111111111111',
    legacy_id: 'ref-one',
    product: 'One',
    surface_family: 'public-home',
    platform: 'web-responsive',
    page_role: 'marketing',
    motion: 'static',
    source_family: 'one.example',
    topology: 'hero-grid',
    access_status: 'AVAILABLE',
    evidence_class: 'TESTED',
    ordinary_or_failure_prone: false,
    multi_state_flow: false,
    tags: ['visual-verified'],
    search_text: 'creator landing page',
    snapshot_date: '2026-10-24',
    refreshed_at: '2026-10-24T00:00:00.000Z',
  };
}

test('P25 traces timeout and successful retry with bounded numeric budgets only', async () => {
  const diagnostic = [];
  let count = 0;
  const result = await fetchP10QuickCandidatePool({
    supabaseUrl: 'https://example.supabase.co',
    publishableKey: 'secret-publishable',
    expectedDate: '2026-10-24',
    timeoutMs: 10,
    retryTimeoutMs: 100,
    onDiagnostic: (event) => diagnostic.push(event),
    fetchImpl: async (_url, options) => {
      count += 1;
      if (count === 1) {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('secret remote detail')), { once: true });
        });
      }
      return { ok: true, status: 200, json: async () => [candidate()] };
    },
  });

  assert.equal(result.transport.status, 'available');
  assert.equal(count, 2);
  assert.deepEqual(diagnostic.map((e) => [e.phase, e.attempt, e.outcome, e.category, e.timeout_budget_ms]), [
    ['p10-attempt', 1, 'failed', 'timeout', 10],
    ['p10-attempt', 2, 'ok', 'none', 100],
  ]);
  assert.ok(diagnostic.every((e) => Number.isFinite(e.duration_ms) && e.duration_ms >= 0));
  assert.ok(diagnostic.every((e) => Number.isFinite(e.timeout_overrun_ms) && e.timeout_overrun_ms >= 0));
  assert.doesNotMatch(JSON.stringify(diagnostic), /secret-publishable|secret remote detail|https:\/\//);
});

test('P25 diagnostic observers cannot change network success or fail-closed results', async () => {
  const result = await fetchP10QuickCandidatePool({
    supabaseUrl: 'https://example.supabase.co',
    publishableKey: 'secret',
    expectedDate: '2026-10-24',
    onDiagnostic: () => { throw new Error('observer failed'); },
    fetchImpl: async () => ({ ok: true, json: async () => [candidate()] }),
  });
  assert.equal(result.candidates.length, 1);
});

test('P25 categorizes quick router fallback without changing authoritative legacy output', async () => {
  const events = [];
  const result = await runP11RuntimeQuery({
    records: loadRecords(),
    patterns: loadPatterns(),
    request: {
      profile: 'quick',
      limit: 4,
      surface: 'operator-control',
      platform: 'web-responsive',
      job: 'production runtime activation verification with status and controls',
      dimensions: 'ia,status,topology',
    },
    graphMode: 'graph',
    now: NOW,
    fetchCandidatePool: async () => { throw new Error('DONT-LEAK-RAW-ERROR'); },
    recordUsageEnabled: false,
    onDiagnostic: (event) => events.push(event),
  });
  assert.equal(result.routing.authoritative_source, 'legacy-control');
  assert.equal(result.routing.reason, 'graph-runtime-error');
  assert.deepEqual(events.map((e) => [e.phase, e.outcome, e.category]), [
    ['p11-route', 'fallback', 'internal-error'],
  ]);
  assert.doesNotMatch(JSON.stringify(events), /DONT-LEAK-RAW-ERROR/);
});

test('P25 records per-profile P17 probe timings without altering public routing shape', async () => {
  const events = [];
  const result = await probeP17Runtime({
    statePath: '/nonexistent-p25-activation-state',
    env: {},
    now: NOW,
    runProfile: async ({ profile }) => profile === 'quick'
      ? { authoritative_source: 'legacy-control', record_exact: null, pattern_exact: null }
      : { authoritative_source: 'legacy-control' },
    onDiagnostic: (event) => events.push(event),
  });
  assert.deepEqual(Object.keys(result), ['quick', 'standard', 'deep']);
  for (const stage of ['state-projection', 'profile-quick', 'profile-standard', 'profile-deep']) {
    assert.ok(events.some((e) => e.phase === 'p17-stage' && e.stage === stage && Number.isFinite(e.duration_ms)), stage);
  }
});

test('P25 samples persist sanitized diagnostic categories without leaking raw observer fields', async () => {
  const secret = 'sb_secret_DO_NOT_SERIALIZE';
  const state = {
    production_source: 'reference-graph',
    quick_graph_enabled: true,
    repository_default_graph_enabled: false,
  };
  const sample = await sampleP19ProductionHealth({
    env: { SUPABASE_URL: PROD_URL, SUPABASE_PUBLISHABLE_KEY: 'pk' },
    now: () => NOW,
    readState: async () => state,
    probeRuntime: async ({ onDiagnostic }) => {
      onDiagnostic({ phase: 'p10-attempt', attempt: 1, outcome: 'failed', category: 'timeout', duration_ms: 15, timeout_budget_ms: 10, timeout_overrun_ms: 5, secret });
      onDiagnostic({ phase: 'p11-route', outcome: 'fallback', category: 'transport-timeout', secret });
      onDiagnostic({ phase: 'anything', note: secret });
      return {
        quick: { authoritative_source: 'legacy-control', record_exact: null, pattern_exact: null },
        standard: { authoritative_source: 'legacy-control' },
        deep: { authoritative_source: 'legacy-control' },
      };
    },
  });
  assert.equal(sample.healthy, false);
  assert.deepEqual(sample.blockers, [
    'quick-route-not-reference-graph',
    'quick-record-parity-failed',
    'quick-pattern-parity-failed',
  ]);
  assert.equal(sample.diagnostics.schema_version, 'reference-graph.p25-probe-diagnostics.v1');
  assert.equal(sample.diagnostics.events.length, 2);
  assert.deepEqual(sample.diagnostics.events.map((e) => e.phase), ['p10-attempt', 'p11-route']);
  assert.doesNotMatch(JSON.stringify(sample), /sb_secret_DO_NOT_SERIALIZE|secret/);
});
