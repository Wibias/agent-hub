import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  evaluateP62ReleaseReviewRecord,
  P62_MANDATORY_RELEASE_EVIDENCE,
  P62_MANDATORY_ROLLBACK_TRIGGERS,
} from '../../reference-graph/p62-release-review-preflight.mjs';

const HEAD = '5266fb224c3b413ec92d271f12be4c5e2b667034';
const now = new Date('2026-11-10T00:15:00.000Z');
const all = (names, fill) => Object.fromEntries(names.map((k, i) => [k, fill(i)]));
function record() {
  return {
    schema_version: 'reference-graph.p62-release-review-record.v1',
    repository: 'Wibias/agent-hub',
    repository_sha: HEAD,
    project_ref: 'vrznfnxzlxaavpqbzbzd',
    operator_id: 'approved_operator',
    operator_host_id: 'dedicated-server-1',
    owner_id: 'Wibias',
    independent_reviewer_id: 'independent_human',
    profiles: ['standard', 'deep'],
    canary_percent: 1,
    default_off: true,
    snapshot_date: '2026-11-10',
    refreshed_at: '2026-11-10T00:05:00.000Z',
    not_before: '2026-11-10T00:10:00.000Z',
    expires_at: '2026-11-10T00:50:00.000Z',
    evidence: all(P62_MANDATORY_RELEASE_EVIDENCE, i => String(i % 10).repeat(64)),
    human_approval: {
      reviewer_attestation_sha256: 'a'.repeat(64),
      owner_activation_decision_sha256: 'b'.repeat(64),
    },
    revocation: {
      nonce: 'P62SyntheticNonce00001',
      ledger_anchor_sha256: 'c'.repeat(64),
      rollback_plan_sha256: 'd'.repeat(64),
      rollback_triggers: [...P62_MANDATORY_ROLLBACK_TRIGGERS],
    },
  };
}
function check(r, overrides={}) {
  return evaluateP62ReleaseReviewRecord({ record:r, now, expectedRepositorySha: HEAD, ...overrides });
}

test('P62 even a perfectly shaped synthetic approval is NONAUTHORIZING', () => {
  const response=check(record());
  assert.equal(response.contract_valid,true);
  assert.equal(response.reason,'external-source-review-owner-and-revocation-trust-missing');
  for (const [key,value] of Object.entries(response)) {
    if (typeof value === 'boolean' && key !== 'contract_valid') assert.equal(value,false,key);
  }
  assert.equal(response.activation_authorized,false);
  assert.equal(response.runtime_controller_connected,false);
  assert.equal(response.repository_default_graph_enabled,false);
});

test('P62 rejects wrong repo/commit/project, unknown fields and incomplete records', () => {
  const changes=[
    r=>{r.repository='someone/other';},
    r=>{r.repository_sha='0'.repeat(40);},
    r=>{r.project_ref='other-project';},
    r=>{r.schema_version='reference-graph.p35-pr-lock.v1';},
    r=>{r.unknown_approval=true;},
    r=>{delete r.human_approval;},
    r=>{r.repository_sha='aaaaaaaa';},
  ];
  for(const mutate of changes){
    const r=record();mutate(r);
    assert.equal(check(r).contract_valid,false);
    assert.equal(check(r).activation_authorized,false);
  }
  assert.equal(check(record(),{expectedRepositorySha:'0'.repeat(40)}).contract_valid,false);
});

test('P62 requires independent identity and strict Standard/Deep-only scope', () => {
  const changes=[
    r=>{r.independent_reviewer_id='Wibias';},
    r=>{r.independent_reviewer_id=r.operator_id;},
    r=>{r.independent_reviewer_id='x';},
    r=>{r.owner_id='different_user';},
    r=>{r.profiles=['quick'];},
    r=>{r.profiles=['standard','standard'];},
    r=>{r.profiles=[];},
    r=>{r.canary_percent=0;},
    r=>{r.canary_percent=6;},
    r=>{r.canary_percent=1.25;},
    r=>{r.default_off=false;},
    r=>{r.operator_host_id='invalid host';},
  ];
  for(const mutate of changes){
    const r=record();mutate(r);
    const result=check(r);
    assert.equal(result.contract_valid,false,JSON.stringify(r));
    assert.equal(result.activation_authorized,false);
  }
});

test('P62 rejects stale, future, malformed, expired and excessive time windows', () => {
  const changes=[
    r=>{r.refreshed_at='2026-11-09T23:50:00.000Z';},
    r=>{r.snapshot_date='2026-11-09';},
    r=>{r.refreshed_at='not-utc';},
    r=>{r.not_before='2026-11-10T00:10:00+00:00';},
    r=>{r.expires_at='2026-11-10T00:10:00.000Z';},
    r=>{r.expires_at='2026-11-10T02:10:00.000Z';},
  ];
  for(const mutate of changes){
    const r=record();mutate(r);
    assert.equal(check(r).contract_valid,false);
  }
  assert.equal(check(record(),{now:new Date('2026-11-10T00:51:00.000Z')}).contract_valid,false);
  assert.equal(check(record(),{now:new Date('2026-11-10T00:08:00.000Z')}).contract_valid,false);
  assert.equal(check(record(),{now:new Date('invalid')}).contract_valid,false);
});

test('P62 rejects missing/fake evidence digests, unrecognized revoke triggers and nonce', () => {
  const changes=[
    r=>{delete r.evidence.p26_frozen_source_sha256;},
    r=>{r.evidence.protected_data_api_24h_sha256='pending';},
    r=>{r.evidence.rogue='1'.repeat(64);},
    r=>{delete r.human_approval.owner_activation_decision_sha256;},
    r=>{r.human_approval.owner_activation_decision_sha256='unapproved';},
    r=>{r.revocation.nonce='short';},
    r=>{r.revocation.ledger_anchor_sha256='invalid';},
    r=>{r.revocation.rollback_triggers.pop();},
    r=>{r.revocation.rollback_triggers.push('unknown');},
    r=>{r.revocation.rollback_triggers.push('manual-revoke');},
  ];
  for(const mutate of changes){
    const r=record();mutate(r);
    const result=check(r);
    assert.equal(result.contract_valid,false);
    assert.equal(result.activation_authorized,false);
  }
});

test('P62 policy stays offline and never imported into P11 or public query', () => {
  const auth=readFileSync(new URL('../../reference-graph/p62-release-review-preflight.mjs',import.meta.url),'utf8');
  const p11=readFileSync(new URL('../../reference-graph/p11-runtime-router.mjs',import.meta.url),'utf8');
  const publicCli=readFileSync(new URL('../../knowledge/design-references/scripts/query.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(p11,/p62-release-review-preflight|P62Release/);
  assert.doesNotMatch(publicCli,/p62-release-review-preflight|P62Release/);
  assert.doesNotMatch(auth,/globalThis\.fetch|fetch\(|process\.env|writeFileSync|child_process/);
  assert.ok(auth.includes('activation_authorized: false'));
  assert.ok(auth.includes('repository_default_graph_enabled: false'));
});
