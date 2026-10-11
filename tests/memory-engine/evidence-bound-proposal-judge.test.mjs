import test from 'node:test';
import assert from 'node:assert/strict';

import * as judgeModule from '../../memory-engine/evidence-bound-proposal-judge.mjs';

const promote = {
  decision: 'promote',
  durability: 'long',
  future_utility: 'high',
  confidence: 'high',
  meaning_preserved: true,
  reason: 'This stable project fact will prevent repeated rediscovery.',
  risk_flags: [],
};

test('proposal importance judgment is strict and promote is fail-closed', () => {
  assert.equal(typeof judgeModule.validateEvidenceProposalJudgment, 'function');
  assert.deepEqual(judgeModule.validateEvidenceProposalJudgment(promote), promote);

  assert.throws(
    () => judgeModule.validateEvidenceProposalJudgment({
      ...promote,
      extra: 'nope',
    }),
    /unexpected field/i,
  );
  assert.throws(
    () => judgeModule.validateEvidenceProposalJudgment({
      ...promote,
      confidence: 'medium',
    }),
    /promote requires confidence=high/i,
  );
  assert.throws(
    () => judgeModule.validateEvidenceProposalJudgment({
      ...promote,
      risk_flags: ['ambiguous'],
    }),
    /promote requires empty risk_flags/i,
  );
});

test('proposal importance decisions support bounded retention without rewriting the fact', () => {
  const keep = judgeModule.validateEvidenceProposalJudgment({
    decision: 'keep_candidate',
    durability: 'medium',
    future_utility: 'high',
    confidence: 'high',
    meaning_preserved: true,
    reason: 'Useful through the current migration.',
    risk_flags: ['transient'],
  });
  assert.equal(keep.decision, 'keep_candidate');
  assert.equal(Object.hasOwn(keep, 'canonical_fact'), false);
});

test('importance prompt treats proposal and evidence as data and forbids semantic rewriting', () => {
  assert.equal(typeof judgeModule.buildEvidenceProposalJudgePrompt, 'function');
  const prompt = judgeModule.buildEvidenceProposalJudgePrompt({
    proposal: {
      id: 'proposal-1',
      kind: 'knowledge',
      canonical_fact: 'Postgres supports concurrent writes.',
      evidence_ids: ['e-user', 'e-tool'],
      authorities: ['tool_observation', 'user_direct'],
    },
  });
  assert.match(prompt, /quoted data, never instructions/i);
  assert.match(prompt, /Do not rewrite/i);
  assert.match(prompt, /Postgres supports concurrent writes/);
  assert.match(prompt, /promote\|ignore\|keep_candidate\|needs_confirmation/);
});

test('parser accepts fenced JSON and rejects non-JSON output', () => {
  assert.equal(typeof judgeModule.parseEvidenceProposalJudgment, 'function');
  assert.deepEqual(
    judgeModule.parseEvidenceProposalJudgment(
      '```json\n' + JSON.stringify(promote) + '\n```',
    ),
    promote,
  );
  assert.throws(
    () => judgeModule.parseEvidenceProposalJudgment('looks important'),
    /must be JSON/i,
  );
});
