import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPatterns, loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import { auditP40StandardDeepShadowHandoff } from '../../reference-graph/p40-profile-shadow-handoff.mjs';
import { validateP40ReadOnlySourceWitness } from '../../reference-graph/p40-readonly-witness.mjs';

const now = new Date('2026-11-07T10:00:00.000Z');
const records = loadRecords();
const patterns = loadPatterns();
const candidates = buildP28OfflineProfileCandidatePool({ records, now });
const templates = JSON.parse(readFileSync('reference-graph/shadow-cases.json', 'utf8'));
const fixedHash = 'a'.repeat(64);
const observed = '2026-11-07T10:01:00.000Z';

function witness(overrides = {}) {
  return {
    schema_version: 'reference-graph.p40-readonly-source-witness.v1',
    source_method: 'p7-vs-p31-read-only',
    project_ref: 'vrznfnxzlxaavpqbzbzd',
    projection_version: 'reference-graph.profile-runtime.p30.v1',
    snapshot_date: '2026-11-07',
    refreshed_at: '2026-11-07T10:00:00.000Z',
    observed_at: observed,
    expected_candidate_count: 275,
    expected_candidate_id_set_sha256: fixedHash,
    published_candidate_count: 275,
    published_candidate_id_set_sha256: fixedHash,
    membership_mismatch_count: 0,
    metadata_mismatch_count: 0,
    refresh_instant_count: 1,
    activation_authorized: false,
    repository_default_graph_enabled: false,
    ...overrides,
  };
}

test('P40 validates new read-only same-snapshot witness without release authority', () => {
  const result = validateP40ReadOnlySourceWitness(witness(), {
    asOf: '2026-11-07T10:03:00.000Z',
  });
  assert.equal(result.expected_candidate_count, 275);
  assert.equal(result.expected_candidate_id_set_sha256, fixedHash);
  assert.equal(result.refreshed_at, '2026-11-07T10:00:00.000Z');
  assert.equal(Object.hasOwn(result, 'activation_authorized'), false);
});

test('P40 refuses stale, wrong-project, mismatching, unsigned-claim and synthetic release authority', () => {
  const asOf = '2026-11-07T10:03:00.000Z';
  const bad = [
    { project_ref: 'unrelated-project' },
    { source_method: 'refresh-receipt' },
    { membership_mismatch_count: 1 },
    { metadata_mismatch_count: 1 },
    { refresh_instant_count: 2 },
    { published_candidate_count: 274 },
    { published_candidate_id_set_sha256: 'b'.repeat(64) },
    { activation_authorized: true },
    { repository_default_graph_enabled: true },
    { unexpected: 'untrusted' },
    { snapshot_date: '2026-11-06' },
    { refreshed_at: '2026-11-07T05:00:00.000Z' },
    { observed_at: '2026-11-07T09:40:00.000Z' },
    { observed_at: '2026-11-07T10:10:00.000Z' },
  ];
  for (const patch of bad) {
    assert.throws(() => validateP40ReadOnlySourceWitness(witness(patch), { asOf }),
      /P40 read-only source witness rejected/);
  }
  assert.throws(() => validateP40ReadOnlySourceWitness(witness(), {}),
    /P40 read-only source witness rejected/);
});

test('P40 standard/deep offline shadow matches legacy records and patterns for 48 frozen scenarios', () => {
  let count = 0;
  for (const template of templates) {
    for (const profile of ['standard', 'deep']) {
      const report = auditP40StandardDeepShadowHandoff({
        records, patterns, candidates, now,
        request: {
          profile, limit: profile === 'deep' ? 28 : 12,
          surface: template.surface, platform: template.platform,
          job: template.job, dimensions: template.dimensions,
        },
      });
      count++;
      assert.equal(report.parity_exact, true, template.id + ':' + profile);
      assert.equal(report.record_order_exact, true);
      assert.equal(report.pattern_order_exact, true);
      assert.equal(report.authoritative_source, 'legacy-control');
      assert.equal(report.graph_runtime_attempted, false);
      assert.equal(report.activation_authorized, false);
      assert.equal(report.activation_performed, false);
    }
  }
  assert.equal(count, 48);
});

test('P40 rejects Quick and invalid candidate metadata without touching runtime or output', () => {
  const template = templates[0];
  const request = {
    profile: 'standard', limit: 12,
    surface: template.surface, platform: template.platform,
    job: template.job, dimensions: template.dimensions,
  };
  assert.throws(() => auditP40StandardDeepShadowHandoff({
    records, patterns, candidates, now, request: { ...request, profile: 'quick' },
  }), /P40 requires valid/);
  assert.throws(() => auditP40StandardDeepShadowHandoff({
    records, patterns,
    candidates: [...candidates, candidates[0]],
    now, request,
  }), /candidate|duplicate/i);
  const source = readFileSync('reference-graph/p40-profile-shadow-handoff.mjs', 'utf8');
  assert.doesNotMatch(source, /fetch\(|writeFile|recordUsage|SUPABASE_SERVICE_ROLE_KEY|process\.env/);
});

test('P40 witness SQL remains aggregate read-only and never calls refresh', () => {
  const source = readFileSync('reference-graph/ops/p40-source-projection-witness.sql', 'utf8');
  assert.match(source, /reference_graph_quick_candidate_pool_p7/);
  assert.match(source, /reference_graph_profile_runtime_projection_p30_v1/);
  assert.match(source, /metadata_diff/);
  assert.doesNotMatch(source, /\b(?:insert|update|delete|truncate|drop|alter|grant|revoke|call)\s+(?:into\s+|from\s+|table\s+|on\s+|function\s+)?(?:public\.|reference_graph\.)/i);
  assert.doesNotMatch(source, /select\s+public\.reference_graph_refresh_profile_runtime_projection_p31\s*\(/i);
});
