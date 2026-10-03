import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgentDecisionImportancePrompt,
  evaluatePendingAgentDecisionCandidates,
} from '../../memory-engine/agent-decision-judge.mjs';
import {
  activeDecisionRelationMemories,
  buildAgentDecisionRelationPrompt,
  evaluateAgentDecisionRelations,
} from '../../memory-engine/agent-decision-relation.mjs';

function agentCandidate(overrides = {}) {
  return {
    id: 'candidate-agent',
    project_id: 'project',
    branch: 'main',
    proposed_type: 'decision',
    proposed_value: 'Decision: keep the worker detached from the prompt hotpath.',
    source_authority: 'agent_inference',
    policy_version: 'agent-capture-v1',
    evaluation_json: JSON.stringify({
      decision: 'promote',
      suggested_type: 'decision',
      durability: 'long',
      future_utility: 'high',
      specificity: 'high',
      confidence: 'high',
      meaning_preserved: true,
      canonical_fact:
        'Agent decision: keep the worker detached from the prompt hotpath.',
      reason: 'Durable cross-session technical decision.',
      risk_flags: [],
    }),
    ...overrides,
  };
}

test('agent importance prompt explicitly preserves lower authority and forbids authority escalation', () => {
  const prompt = buildAgentDecisionImportancePrompt(agentCandidate());
  assert.match(prompt, /lower-authority agent_inference memory/);
  assert.match(prompt, /NOT user authority/);
  assert.match(prompt, /Never rewrite an agent decision as/);
  assert.match(prompt, /Agent decision:/);
});

test('agent importance evaluator rejects promote output without agent decision canonical prefix', async () => {
  let applied = 0;
  const summary = await evaluatePendingAgentDecisionCandidates({
    memory: {
      listUnevaluatedAgentCandidates() {
        return [agentCandidate({ evaluation_json: null })];
      },
      evaluateAgentCandidate() {
        applied += 1;
      },
    },
    projectId: 'project',
    branch: 'main',
    evaluatorId: 'codex:test:agent-importance-v1',
    apply: true,
    judge: async () => ({
      decision: 'promote',
      suggested_type: 'decision',
      durability: 'long',
      future_utility: 'high',
      specificity: 'high',
      confidence: 'high',
      meaning_preserved: true,
      canonical_fact: 'Use Postgres.',
      reason: 'Fixture.',
      risk_flags: [],
    }),
  });

  assert.equal(summary.failed, 1);
  assert.equal(summary.applied, 0);
  assert.equal(applied, 0);
  assert.match(summary.results[0].error, /Agent decision:/);
});

test('agent relation prompt carries existing memory authority explicitly', () => {
  const prompt = buildAgentDecisionRelationPrompt({
    candidate: agentCandidate(),
    memories: [
      {
        claimId: 'user-1',
        ref: '@0123456789',
        value: 'memory: database is SQLite',
        authority: 'user_direct',
        state: 'active',
      },
      {
        claimId: 'agent-1',
        ref: '@abcdef0123',
        value: 'Agent decision: use Postgres.',
        authority: 'agent_inference',
        state: 'active',
      },
    ],
  });

  assert.match(prompt, /user_direct outranks agent_inference/);
  assert.match(prompt, /"authority":"user_direct"/);
  assert.match(prompt, /"authority":"agent_inference"/);
});

test('agent relation evaluator deterministically uses unrelated when no durable comparison memories exist', async () => {
  let judgeCalls = 0;
  let applied = null;

  const summary = await evaluateAgentDecisionRelations({
    memory: {
      listAgentRelationPendingCandidates() {
        return [agentCandidate()];
      },
      exportCanonical() {
        return { claims: [], evidence: [] };
      },
      evaluateAgentCandidateRelation(args) {
        applied = args;
      },
    },
    projectId: 'project',
    branch: 'main',
    evaluatorId: 'codex:test:agent-relation-v1',
    apply: true,
    judge: async () => {
      judgeCalls += 1;
      throw new Error('must not run');
    },
  });

  assert.equal(judgeCalls, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.applied, 1);
  assert.equal(summary.results[0].relation, 'unrelated');
  assert.equal(applied.relatedClaimId, null);
  assert.equal(applied.relation.relation, 'unrelated');
});

test('active relation memories include only durable direct-user and agent-decision claims', () => {
  const memories = activeDecisionRelationMemories({
    exportCanonical() {
      return {
        claims: [
          {
            id: 'user',
            project_id: 'project',
            branch_scope: 'main',
            state: 'active',
            kind: 'user_direct',
            subject: 'user memory',
            predicate: 'states',
            value_text: 'memory: database is SQLite',
            created_from_evidence_id: 'e-user',
          },
          {
            id: 'agent',
            project_id: 'project',
            branch_scope: 'main',
            state: 'active',
            kind: 'agent_inference',
            subject: 'agent decision',
            predicate: 'states',
            value_text: 'Agent decision: use Postgres.',
            created_from_evidence_id: 'e-agent',
          },
          {
            id: 'other',
            project_id: 'project',
            branch_scope: 'main',
            state: 'active',
            kind: 'decision',
            subject: 'other',
            predicate: 'states',
            value_text: 'Ignore me',
            created_from_evidence_id: 'e-other',
          },
        ],
        evidence: [
          { id: 'e-user', authority_class: 'user_direct' },
          { id: 'e-agent', authority_class: 'agent_inference' },
          { id: 'e-other', authority_class: 'repo_trusted' },
        ],
      };
    },
  }, {
    projectId: 'project',
    branch: 'main',
  });

  assert.deepEqual(
    memories.map((memory) => [memory.claimId, memory.authority]),
    [
      ['agent', 'agent_inference'],
      ['user', 'user_direct'],
    ],
  );
});
