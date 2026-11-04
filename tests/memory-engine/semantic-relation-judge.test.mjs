import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  SEMANTIC_RELATION_POLICY_VERSION,
  buildSemanticRelationPrompt,
  parseSemanticRelationResponse,
  evaluateSemanticRelationsShadow,
} from '../../memory-engine/semantic-relation-judge.mjs';

const ref = id => '@' + createHash('sha256').update(id).digest('hex').slice(0, 10);
const canonical = {
  claims: [
    { id: 'windows-hooks', project_id: 'p', branch_scope: 'main', state: 'active', kind: 'agent_inference', value_text: 'Windows hook dispatch uses PowerShell EncodedCommand.', created_from_evidence_id: 'e1' },
    { id: 'powershell', project_id: 'p', branch_scope: 'main', state: 'active', kind: 'user_direct', value_text: 'PowerShell EncodedCommand encodes the execution payload.', created_from_evidence_id: 'e2' },
    { id: 'node-runtime', project_id: 'p', branch_scope: 'main', state: 'active', kind: 'agent_inference', value_text: 'Node 24 is used for Agent Hub scripts.', created_from_evidence_id: 'e3' },
    { id: 'other-branch', project_id: 'p', branch_scope: 'feature', state: 'active', kind: 'agent_inference', value_text: 'PowerShell EncodedCommand', created_from_evidence_id: 'e4' },
    { id: 'other-project', project_id: 'elsewhere', branch_scope: 'main', state: 'active', kind: 'agent_inference', value_text: 'PowerShell EncodedCommand', created_from_evidence_id: 'e5' },
    { id: 'rejected', project_id: 'p', branch_scope: 'main', state: 'rejected', kind: 'agent_inference', value_text: 'PowerShell EncodedCommand', created_from_evidence_id: 'e6' },
    { id: 'unsupported', project_id: 'p', branch_scope: 'main', state: 'active', kind: 'agent_inference', value_text: 'An unsupported implementation claim.', created_from_evidence_id: 'missing' },
  ],
  evidence: [
    { id: 'e1', project_id: 'p', branch: 'main', authority_class: 'agent_inference' },
    { id: 'e2', project_id: 'p', branch: 'main', authority_class: 'user_direct' },
    { id: 'e3', project_id: 'p', branch: 'main', authority_class: 'agent_inference' },
    { id: 'e4', project_id: 'p', branch: 'feature', authority_class: 'agent_inference' },
    { id: 'e5', project_id: 'elsewhere', branch: 'main', authority_class: 'agent_inference' },
    { id: 'e6', project_id: 'p', branch: 'main', authority_class: 'agent_inference' },
  ],
};
const scope = { canonical, projectId: 'p', branch: 'main', sourceClaimId: 'windows-hooks', targetClaimIds: ['powershell', 'node-runtime'] };
const valid = () => ({ relations: [{ relation: 'depends_on', target_ref: ref('powershell'), confidence: 'high', reason: 'Dispatch relies on an EncodedCommand payload.' }] });
const parse = (value, overrides = {}) => parseSemanticRelationResponse(JSON.stringify(value), { ...scope, ...overrides });

test('defines a separate semantic-relation policy and generates bounded, untrusted-data prompt', () => {
  assert.equal(SEMANTIC_RELATION_POLICY_VERSION, 'semantic-relation-v1');
  const prompt = buildSemanticRelationPrompt(scope);
  assert.match(prompt, /semantic-relation-v1/);
  assert.match(prompt, /untrusted quoted data/);
  assert.match(prompt, /do not infer.*(?:lifecycle|conflicts)/i);
  assert.match(prompt, new RegExp(ref('powershell')));
  assert.doesNotMatch(prompt, /"content_redacted"|"commit_sha"/);
  assert.match(prompt, /at most 3/);
});

test('accepts a high-confidence supported typed relation with canonical scoped endpoints', () => {
  const result = parse(valid());
  assert.equal(result.length, 1);
  assert.equal(result[0].source_claim_id, 'windows-hooks');
  assert.equal(result[0].target_claim_id, 'powershell');
  assert.equal(result[0].relation, 'depends_on');
  assert.equal(result[0].origin, 'inferred');
  assert.equal(result[0].advisory, true);
});

test('an empty answer means no relations and is the preferred fail-closed output', () => {
  assert.deepEqual(parse({ relations: [] }), []);
});

test('rejects low confidence and arbitrary extra attributes', () => {
  assert.throws(() => parse({ relations: [{ ...valid().relations[0], confidence: 'medium' }] }), /high confidence/);
  assert.throws(() => parse({ relations: [{ ...valid().relations[0], source_authority: 'user_direct' }] }), /unexpected field/);
  assert.throws(() => parse({ relations: [], authorized: true }), /unexpected field/);
});

test('rejects lifecycle or similarity edges even when a model claims high confidence', () => {
  for (const relation of ['supersedes', 'rejects', 'conflicts_with', 'semantic_similarity', 'contradict']) {
    assert.throws(() => parse({ relations: [{ ...valid().relations[0], relation }] }), /unsupported/);
  }
});

test('rejects unknown refs, source refs and targets not in the bounded candidate set', () => {
  for (const target_ref of [ref('missing'), ref('windows-hooks'), ref('other-branch'), ref('other-project')]) {
    assert.throws(() => parse({ relations: [{ ...valid().relations[0], target_ref }] }), /unknown or out-of-scope target_ref/);
  }
});

test('rejects more than three edges and duplicate target/relation pairs', () => {
  const edge = valid().relations[0];
  assert.throws(() => parse({ relations: [edge, edge, edge, edge] }), /at most 3/);
  assert.throws(() => parse({ relations: [edge, edge] }), /duplicate/);
});

