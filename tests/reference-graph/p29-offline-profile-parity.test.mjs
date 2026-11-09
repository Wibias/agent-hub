import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { loadPatterns, loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import { evaluateP27StandardDeepBaseline } from '../../reference-graph/p27-standard-deep-baseline.mjs';
import {
  selectP29ProfileCandidateIds,
  compareP29OfflineProfileParity,
} from '../../reference-graph/p29-offline-profile-parity.mjs';

const now = new Date('2026-11-07T00:00:00.000Z');
const records = loadRecords();
const patterns = loadPatterns();
const templates = JSON.parse(readFileSync('reference-graph/shadow-cases.json', 'utf8'));
const candidates = buildP28OfflineProfileCandidatePool({ records, now });
const baseline = evaluateP27StandardDeepBaseline({ templates, records, patterns, now });

function requestFor(template, profile) {
  return {
    profile,
    limit: profile === 'deep' ? 28 : 12,
    surface: template.surface,
    platform: template.platform,
    job: template.job,
    dimensions: template.dimensions,
  };
}

test('P29 independent candidate selector matches P27 Standard and Deep output on canonical scenarios', () => {
  const report = compareP29OfflineProfileParity({ templates, candidates, baseline, expectedReferenceDate: '2026-11-07' });
  assert.equal(report.schema_version, 'reference-graph.p29-offline-profile-parity.v1');
  assert.equal(report.reference_date, '2026-11-07');
  assert.equal(report.evaluated_cases, 48);
  assert.equal(report.exact_order_cases, 48);
  assert.equal(report.mismatch_cases, 0);
  assert.equal(report.candidate_selector_uses_legacy_selection, false);
  assert.equal(Object.hasOwn(report, 'legacy_record_selection_invoked'), false);
  assert.equal(report.pattern_parity_verified, false);
  assert.equal(report.live_graph_parity_verified, false);
  assert.equal(report.repository_default_graph_enabled, false);
  assert.equal(report.activation_performed, false);
  assert.equal(Object.hasOwn(report, 'eligible'), false);
  assert.equal(Object.hasOwn(report, 'activation_authorized'), false);
  assert.equal(Object.hasOwn(report, 'ids'), false);
  assert.equal(Object.hasOwn(report, 'records'), false);
});

test('P29 independent selector preserves request sizes and quotas, and is order deterministic', () => {
  const template = templates[0];
  const standardRequest = requestFor(template, 'standard');
  const deepRequest = requestFor(template, 'deep');
  const a = selectP29ProfileCandidateIds({ candidates, request: standardRequest });
  const b = selectP29ProfileCandidateIds({ candidates: [...candidates].reverse(), request: standardRequest });
  const d = selectP29ProfileCandidateIds({ candidates, request: deepRequest });
  assert.deepEqual(a, b);
  assert.equal(a.ids.length, 12);
  assert.equal(d.ids.length, 28);
  assert.equal(a.profile, 'standard');
  assert.equal(d.profile, 'deep');
  assert.equal(a.limit, 12);
  assert.equal(d.limit, 28);
  assert.equal(new Set(a.ids).size, a.ids.length);
  assert.equal(new Set(d.ids).size, d.ids.length);
  assert.equal(Object.hasOwn(a, 'records'), false);
  assert.equal(Object.hasOwn(d, 'records'), false);
});

test('P29 records mismatches when a valid but wrong primary stratum is supplied', () => {
  const changed = candidates.map(row => ({ ...row, primary_stratum: 'direct-domain' }));
  const report = compareP29OfflineProfileParity({ templates, candidates: changed, baseline, expectedReferenceDate: '2026-11-07' });
  assert.ok(report.mismatch_cases > 0);
  assert.ok(report.exact_order_cases < report.evaluated_cases);
  assert.equal(report.live_graph_parity_verified, false);
  assert.equal(report.activation_performed, false);
});

test('P29 rejects Quick, malformed requests, duplicated candidate ids and injected candidate fields', () => {
  const valid = requestFor(templates[0], 'standard');
  assert.throws(() => selectP29ProfileCandidateIds({
    candidates, request: { ...valid, profile: 'quick' },
  }), /profile|standard|deep/i);
  assert.throws(() => selectP29ProfileCandidateIds({
    candidates, request: { ...valid, limit: 7 },
  }), /limit/i);
  assert.throws(() => selectP29ProfileCandidateIds({
    candidates, request: { ...valid, unexpected: true },
  }), /request|unexpected|field/i);
  assert.throws(() => selectP29ProfileCandidateIds({
    candidates: [candidates[0], { ...candidates[0] }], request: valid,
  }), /candidate|duplicate/i);
  assert.throws(() => selectP29ProfileCandidateIds({
    candidates: [{ ...candidates[0], service_role_key: 'secret' }], request: valid,
  }), /candidate|unexpected|invalid/i);
});

test('P29 fails closed on inconsistent or untrusted baseline cases', () => {
  const invalid = structuredClone(baseline);
  invalid.cases.pop();
  assert.throws(() => compareP29OfflineProfileParity({ templates, candidates, baseline: invalid, expectedReferenceDate: '2026-11-07' }),
    /baseline|cases|missing/i);
  assert.throws(() => compareP29OfflineProfileParity({
    templates, candidates, expectedReferenceDate: '2026-11-07', baseline: { ...baseline, reference_date: '2026-11-06' },
  }), /date|baseline/i);
  assert.throws(() => compareP29OfflineProfileParity({
    templates, candidates, expectedReferenceDate: '2026-11-07', baseline: {
      ...baseline,
      cases: [{ ...baseline.cases[0], profile: 'quick' }, ...baseline.cases.slice(1)],
    },
  }), /baseline|profile|case/i);
});

test('P29 rejects a comparison without an independently pinned reference date', () => {
  assert.throws(() => compareP29OfflineProfileParity({
    templates, candidates, baseline,
  }), /expected.*date|reference.*date|pinned/i);
});

const cli = fileURLToPath(new URL('../../reference-graph/cli/p29-offline-profile-parity.mjs', import.meta.url));

test('P29 CLI compares 48 local Standard/Deep cases without claiming live routing parity', () => {
  const run = spawnSync(process.execPath, [cli, '--date', '2026-11-07'], {
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.evaluated_cases, 48);
  assert.equal(report.exact_order_cases, 48);
  assert.equal(report.mismatch_cases, 0);
  assert.equal(report.pattern_parity_verified, false);
  assert.equal(report.live_graph_parity_verified, false);
  assert.equal(report.repository_default_graph_enabled, false);
  assert.equal(report.activation_performed, false);
  assert.doesNotMatch(run.stdout, /canonicalUrl|search_text|service_role_key|\\"ids\\"/);
});

test('P29 CLI rejects absent or unpinned dates and activation switches', () => {
  for (const argv of [[], ['--date', '2026-02-30'], ['--date', '2026-11-07', '--activate']]) {
    const run = spawnSync(process.execPath, [cli, ...argv], {
      encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /P29 offline parity failed/i);
    assert.doesNotMatch(run.stderr, /canonicalUrl|search_text|service_role_key|\\.agents/);
  }
});
