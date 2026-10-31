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
  findDeterministicAgentNearDuplicate,
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


test('near-duplicate guard closes only high-confidence same decision variants', () => {
  const memories = [{
    claimId: 'agent-existing',
    ref: '@abcdef0123',
    value: 'Agent decision: use PowerShell EncodedCommand for Windows hook dispatch.',
    authority: 'agent_inference',
    state: 'active',
  }];

  const duplicate = findDeterministicAgentNearDuplicate({
    canonicalFact:
      'Agent decision: use PowerShell EncodedCommand for Windows hook dispatch!',
    memories,
  });
  assert.equal(duplicate.memory.ref, '@abcdef0123');
  assert.equal(duplicate.reason, 'exact_normalized_match');

  const changedNumber = findDeterministicAgentNearDuplicate({
    canonicalFact:
      'Agent decision: use PowerShell EncodedCommand for Windows hook dispatch with 2 retries.',
    memories: [{
      ...memories[0],
      value:
        'Agent decision: use PowerShell EncodedCommand for Windows hook dispatch with 3 retries.',
    }],
  });
  assert.equal(changedNumber, null);

  const negated = findDeterministicAgentNearDuplicate({
    canonicalFact:
      'Agent decision: never use PowerShell EncodedCommand for Windows hook dispatch.',
    memories,
  });
  assert.equal(negated, null);
});

