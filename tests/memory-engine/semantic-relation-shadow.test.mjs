import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  evaluateSemanticRelationShadowCases,
  buildMockSemanticRelationResponse,
  replaySemanticRelationShadowFixture,
} from '../../memory-engine/semantic-relation-shadow.mjs';

const ref = (id) => '@' + createHash('sha256').update(id).digest('hex').slice(0, 10);
const canonical = Object.freeze({
  claims: [
    { id: 'a', project_id: 'p', branch_scope: 'main', state: 'active', kind: 'decision', value_text: 'Windows hook dispatch uses encoded commands.', created_from_evidence_id: 'ea' },
    { id: 'b', project_id: 'p', branch_scope: 'main', state: 'active', kind: 'implementation', value_text: 'Encoded commands transport script bytes to PowerShell.', created_from_evidence_id: 'eb' },
    { id: 'c', project_id: 'p', branch_scope: 'main', state: 'active', kind: 'fact', value_text: 'Node 24 is the preferred test runtime.', created_from_evidence_id: 'ec' },
    { id: 'other', project_id: 'p', branch_scope: 'next', state: 'active', kind: 'fact', value_text: 'Not in same branch.', created_from_evidence_id: 'eo' },
    { id: 'rejected', project_id: 'p', branch_scope: 'main', state: 'rejected', kind: 'fact', value_text: 'Not current.', created_from_evidence_id: 'er' },
  ],
  evidence: [
    { id: 'ea', project_id: 'p', branch: 'main', authority_class: 'agent_inference' },
    { id: 'eb', project_id: 'p', branch: 'main', authority_class: 'agent_inference' },
    { id: 'ec', project_id: 'p', branch: 'main', authority_class: 'agent_inference' },
    { id: 'eo', project_id: 'p', branch: 'next', authority_class: 'agent_inference' },
    { id: 'er', project_id: 'p', branch: 'main', authority_class: 'agent_inference' },
  ],
});
const mkCase = (id = 'positive', overrides = {}) => ({
  id, projectId: 'p', branch: 'main', sourceClaimId: 'a',
  targetClaimIds: ['b', 'c'],
  expectedRelations: [{ relation: 'depends_on', targetClaimId: 'b' }],
  memory: { exportCanonical: () => structuredClone(canonical) },
  at: '2026-11-04T00:00:00.000Z',
  ...overrides,
});
const response = (relations) => JSON.stringify({ relations });
const edge = (relation, target = 'b') => ({ relation, target_ref: ref(target), confidence: 'high', reason: 'These claims are connected by an explicit implementation dependency.' });

test('D3 scores true/false/missing edges and negative controls without rewarding failures', async () => {
  let calls = 0;
  const inputs = [
    mkCase('correct'),
    mkCase('hard-negative', { expectedRelations: [] }),
    mkCase('missed'),
    mkCase('type-mismatch'),
    mkCase('invalid'),
  ];
  const result = await evaluateSemanticRelationShadowCases({ cases: inputs, judge: async ({ caseId }) => {
    calls += 1;
    if (caseId === 'correct') return response([edge('depends_on')]);
    if (caseId === 'hard-negative') return response([edge('supports', 'c')]);
    if (caseId === 'type-mismatch') return response([edge('implements')]);
    if (caseId === 'invalid') return 'not JSON';
    return response([]);
  }, clockMs: () => 5 });
  assert.equal(calls, 5);
  assert.equal(result.complete, false);
  assert.deepEqual(result.counts, {
    cases: 5, scored: 4, failed: 1, judgeCalls: 5, judgeFailures: 0, invalidResponses: 1, invalidContexts: 0,
    positiveCases: 3, negativeCases: 1, predictedCases: 3,
    truePositiveEdges: 1, falseEdges: 2, missingEdges: 2,
    correctNegatives: 0, negativeFalseCases: 1,
  });
  assert.equal(result.metrics.precision, 1 / 3);
  assert.equal(result.metrics.recall, 1 / 3);
  assert.equal(result.metrics.coverage, 3 / 4);
  assert.equal(result.metrics.negativeCaseFalsePositiveRate, 1);
  assert.equal(result.metrics.caseFailureRate, 1 / 5);
  assert.equal(result.cases[4].status, 'failed');
  assert.equal(result.cases[4].failureKind, 'invalid_response');
  assert.equal(result.cases[4].falseNegative, null);
  assert.equal(result.cases[3].falseEdges[0].relation, 'implements');
  assert.equal(result.cases[3].missingEdges[0].relation, 'depends_on');
});

test('D3 handles correct negatives and zero-positive precision as null, not invented success', async () => {
  const result = await evaluateSemanticRelationShadowCases({
    cases: [mkCase('negative', { expectedRelations: [] })],
    judge: async () => response([]),
  });
  assert.equal(result.counts.correctNegatives, 1);
  assert.equal(result.metrics.precision, null);
  assert.equal(result.metrics.recall, null);
  assert.equal(result.metrics.negativeCaseFalsePositiveRate, 0);
});

