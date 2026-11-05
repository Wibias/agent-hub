import assert from 'node:assert/strict';
import test from 'node:test';
import { auditRepositoryEvidence, isRepositoryEvidenceForAudit }
  from '../../memory-engine/memory-graph-d8-evidence-audit.mjs';

const PROJECT = 'github.com/example/d8';
const SHA = 'a'.repeat(40);
const OID = 'b'.repeat(40);
const repo = (id, branch = 'main', changes = {}) => ({
  id, project_id: PROJECT, branch, source_kind: 'repository',
  authority_class: 'repo_trusted', path: 'src/main.js', blob_oid: OID,
  commit_sha: SHA, source_ref: 'PRIVATE_SOURCE_REF', content_redacted: 'PRIVATE_EVIDENCE', ...changes,
});
const session = (id, branch = 'main') => ({
  id, project_id: PROJECT, branch, source_kind: 'session',
  authority_class: 'user_direct', path: null, blob_oid: null,
  source_ref: 'session:SECRET', content_redacted: 'PRIVATE_EVIDENCE',
});
const claim = (id, evidenceId, branch = 'main', state = 'active', time = '2026-11-04T00:00:00Z') => ({
  id, project_id: PROJECT, branch_scope: branch, state, created_from_evidence_id: evidenceId,
  created_at: time, value_text: 'PRIVATE_CLAIM',
});
const fixture = (evidence = [], claims = [], claim_evidence = []) => ({
  projects: [{ project_id: PROJECT }], evidence, claims, claim_evidence,
});
const audit = (data, branch = 'main') => auditRepositoryEvidence(data, { projectId: PROJECT, branch });

test('D8 distinguishes absent repository Evidence from missing Git freshness', () => {
  const data = fixture([session('s')], [claim('c', 's')]);
  const result = audit(data);
  assert.equal(result.outcome, 'blocked');
  assert.equal(result.nextStep, 'no_repository_evidence_recorded');
  assert.equal(result.claims.inScope, 1);
  assert.equal(result.claims.repositoryPrimaryInScope, 0);
  assert.equal(result.evidence.repositoryMarkedInScope, 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|src\/main|session:SECRET/);
});

test('D8 attributes repository Evidence without primary claims to non-primary linkage', () => {
  const data = fixture([session('s'), repo('r')], [claim('c', 's')], [
    { claim_id: 'c', evidence_id: 'r', role: 'supporting' },
  ]);
  const result = audit(data);
  assert.equal(result.nextStep, 'repository_evidence_not_primary_for_selected_scope');
  assert.equal(result.evidence.repositoryMarkedWithoutPrimaryClaim, 1);
  assert.equal(result.evidence.repositoryMarkedSupportingOnly, 1);
  assert.equal(result.claims.repositoryPrimaryInScope, 0);
});

test('D8 recognizes repository-backed claims on another branch without inferring freshness', () => {
  const data = fixture([session('s'), repo('r', 'feature/x')], [
    claim('c', 's'), claim('rclaim', 'r', 'feature/x'),
  ]);
  const result = audit(data);
  assert.equal(result.claims.repositoryPrimaryOtherBranches, 1);
  assert.equal(result.nextStep, 'repository_claims_only_on_other_branches');
  assert.equal(result.evidence.repositoryMarkedOtherBranches, 1);
});

test('D8 distinguishes repository primary claims hidden by the 500-node bound', () => {
  const claims = Array.from({ length: 500 }, (_, n) =>
    claim(`s${n}`, 's', 'main', 'active', '2026-11-05T00:00:00Z'));
  claims.push(claim('rclaim', 'r', 'main', 'active', '2026-11-01T00:00:00Z'));
  const result = audit(fixture([session('s'), repo('r')], claims));
  assert.equal(result.claims.inScope, 501);
  assert.equal(result.claims.visibleAtGraphBound, 500);
  assert.equal(result.claims.repositoryPrimaryInScope, 1);
  assert.equal(result.claims.repositoryPrimaryBeyondBound, 1);
  assert.equal(result.nextStep, 'repository_claims_beyond_graph_limit');
});

test('D8 identifies candidate coverage without calling it verified Git freshness', () => {
  const result = audit(fixture([repo('r')], [claim('c', 'r')]));
  assert.equal(result.outcome, 'ready_for_d7_live');
  assert.equal(result.nextStep, 'run_d7_live_on_matching_checkout');
  assert.equal(result.claims.repositoryVisibleActiveWithCompleteEvidence, 1);
  assert.ok(result.notes.includes('counts_only_no_repository_freshness_claimed'));
});

test('D8 blocks incomplete or historical repository Evidence as live prerequisites', () => {
  const broken = audit(fixture([repo('r', 'main', { blob_oid: null, path: '../secrets' })], [claim('c', 'r')]));
  assert.equal(broken.outcome, 'blocked');
  assert.equal(broken.claims.repositoryVisibleIncompleteEvidence, 1);
  assert.equal(broken.nextStep, 'review_repository_evidence_metadata_and_state');
  const inactive = audit(fixture([repo('r')], [claim('c', 'r', 'main', 'superseded')]));
  assert.equal(inactive.outcome, 'blocked');
});

test('D8 blocks each malformed repository Evidence field independently', () => {
  const cases = [
    { field: 'path', change: { path: '../secrets' } },
    { field: 'blob_oid', change: { blob_oid: 'not-an-oid' } },
    { field: 'commit_sha', change: { commit_sha: 'short' } },
    { field: 'branch', change: { branch: 'feature/x' } },
  ];
  for (const { field, change } of cases) {
    const result = audit(fixture([repo('r', 'main', change)], [claim('c', 'r')]));
    assert.equal(result.outcome, 'blocked', field);
    assert.equal(result.claims.repositoryVisibleIncompleteEvidence, 1, field);
    assert.equal(result.nextStep, 'review_repository_evidence_metadata_and_state', field);
  }
});

test('D8 reports missing/mismatched primary evidence without exposing identifiers', () => {
  const data = fixture([session('s', 'feature/x')], [claim('a', 'nonexistent'), claim('b', 's')]);
  const result = audit(data);
  assert.equal(result.claims.missingPrimaryEvidence, 1);
  assert.equal(result.claims.primaryEvidenceWrongBranch, 1);
  assert.doesNotMatch(JSON.stringify(result), /nonexistent|PRIVATE|feature\/x/);
});

test('D8 conservatively detects all graph-v2 repository markers', () => {
  assert.equal(isRepositoryEvidenceForAudit({ source_kind: 'git_commit' }), true);
  assert.equal(isRepositoryEvidenceForAudit({ authority_class: 'repo_trusted' }), true);
  assert.equal(isRepositoryEvidenceForAudit({ path: 'file' }), true);
  assert.equal(isRepositoryEvidenceForAudit({ blob_oid: OID }), true);
  assert.equal(isRepositoryEvidenceForAudit({ source_kind: 'session', path: null }), false);
});

test('D8 requires an explicit registered scope and canonical export', () => {
  assert.throws(() => auditRepositoryEvidence(null, { projectId: PROJECT, branch: 'main' }), TypeError);
  assert.throws(
    () => auditRepositoryEvidence(fixture(), { projectId: 'github.com/example/unregistered', branch: 'main' }),
    /scope not registered/,
  );
  assert.equal(audit(fixture()).claims.inScope, 0);
});