test('agent relation evaluator skips model call for deterministic near duplicate', async () => {
  let judgeCalls = 0;
  let applied = null;
  const candidate = agentCandidate({
    proposed_value:
      'Decision: use PowerShell EncodedCommand for Windows hook dispatch.',
    evaluation_json: JSON.stringify({
      decision: 'promote',
      suggested_type: 'decision',
      durability: 'long',
      future_utility: 'high',
      specificity: 'high',
      confidence: 'high',
      meaning_preserved: true,
      canonical_fact:
        'Agent decision: use PowerShell EncodedCommand for Windows hook dispatch.',
      reason: 'Durable hook convention.',
      risk_flags: [],
    }),
  });

  const summary = await evaluateAgentDecisionRelations({
    memory: {
      listAgentRelationPendingCandidates() {
        return [candidate];
      },
      exportCanonical() {
        return {
          claims: [{
            id: 'existing-agent',
            project_id: 'project',
            branch_scope: 'main',
            state: 'active',
            kind: 'agent_inference',
            subject: 'agent decision',
            predicate: 'states',
            value_text:
              'Agent decision: use PowerShell EncodedCommand for Windows hook dispatch!',
            created_from_evidence_id: 'e-agent',
          }],
          evidence: [{
            id: 'e-agent',
            authority_class: 'agent_inference',
          }],
        };
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
      throw new Error('near duplicate must not require model relation');
    },
  });

  assert.equal(judgeCalls, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.results[0].relation, 'same');
  assert.equal(summary.results[0].target_ref.length, 11);
  assert.equal(applied.relation.relation, 'same');
});

test('agent importance deterministically ignores clear low-value decisions before model judgment', async () => {
  let judgeCalls = 0;
  const applied = [];

  const candidates = [
    agentCandidate({
      id: 'candidate-test-status',
      proposed_value: 'Decision: tests are green now.',
      evaluation_json: null,
    }),
    agentCandidate({
      id: 'candidate-pr-status',
      proposed_value: 'Decision: PR #142 is merged and all checks are green now.',
      evaluation_json: null,
    }),
    agentCandidate({
      id: 'candidate-operational',
      proposed_value:
        'Decision: after changing Agent Hub memory runtime, run doctor-memory before continuing.',
      evaluation_json: null,
    }),
    agentCandidate({
      id: 'candidate-reconstructible',
      proposed_value:
        'Decision: keep using the package version currently recorded in package.json.',
      evaluation_json: null,
    }),
    agentCandidate({
      id: 'candidate-temporary',
      proposed_value:
        'Decision: use JSON Lines for this temporary smoke test only.',
      evaluation_json: null,
    }),
  ];

  const summary = await evaluatePendingAgentDecisionCandidates({
    memory: {
      listUnevaluatedAgentCandidates() {
        return candidates;
      },
      evaluateAgentCandidate(args) {
        applied.push(args);
      },
    },
    projectId: 'project',
    branch: 'main',
    evaluatorId: 'codex:test:agent-quality-ratchet',
    apply: true,
    judge: async (candidate) => {
      judgeCalls += 1;
      return {
        decision: 'promote',
        suggested_type: 'decision',
        durability: 'long',
        future_utility: 'high',
        specificity: 'high',
        confidence: 'high',
        meaning_preserved: true,
        canonical_fact:
          'Agent decision: '
          + candidate.proposed_value.replace(/^Decision:\s*/u, ''),
        reason: 'Fixture model would promote this candidate.',
        risk_flags: [],
      };
    },
  });

  assert.equal(judgeCalls, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.applied, 5);

  assert.deepEqual(
    summary.results.map((item) => item.decision),
    ['ignore', 'ignore', 'ignore', 'ignore', 'ignore'],
  );

  assert.deepEqual(
    applied.map((item) => item.evaluation.risk_flags),
    [
      ['transient'],
      ['transient'],
      ['possible_instruction'],
      ['reconstructible_from_repo'],
      ['transient'],
    ],
  );
});

test('agent quality ratchet still sends durable technical decisions to the model judge', async () => {
  let judgeCalls = 0;
  const applied = [];

  const summary = await evaluatePendingAgentDecisionCandidates({
    memory: {
      listUnevaluatedAgentCandidates() {
        return [
          agentCandidate({
            id: 'candidate-durable',
            proposed_value:
              'Decision: use Postgres for concurrent writers across future sessions.',
            evaluation_json: null,
          }),
        ];
      },
      evaluateAgentCandidate(args) {
        applied.push(args);
      },
    },
    projectId: 'project',
    branch: 'main',
    evaluatorId: 'codex:test:agent-quality-ratchet',
    apply: true,
    judge: async () => {
      judgeCalls += 1;
      return {
        decision: 'promote',
        suggested_type: 'decision',
        durability: 'long',
        future_utility: 'high',
        specificity: 'high',
        confidence: 'high',
        meaning_preserved: true,
        canonical_fact:
          'Agent decision: use Postgres for concurrent writers across future sessions.',
        reason: 'Durable cross-session architecture choice.',
        risk_flags: [],
      };
    },
  });

  assert.equal(judgeCalls, 1);
  assert.equal(summary.failed, 0);
  assert.equal(summary.applied, 1);
  assert.equal(summary.results[0].decision, 'promote');
  assert.equal(applied[0].evaluation.decision, 'promote');
});

test('agent quality ratchet does not treat durable scope words as transient state', async () => {
  let judgeCalls = 0;

  const candidates = [
    agentCandidate({
      id: 'candidate-ci-durable',
      proposed_value:
        'Decision: CI now uses Node 24 across future sessions.',
      evaluation_json: null,
    }),
    agentCandidate({
      id: 'candidate-temporary-environment-durable',
      proposed_value:
        'Decision: temporary staging environments use SQLite across future sessions.',
      evaluation_json: null,
    }),
  ];

  const summary = await evaluatePendingAgentDecisionCandidates({
    memory: {
      listUnevaluatedAgentCandidates() {
        return candidates;
      },
      evaluateAgentCandidate() {},
    },
    projectId: 'project',
    branch: 'main',
    evaluatorId: 'codex:test:agent-quality-ratchet',
    apply: false,
    judge: async (candidate) => {
      judgeCalls += 1;
      return {
        decision: 'promote',
        suggested_type: 'decision',
        durability: 'long',
        future_utility: 'high',
        specificity: 'high',
        confidence: 'high',
        meaning_preserved: true,
        canonical_fact:
          'Agent decision: '
          + candidate.proposed_value.replace(/^Decision:\s*/u, ''),
        reason: 'Durable future-session project choice.',
        risk_flags: [],
      };
    },
  });

  assert.equal(judgeCalls, 2);
  assert.equal(summary.failed, 0);
  assert.deepEqual(
    summary.results.map((item) => item.decision),
    ['promote', 'promote'],
  );
});