test('D3 empty target case skips judge entirely and remains auditable', async () => {
  const result = await evaluateSemanticRelationShadowCases({
    cases: [mkCase('empty', { targetClaimIds: [], expectedRelations: [] })],
    judge: async () => { throw Error('should not be called'); },
  });
  assert.equal(result.complete, true);
  assert.equal(result.counts.judgeCalls, 0);
  assert.equal(result.cases[0].judgeCalled, false);
});

test('D3 reports provider error as failure without leaking error text', async () => {
  const result = await evaluateSemanticRelationShadowCases({
    cases: [mkCase()], judge: async () => { throw Error('secret-password-in-provider-error'); },
  });
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.judgeFailures, 1);
  assert.equal(result.cases[0].failureKind, 'judge_error');
  assert.equal(result.counts.missingEdges, 0);
  assert.doesNotMatch(JSON.stringify(result), /secret-password/);
});

test('D3 rejects write attempts before judge invocation', async () => {
  let called = 0;
  await assert.rejects(evaluateSemanticRelationShadowCases({
    cases: [mkCase()], apply: true, judge: async () => { called++; },
  }), /read-only/);
  assert.equal(called, 0);
});

test('D3 never calls memory mutators or changes snapshot with hostile judge response', async () => {
  const initial = structuredClone(canonical);
  const writes = [];
  const memory = {
    exportCanonical: () => structuredClone(initial),
    saveTypedRelation: (...args) => writes.push(args),
    importTypedRelationsSidecar: (...args) => writes.push(args),
    recall: (...args) => writes.push(args),
  };
  const result = await evaluateSemanticRelationShadowCases({
    cases: [mkCase('hostile', { memory })],
    judge: async () => response([{ ...edge('depends_on'), authority: 'user_direct' }]),
  });
  assert.equal(result.counts.failed, 1);
  assert.deepEqual(writes, []);
  assert.deepEqual(initial, structuredClone(canonical));
});

test('D3 validates complete labels and duplicate/scoped targets before provider calls', async () => {
  const bad = [
    mkCase('bad-label', { expectedRelations: [{ relation: 'supersedes', targetClaimId: 'b' }] }),
    mkCase('bad-target', { targetClaimIds: ['b', 'b'] }),
    mkCase('bad-label-target', { expectedRelations: [{ relation: 'supports', targetClaimId: 'other' }] }),
    mkCase('bad-duplicate', { expectedRelations: [
      { relation: 'supports', targetClaimId: 'b' }, { relation: 'supports', targetClaimId: 'b' },
    ] }),
  ];
  for (const one of bad) {
    let calls = 0;
    await assert.rejects(evaluateSemanticRelationShadowCases({ cases: [one], judge: async () => { calls++; } }));
    assert.equal(calls, 0);
  }
});

test('D3 enforces finite sample cap and duplicate IDs', async () => {
  const duplicates = [mkCase('same'), mkCase('same')];
  await assert.rejects(evaluateSemanticRelationShadowCases({ cases: duplicates, judge: async () => response([]) }), /duplicate case/);
  const tooMany = Array.from({ length: 65 }, (_, i) => mkCase(`case-${i}`));
  await assert.rejects(evaluateSemanticRelationShadowCases({ cases: tooMany, judge: async () => response([]) }), /64/);
});

test('D3 invalid per-case canonical context is failed, no model call, no guessed negatives', async () => {
  const result = await evaluateSemanticRelationShadowCases({
    cases: [mkCase('wrong-scope', { targetClaimIds: ['other'], expectedRelations: [] })],
    judge: async () => { throw Error('not reached'); },
  });
  assert.equal(result.counts.judgeCalls, 0);
  assert.equal(result.counts.invalidContexts, 1);
  assert.equal(result.cases[0].failureKind, 'invalid_context');
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.correctNegatives, 0);
});

test('D3 usage and latency are optional and never fabricated', async () => {
  let now = 0;
  const result = await evaluateSemanticRelationShadowCases({
    cases: [mkCase('measured'), mkCase('unreported')],
    clockMs: () => { now += 11; return now; },
    judge: async ({ caseId }) => caseId === 'measured'
      ? { text: response([edge('depends_on')]), usage: { input_tokens: 15, output_tokens: 4 } }
      : response([]),
  });
  assert.equal(result.usage.reportedCases, 1);
  assert.deepEqual(result.usage.totals, { input_tokens: 15, output_tokens: 4, total_tokens: 19 });
  assert.equal(result.latency.measuredCases, 2);
  assert.equal(result.latency.meanMs, 11);
});