test('rejects invalid or malformed JSON and markdown fenced responses', () => {
  assert.throws(() => parseSemanticRelationResponse('not json', scope), /JSON/);
  assert.throws(() => parseSemanticRelationResponse('```json\n{"relations":[]}\n```', scope), /JSON/);
  assert.throws(() => parse({ relations: 'no' }), /array/);
});

test('rejects missing evidence provenance, inactive target, cross-branch target and cross-project target at setup', () => {
  for (const targetClaimIds of [['unsupported'], ['rejected'], ['other-branch'], ['other-project']]) {
    assert.throws(() => buildSemanticRelationPrompt({ ...scope, targetClaimIds }), /evidence|active|scope/);
  }
});

test('rejects duplicate canonical claim identifiers and opaque ref collisions', () => {
  const broken = { ...canonical, claims: [...canonical.claims, { ...canonical.claims[0] }] };
  assert.throws(() => buildSemanticRelationPrompt({ ...scope, canonical: broken }), /ambiguous/);
});

test('rejects unbounded targets, duplicate targets and missing source support', () => {
  assert.throws(() => buildSemanticRelationPrompt({ ...scope, targetClaimIds: Array(13).fill('powershell') }), /at most 12/);
  assert.throws(() => buildSemanticRelationPrompt({ ...scope, targetClaimIds: ['powershell', 'powershell'] }), /duplicate/);
  assert.throws(() => buildSemanticRelationPrompt({ ...scope, sourceClaimId: 'unsupported', targetClaimIds: ['powershell'] }), /evidence/);
});

test('shadow evaluator calls the injected judge once, never persists anything', async () => {
  let calls = 0;
  const memory = { exportCanonical() { return structuredClone(canonical); } };
  const result = await evaluateSemanticRelationsShadow({ memory, ...scope, judge: async ({ prompt }) => {
    calls += 1;
    assert.match(prompt, /CURRENT_SOURCE_CLAIM/);
    return JSON.stringify(valid());
  } });
  assert.equal(calls, 1);
  assert.equal(result.relations.length, 1);
  assert.equal(result.policyVersion, 'semantic-relation-v1');
  assert.equal(result.mode, 'shadow');
});

test('shadow evaluator refuses apply=true, never creates a write path', async () => {
  const memory = { exportCanonical() { return structuredClone(canonical); } };
  await assert.rejects(evaluateSemanticRelationsShadow({ memory, ...scope, apply: true, judge: async () => JSON.stringify(valid()) }), /shadow-only/);
});

test('shadow evaluator does not call provider when there are no targets', async () => {
  const memory = { exportCanonical() { return structuredClone(canonical); } };
  let calls = 0;
  const result = await evaluateSemanticRelationsShadow({ memory, ...scope, targetClaimIds: [], judge: async () => { calls += 1; throw Error('not needed'); } });
  assert.equal(calls, 0);
  assert.deepEqual(result.relations, []);
});

test('no judge output can inject a user-direct claim or modify the input snapshot', () => {
  const before = structuredClone(canonical);
  assert.throws(() => parse({ relations: [{ ...valid().relations[0], claim: 'promote' }] }), /unexpected field/);
  assert.deepEqual(canonical, before);
});

test('active but temporally expired or future claims cannot participate in current semantic relations', () => {
  const expired = structuredClone(canonical);
  expired.claims[0].valid_until = '2026-11-01T00:00:00.000Z';
  assert.throws(() => buildSemanticRelationPrompt({ ...scope, canonical: expired, at: '2026-11-03T00:00:00.000Z' }), /current temporal/);

  const future = structuredClone(canonical);
  future.claims[1].valid_from = '2026-11-04T00:00:00.000Z';
  assert.throws(() => buildSemanticRelationPrompt({ ...scope, canonical: future, at: '2026-11-03T00:00:00.000Z' }), /current temporal/);
});

test('exact valid_from is included and exact valid_until is excluded', () => {
  const scoped = structuredClone(canonical);
  scoped.claims[0].valid_from = '2026-11-03T00:00:00.000Z';
  scoped.claims[0].valid_until = '2026-11-03T01:00:00.000Z';
  assert.doesNotThrow(() => buildSemanticRelationPrompt({ ...scope, canonical: scoped, at: '2026-11-03T00:00:00.000Z' }));
  assert.throws(() => buildSemanticRelationPrompt({ ...scope, canonical: scoped, at: '2026-11-03T01:00:00.000Z' }), /current temporal/);
});

test('accepted proposals retain exact source/target Evidence IDs and semantic policy provenance', () => {
  const [edge] = parse(valid());
  assert.deepEqual(edge.supporting_evidence_ids, ['e1', 'e2']);
  assert.equal(edge.policy_version, 'semantic-relation-v1');
  assert.equal(edge.advisory, true);
});

test('a claim cannot claim user_direct authority when its evidence identifies lower authority', () => {
  const poisoned = structuredClone(canonical);
  poisoned.evidence[0].authority_class = 'agent_inference';
  poisoned.claims[0].kind = 'user_direct';
  assert.throws(() => buildSemanticRelationPrompt({ ...scope, canonical: poisoned }), /evidence authority/);
});


test('D2 labels category-style claims by supporting Evidence authority, not claim.kind', () => {
  const typed = structuredClone(canonical);
  typed.claims[0].kind = 'decision';
  typed.claims[1].kind = 'decision';
  typed.evidence[0].authority_class = 'user_direct';
  typed.evidence[1].authority_class = 'agent_inference';
  const options = { ...scope, canonical: typed };
  const prompt = buildSemanticRelationPrompt(options);
  assert.match(prompt, /"authority":"user_direct"/);
  assert.match(prompt, /"authority":"agent_inference"/);
  assert.equal(parseSemanticRelationResponse(JSON.stringify(valid()), options).length, 1);
});
