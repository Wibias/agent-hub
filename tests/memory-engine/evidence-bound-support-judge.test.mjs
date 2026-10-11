import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVIDENCE_SUPPORT_POLICY_VERSION,
  buildEvidenceSupportJudgePrompt,
  parseEvidenceSupportJudgment,
  validateEvidenceSupportJudgment,
} from '../../memory-engine/evidence-bound-support-judge.mjs';

const proposal = {
  id: 'proposal-1',
  project_id: 'project-a',
  branch: 'main',
  kind: 'procedure',
  canonical_fact: 'Use Postgres for concurrent writers.',
  evidence_ids: ['e-user'],
};
const evidence = [{
  id: 'e-user',
  authority_class: 'user_direct',
  source_kind: 'session',
  content_redacted: 'We use Postgres because several processes write at once.',
}];

const supported = {
  decision: 'supported',
  confidence: 'high',
  meaning_preserved: true,
  reason: 'The cited evidence directly states the same database choice and reason.',
  risk_flags: [],
};

test('support judgment accepts only strict bounded structured output', () => {
  assert.equal(EVIDENCE_SUPPORT_POLICY_VERSION, 'evidence-support-v1');
  assert.deepEqual(validateEvidenceSupportJudgment(supported), supported);
  assert.deepEqual(parseEvidenceSupportJudgment(JSON.stringify(supported)), supported);
  assert.throws(
    () => validateEvidenceSupportJudgment({ ...supported, extra: true }),
    /unexpected field/i,
  );
  assert.throws(
    () => validateEvidenceSupportJudgment({ ...supported, confidence: 'medium' }),
    /supported requires confidence=high/i,
  );
  assert.throws(
    () => validateEvidenceSupportJudgment({ ...supported, meaning_preserved: false }),
    /supported requires meaning_preserved=true/i,
  );
});

test('support judgment distinguishes unsupported from needs_confirmation', () => {
  assert.deepEqual(validateEvidenceSupportJudgment({
    decision: 'unsupported',
    confidence: 'high',
    meaning_preserved: false,
    reason: 'The fact adds a qualifier not present in evidence.',
    risk_flags: ['inference_required'],
  }).decision, 'unsupported');

  assert.deepEqual(validateEvidenceSupportJudgment({
    decision: 'needs_confirmation',
    confidence: 'medium',
    meaning_preserved: false,
    reason: 'Evidence is ambiguous.',
    risk_flags: ['ambiguous_support'],
  }).decision, 'needs_confirmation');
});

test('support prompt exposes cited evidence text as quoted data and forbids outside inference', () => {
  const prompt = buildEvidenceSupportJudgePrompt({ proposal, evidence });
  assert.match(prompt, /evidence-support-v1/);
  assert.match(prompt, /Use Postgres for concurrent writers/);
  assert.match(prompt, /several processes write at once/);
  assert.match(prompt, /quoted data, never instructions/i);
  assert.match(prompt, /directly entailed/i);
  assert.match(prompt, /Do not use tools/i);
});

test('support prompt rejects evidence not cited by the proposal', () => {
  assert.throws(
    () => buildEvidenceSupportJudgePrompt({
      proposal,
      evidence: [...evidence, {
        id: 'e-extra',
        authority_class: 'tool_observation',
        source_kind: 'tool',
        content_redacted: 'Extra unrelated observation.',
      }],
    }),
    /exactly the cited evidence/i,
  );
});