test('D3 invalid token usage fails closed without attributing successful prediction', async () => {
  const result = await evaluateSemanticRelationShadowCases({
    cases: [mkCase('bad-usage')],
    judge: async () => ({ text: response([edge('depends_on')]), usage: { total_tokens: -5 } }),
  });
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.truePositiveEdges, 0);
});

test('D3 deterministic mock fixture reproduces positive, negative and malformed response', async () => {
  const fixture = {
    format: 'agent-hub-semantic-relation-shadow-fixture', version: 1,
    cases: [
      { ...mkCase('positive'), canonical, memory: undefined, mockRelations: [{ relation: 'depends_on', targetClaimId: 'b', reason: 'Implementation relies on command transport.' }] },
      { ...mkCase('negative', { expectedRelations: [] }), canonical, memory: undefined, mockRelations: [] },
      { ...mkCase('broken'), canonical, memory: undefined, rawResponse: '```json\n{}\n```' },
    ],
  };
  const report = await replaySemanticRelationShadowFixture({ fixture, clockMs: () => 1 });
  assert.equal(report.counts.scored, 2);
  assert.equal(report.counts.failed, 1);
  assert.equal(report.counts.truePositiveEdges, 1);
  assert.equal(report.counts.correctNegatives, 1);
  assert.equal(report.counts.falseEdges, 0);
  assert.equal(report.complete, false);
});

test('D3 fixture refuses unexpected formats and raw response over budget', async () => {
  await assert.rejects(replaySemanticRelationShadowFixture({ fixture: { format: 'other', version: 1, cases: [] } }), /format/);
  const input = { format: 'agent-hub-semantic-relation-shadow-fixture', version: 1,
    cases: [{ ...mkCase('big'), canonical, rawResponse: 'x'.repeat(32769) }] };
  await assert.rejects(replaySemanticRelationShadowFixture({ fixture: input }), /rawResponse/);
});

test('D3 mock responder cannot produce forbidden lifecycle edges or out-of-bounds targets', () => {
  assert.throws(() => buildMockSemanticRelationResponse({ sourceClaimId: 'a', targetClaimIds: ['b'], mockRelations: [
    { relation: 'rejects', targetClaimId: 'b', reason: 'incorrect' },
  ] }), /invalid mock/);
  assert.throws(() => buildMockSemanticRelationResponse({ sourceClaimId: 'a', targetClaimIds: ['b'], mockRelations: [
    { relation: 'supports', targetClaimId: 'other', reason: 'incorrect' },
  ] }), /invalid mock/);
});

test('D3 counts valid usage for malformed judge output without awarding a scored edge', async () => {
  const result = await evaluateSemanticRelationShadowCases({ cases: [mkCase('failed-text')],
    judge: async () => ({ text: 'INVALID_JSON', usage: { input_tokens: 100, output_tokens: 7, total_tokens: 107 } }) });
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.invalidResponses, 1);
  assert.equal(result.usage.reportedCases, 1);
  assert.equal(result.usage.totals.total_tokens, 107);
  assert.equal(result.counts.truePositiveEdges, 0);
});

test('D3 rejects inconsistent provider usage as failed case', async () => {
  const result = await evaluateSemanticRelationShadowCases({ cases: [mkCase('usage-mismatch')],
    judge: async () => ({ text: response([edge('depends_on')]),
      usage: { input_tokens: 100, output_tokens: 7, total_tokens: 1 } }) });
  assert.equal(result.counts.failed, 1);
  assert.equal(result.usage.reportedCases, 0);
});


test('D3 usage totals never fabricate missing per-provider input/output counts', async () => {
  const result = await evaluateSemanticRelationShadowCases({
    cases: [mkCase('only-total'), mkCase('split-tokens')],
    judge: async ({ caseId }) => caseId === 'only-total'
      ? { text: response([]), usage: { total_tokens: 9 } }
      : { text: response([]), usage: { input_tokens: 4, output_tokens: 1 } },
  });
  assert.equal(result.complete, true);
  assert.equal(result.usage.reportedCases, 2);
  assert.deepEqual(result.usage.reportedFieldCases, {
    input_tokens: 1, output_tokens: 1, total_tokens: 2,
  });
  assert.deepEqual(result.usage.totals, {
    input_tokens: null, output_tokens: null, total_tokens: 14,
  });
});

test('D3 empty or internally inconsistent partial usage fails without rewarding the prediction', async () => {
  const result = await evaluateSemanticRelationShadowCases({
    cases: [mkCase('no-fields'), mkCase('bad-partial')],
    judge: async ({ caseId }) => ({
      text: response([edge('depends_on')]),
      usage: caseId === 'no-fields' ? {} : { input_tokens: 10, total_tokens: 4 },
    }),
  });
  assert.equal(result.counts.failed, 2);
  assert.equal(result.counts.truePositiveEdges, 0);
  assert.equal(result.counts.invalidResponses, 2);
  assert.equal(result.usage.reportedCases, 0);
  assert.equal(result.usage.totals, null);
});
