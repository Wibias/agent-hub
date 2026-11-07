import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadRecords, TAXONOMY } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP8OfflineQuickCandidatePool } from '../../reference-graph/p8-cutover-review.mjs';
import {
  auditP28ProfileCandidateContract,
  buildP28OfflineProfileCandidatePool,
} from '../../reference-graph/p28-profile-candidate-contract.mjs';

const now = new Date('2026-11-07T00:00:00.000Z');
const records = loadRecords();
const p10EquivalentOffline = buildP8OfflineQuickCandidatePool(records, { now });

test('P28 current Quick projection is missing primary_stratum and cannot pass Standard/Deep metadata contract', () => {
  const report = auditP28ProfileCandidateContract({ candidates: p10EquivalentOffline });
  assert.equal(report.schema_version, 'reference-graph.p28-profile-candidate-audit.v1');
  assert.equal(report.metadata_contract_complete, false);
  assert.equal(report.graph_parity_verified, false);
  assert.equal(report.repository_default_graph_enabled, false);
  assert.equal(report.activation_performed, false);
  assert.ok(report.candidate_count > 0);
  assert.deepEqual(report.blockers, ['missing-primary-stratum']);
  assert.equal(report.candidate_count, p10EquivalentOffline.length);
  assert.equal(Object.hasOwn(report, 'eligible'), false);
});

test('P28 extended offline projection retains all P8 candidates and adds exact source primary stratum', () => {
  const result = buildP28OfflineProfileCandidatePool({ records, now });
  const byId = new Map(records.map(record => [record.id, record]));
  assert.equal(result.length, p10EquivalentOffline.length);
  assert.deepEqual(
    result.map(row => row.legacy_id),
    p10EquivalentOffline.map(row => row.legacy_id),
  );
  for (const row of result) {
    assert.equal(row.primary_stratum, byId.get(row.legacy_id).primaryStratum);
    assert.ok(Object.hasOwn(TAXONOMY.primaryStrata, row.primary_stratum));
    assert.equal(Object.hasOwn(row, '__file'), false);
    assert.equal(Object.hasOwn(row, 'canonicalUrl'), false);
    assert.equal(Object.hasOwn(row, 'service_role_key'), false);
  }
  const report = auditP28ProfileCandidateContract({ candidates: result });
  assert.equal(report.metadata_contract_complete, true);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.graph_parity_verified, false);
  assert.equal(report.activation_performed, false);
  assert.equal(report.repository_default_graph_enabled, false);
  assert.match(report.ordered_candidate_ids_sha256, /^[0-9a-f]{64}$/);
  assert.equal(
    Object.values(report.stratum_counts).reduce((total, count) => total + count, 0),
    result.length,
  );
});

test('P28 extended offline projection is stable independent of source record order', () => {
  const left = buildP28OfflineProfileCandidatePool({ records, now });
  const right = buildP28OfflineProfileCandidatePool({ records: [...records].reverse(), now });
  assert.deepEqual(left, right);
  assert.deepEqual(
    auditP28ProfileCandidateContract({ candidates: left }),
    auditP28ProfileCandidateContract({ candidates: right }),
  );
});

test('P28 audit rejects unknown or malformed strata, duplicate ids, and injected unexpected fields', () => {
  const base = buildP28OfflineProfileCandidatePool({ records, now });
  const duplicate = [...base, { ...base[0] }];
  const missing = base.map((row, index) => index === 0 ? { ...row, primary_stratum: undefined } : row);
  const invalid = base.map((row, index) => index === 0 ? { ...row, primary_stratum: 'fake-quota' } : row);
  const injected = base.map((row, index) => index === 0 ? { ...row, service_role_key: 'not-allowed' } : row);
  assert.ok(auditP28ProfileCandidateContract({ candidates: duplicate }).blockers.includes('duplicate-candidate-identity'));
  assert.ok(auditP28ProfileCandidateContract({ candidates: missing }).blockers.includes('missing-primary-stratum'));
  assert.ok(auditP28ProfileCandidateContract({ candidates: invalid }).blockers.includes('invalid-primary-stratum'));
  assert.ok(auditP28ProfileCandidateContract({ candidates: injected }).blockers.includes('unexpected-candidate-fields'));
  for (const candidates of [duplicate, missing, invalid, injected]) {
    assert.equal(auditP28ProfileCandidateContract({ candidates }).metadata_contract_complete, false);
  }
});

test('P28 rejects non-arrays, duplicate record id provenance and invalid dates before projection', () => {
  assert.throws(() => auditP28ProfileCandidateContract({ candidates: null }), /candidates/i);
  assert.throws(() => auditP28ProfileCandidateContract({ candidates: [] }), /non.empty|candidate/i);
  assert.throws(
    () => buildP28OfflineProfileCandidatePool({ records: [...records, { ...records[0] }], now }),
    /duplicate/i,
  );
  assert.throws(() => buildP28OfflineProfileCandidatePool({ records, now: new Date('invalid') }), /date|now/i);
});

test('P28 documents the real P10 migration gap, without changing P10 implementation', () => {
  const ddl = readFileSync('reference-graph/schema/009_reference_graph_runtime_projection.sql', 'utf8');
  const client = readFileSync('reference-graph/p10-runtime-client.mjs', 'utf8');
  assert.match(ddl, /reference_graph_quick_runtime_projection_p10/);
  assert.doesNotMatch(ddl, /\bprimary_stratum\b/);
  assert.doesNotMatch(client, /['"]primary_stratum['"]/);
});
