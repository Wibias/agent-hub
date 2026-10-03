import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_DECISION_CAPTURE_POLICY_VERSION,
  agentDecisionFingerprint,
  classifyAgentDecisionMessage,
} from '../../memory-engine/agent-decision-capture.mjs';

test('captures explicit root-agent decisions and commitments', () => {
  const result = classifyAgentDecisionMessage([
    'Implemented the requested cleanup.',
    'Decision: use Postgres for concurrent writers.',
    'I will keep the worker detached from the prompt hotpath.',
  ].join('\n'));

  assert.equal(result.length, 2);
  assert.equal(result[0].type, 'decision');
  assert.equal(result[0].sourceAuthority, 'agent_inference');
  assert.equal(result[0].policyVersion, AGENT_DECISION_CAPTURE_POLICY_VERSION);
  assert.equal(result[0].value, 'Decision: use Postgres for concurrent writers.');
  assert.equal(
    result[1].value,
    'I will keep the worker detached from the prompt hotpath.',
  );
});

test('ignores tentative, interrogative, and ordinary progress text', () => {
  const result = classifyAgentDecisionMessage([
    'Maybe we should use Redis.',
    'Could we switch to Postgres?',
    'I ran the tests and they passed.',
    'The branch is green.',
  ].join('\n'));

  assert.deepEqual(result, []);
});

test('captures German explicit decisions', () => {
  const result = classifyAgentDecisionMessage([
    'Entscheidung: Wir verwenden SQLite nur für lokale Tests.',
    'Wir setzen auf Postgres für mehrere Writer.',
  ].join('\n'));

  assert.equal(result.length, 2);
  assert.match(result[0].value, /^Entscheidung:/);
  assert.match(result[1].value, /Postgres/);
});

test('caps candidates per assistant message and deduplicates normalized repeats', () => {
  const result = classifyAgentDecisionMessage([
    'Decision: use A.',
    'Decision:   use A.',
    'Decision: use B.',
    'Decision: use C.',
    'Decision: use D.',
  ].join('\n'));

  assert.deepEqual(
    result.map((item) => item.value),
    [
      'Decision: use A.',
      'Decision: use B.',
      'Decision: use C.',
    ],
  );
});

test('agent type namespaces fingerprints so root and subagent decisions do not collide', () => {
  const value = 'Decision: use Postgres.';
  assert.notEqual(
    agentDecisionFingerprint({ value, agentType: 'root' }),
    agentDecisionFingerprint({ value, agentType: 'reviewer' }),
  );
  assert.equal(
    agentDecisionFingerprint({ value, agentType: 'root' }),
    agentDecisionFingerprint({
      value: '  Decision:   use Postgres.  ',
      agentType: 'ROOT',
    }),
  );
});

test('secret-shaped decision text is not captured', () => {
  const token = 'gh' + 'p_' + 'abcdefghijklmnopqrstuvwxyz1234567890';
  const result = classifyAgentDecisionMessage(
    'Decision: use token=' + token + '.',
  );
  assert.deepEqual(result, []);
});
