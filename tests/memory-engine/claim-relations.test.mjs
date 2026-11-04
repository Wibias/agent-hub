import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClaimRelationProposal, typedRelationKey } from '../../memory-engine/claim-relations.mjs';

const canonical = {
  claims: [
    { id: 'a', project_id: 'project-a', branch_scope: 'main', state: 'active' },
    { id: 'b', project_id: 'project-a', branch_scope: 'main', state: 'active' },
    { id: 'c', project_id: 'project-a', branch_scope: 'feature', state: 'active' },
    { id: 'd', project_id: 'project-b', branch_scope: 'main', state: 'active' },
    { id: 'e', project_id: 'project-a', branch_scope: 'main', state: 'superseded' },
  ],
};

const proposal = {
  projectId: 'project-a', branch: 'main',
  sourceClaimId: 'a', targetClaimId: 'b', relation: 'implements',
  confidence: 'high', reason: 'The first decision describes an implementation of the second.',
};

function expectInvalid(patch, pattern) {
  assert.throws(() => validateClaimRelationProposal(canonical, { ...proposal, ...patch }), pattern);
}

test('accepts a high-confidence, source-backed typed relation without authority escalation', () => {
  const result = validateClaimRelationProposal(canonical, proposal);
  assert.equal(result.relation, 'implements');
  assert.equal(result.source_claim_id, 'a');
  assert.equal(result.target_claim_id, 'b');
  assert.equal(result.origin, 'inferred');
  assert.equal(result.advisory, true);
  assert.match(result.key, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(result, 'authorized'), false);
});

test('rejects cross-branch and cross-project relations', () => {
  expectInvalid({ targetClaimId: 'c' }, /same project and branch/);
  expectInvalid({ targetClaimId: 'd' }, /same project and branch/);
});

test('rejects self edges, inactive claims and unknown claims', () => {
  expectInvalid({ targetClaimId: 'a' }, /distinct/);
  expectInvalid({ targetClaimId: 'e' }, /active/);
  expectInvalid({ targetClaimId: 'missing' }, /not found/);
});

test('does not let semantic inference mint lifecycle or conflict relationships', () => {
  for (const relation of ['supersedes', 'rejects', 'conflicts_with', 'semantic_similarity', 'contradict']) {
    expectInvalid({ relation }, /unsupported/);
  }
});

test('requires high-confidence supported inference; refuses arbitrary authority fields', () => {
  expectInvalid({ confidence: 'medium' }, /high confidence/);
  expectInvalid({ reason: ' ' }, /reason/);
  expectInvalid({ source_authority: 'user_direct' }, /unexpected field/);
  expectInvalid({ advisory: false }, /unexpected field/);
});

test('makes undirected related_to keys order-independent, but directed keys order-sensitive', () => {
  const forward = validateClaimRelationProposal(canonical, { ...proposal, relation: 'related_to' });
  const reverse = validateClaimRelationProposal(canonical, { ...proposal, relation: 'related_to', sourceClaimId: 'b', targetClaimId: 'a' });
  assert.equal(forward.key, reverse.key);
  assert.equal(forward.source_claim_id, 'a');
  assert.equal(reverse.source_claim_id, 'a');
  const a = typedRelationKey({ projectId: 'project-a', branch: 'main', sourceClaimId: 'a', targetClaimId: 'b', relation: 'supports' });
  const b = typedRelationKey({ projectId: 'project-a', branch: 'main', sourceClaimId: 'b', targetClaimId: 'a', relation: 'supports' });
  assert.notEqual(a, b);
});

test('scope supplied by the proposal must equal both canonical claim scopes', () => {
  expectInvalid({ branch: 'feature' }, /same project and branch/);
  expectInvalid({ projectId: 'project-b' }, /same project and branch/);
});
