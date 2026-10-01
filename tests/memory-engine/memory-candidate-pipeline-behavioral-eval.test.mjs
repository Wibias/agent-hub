import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MemoryEngine,
} from '../../memory-engine/index.mjs';
import {
  createCodexMemoryHookAdapter,
} from '../../memory-engine/adapters/codex-hooks.mjs';
import {
  createMemoryProtocol,
} from '../../memory-engine/protocol.mjs';
import {
  MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_CASES,
  runMemoryCandidatePipelineBehavioralCases,
  scoreMemoryCandidatePipelineBehavioralCase,
} from '../../memory-engine/memory-candidate-pipeline-behavioral-eval.mjs';
import {
  runMemoryCandidatePipelineCli,
} from '../../scripts/process-memory-candidates.mjs';
import {
  runMemoryCandidateJudgeCli,
} from '../../scripts/judge-memory-candidates.mjs';
import {
  runMemoryCandidateRelationCli,
} from '../../scripts/judge-memory-relations.mjs';

function createProject(memory, projectId = 'project') {
  memory.registerProject({
    projectId,
    repoIdentity: projectId,
    createdAt: '2026-10-02T00:00:00.000Z',
  });
}

function fakeGit(branch) {
  return {
    async resolveContext() {
      return {
        repoPath: '/repo',
        branch,
        revisionSha: 'a'.repeat(40),
      };
    },
    async refreshFreshness() {},
  };
}

function createProtocol(memory) {
  return createMemoryProtocol({
    memory,
    classifyAuthority(channel) {
      if (
        channel.sourceKind === 'session'
        && channel.metadata?.event_type === 'user_prompt'
      ) {
        return 'user_direct';
      }
      return 'unclassified';
    },
  });
}

async function submitPrompt({
  memory,
  projectId,
  branch,
  turnId,
  prompt,
}) {
  const adapter = createCodexMemoryHookAdapter({
    protocol: createProtocol(memory),
    memory,
    projectId,
    candidateCapture: true,
    explicitMemoryRequests: true,
    clock: () => '2026-10-02T00:00:00.000Z',
    git: fakeGit(branch),
  });

  return adapter.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'pipeline-behavioral-eval',
    turn_id: turnId,
    cwd: '/repo',
    prompt,
  });
}

function activeClaims(memory, {
  projectId,
  branch,
}) {
  return memory.exportCanonical().claims.filter((claim) => (
    claim.project_id === projectId
    && claim.branch_scope === branch
    && claim.state === 'active'
    && claim.kind === 'user_direct'
    && claim.subject === 'user memory'
    && claim.predicate === 'states'
  ));
}

function deterministicStageRunners() {
  let relationJudgeCalls = 0;

  return {
    get relationJudgeCalls() {
      return relationJudgeCalls;
    },

    async runImportance(args) {
      return runMemoryCandidateJudgeCli({
        ...args,
        dependencies: {
          ...args.dependencies,
          createJudge: async () => ({
            evaluatorId: 'eval:importance-v1',
            isolation: { deterministicFixture: true },
            async judge(candidate) {
              return {
                decision: 'promote',
                suggested_type: candidate.proposed_type,
                durability: 'long',
                future_utility: 'high',
                specificity: 'high',
                confidence: 'high',
                meaning_preserved: true,
                canonical_fact: candidate.proposed_value,
                reason: 'Deterministic behavioral-eval fixture.',
                risk_flags: [],
              };
            },
            async close() {},
          }),
        },
      });
    },

    async runRelation(args) {
      return runMemoryCandidateRelationCli({
        ...args,
        dependencies: {
          ...args.dependencies,
          createJudge: async () => ({
            evaluatorId: 'eval:relation-v1',
            isolation: { deterministicFixture: true },
            async judge({ memories }) {
              relationJudgeCalls += 1;
              assert.equal(memories.length, 1);
              return {
                relation: 'same',
                target_ref: memories[0].ref,
                confidence: 'high',
                meaning_preserved: true,
                reason: 'Deterministic paraphrase match fixture.',
              };
            },
            async close() {},
          }),
        },
      });
    },
  };
}

async function runDeterministicCase(caseSpec) {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-pipeline-eval-'));
  const dbPath = join(root, 'memory.sqlite3');
  const projectId = 'project';
  const memory = new MemoryEngine({ dbPath });
  createProject(memory, projectId);

  for (const [index, seed] of caseSpec.seed_memories.entries()) {
    const result = await submitPrompt({
      memory,
      projectId,
      branch: seed.branch,
      turnId: caseSpec.id + '-seed-' + index,
      prompt: seed.value,
    });
    assert.equal(result?.decision, 'block');
  }

  const beforeCurrent = activeClaims(memory, {
    projectId,
    branch: caseSpec.branch,
  }).length;
  const beforeOther = activeClaims(memory, {
    projectId,
    branch: caseSpec.other_branch,
  }).length;

  await submitPrompt({
    memory,
    projectId,
    branch: caseSpec.branch,
    turnId: caseSpec.id + '-candidate',
    prompt: caseSpec.prompt,
  });

  const candidate = memory.listScopedCandidates({
    projectId,
    branch: caseSpec.branch,
  }).find((item) => item.proposed_value === caseSpec.prompt);
  assert.ok(candidate, caseSpec.id + ' candidate must be captured');

  const runtime = {
    cwd: '/repo',
    dbPath,
    projectId,
    branch: caseSpec.branch,
    revisionSha: 'a'.repeat(40),
  };
  const stageRunners = deterministicStageRunners();
  const createMemory = ({ dbPath: candidateDbPath }) => (
    new MemoryEngine({ dbPath: candidateDbPath })
  );

  const first = await runMemoryCandidatePipelineCli({
    argv: ['--apply', '--limit', '10'],
    cwd: '/repo',
    log() {},
    dependencies: {
      resolveRuntime: () => runtime,
      createMemory,
      runImportance: stageRunners.runImportance,
      runRelation: stageRunners.runRelation,
    },
  });

  const afterCandidate = memory.getCandidate(candidate.id);
  const afterCurrent = activeClaims(memory, {
    projectId,
    branch: caseSpec.branch,
  }).length;
  const afterOther = activeClaims(memory, {
    projectId,
    branch: caseSpec.other_branch,
  }).length;

  const second = await runMemoryCandidatePipelineCli({
    argv: ['--apply', '--limit', '10'],
    cwd: '/repo',
    log() {},
    dependencies: {
      resolveRuntime: () => runtime,
      createMemory,
      runImportance: stageRunners.runImportance,
      runRelation: stageRunners.runRelation,
    },
  });

  const afterSecondCurrent = activeClaims(memory, {
    projectId,
    branch: caseSpec.branch,
  }).length;
  const afterSecondOther = activeClaims(memory, {
    projectId,
    branch: caseSpec.other_branch,
  }).length;

  const observed = {
    candidate_status: afterCandidate.status,
    relation: afterCandidate.relation,
    current_active_claim_delta: afterCurrent - beforeCurrent,
    other_active_claim_delta: afterOther - beforeOther,
    current_active_claims_after_second_run: afterSecondCurrent,
    other_active_claims_after_second_run: afterSecondOther,
    second_run_ready: {
      importance: second.final.importance_ready,
      relation: second.final.relation_ready,
      promotion: second.final.promotion_ready,
    },
    relation_judge_calls: stageRunners.relationJudgeCalls,
    first_run_failed_stages: first.stages
      .filter((stage) => stage.result?.summary?.failed > 0)
      .map((stage) => stage.name),
  };

  memory.close();
  return observed;
}

test('candidate pipeline behavioral fixture covers promotion, same dedupe, and branch isolation', () => {
  assert.deepEqual(
    MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_CASES.map((item) => ({
      id: item.id,
      relation: item.expected.relation,
      candidateStatus: item.expected.candidate_status,
      currentDelta: item.expected.current_active_claim_delta,
      otherDelta: item.expected.other_active_claim_delta,
    })),
    [
      {
        id: 'new-durable-fact',
        relation: 'unrelated',
        candidateStatus: 'promoted',
        currentDelta: 1,
        otherDelta: 0,
      },
      {
        id: 'same-existing-memory',
        relation: 'same',
        candidateStatus: 'superseded',
        currentDelta: 0,
        otherDelta: 0,
      },
      {
        id: 'cross-branch-isolation',
        relation: 'unrelated',
        candidateStatus: 'promoted',
        currentDelta: 1,
        otherDelta: 0,
      },
    ],
  );
});

test('candidate pipeline behavioral scorer rejects duplicate promotion or cross-branch mutation', () => {
  const caseSpec = MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_CASES[0];
  const good = {
    ...caseSpec.expected,
    current_active_claims_after_second_run: 1,
    other_active_claims_after_second_run: 0,
    second_run_ready: {
      importance: 0,
      relation: 0,
      promotion: 0,
    },
    relation_judge_calls: 0,
    first_run_failed_stages: [],
  };

  assert.deepEqual(
    scoreMemoryCandidatePipelineBehavioralCase(caseSpec, good),
    { pass: true, failures: [] },
  );

  const duplicate = scoreMemoryCandidatePipelineBehavioralCase(caseSpec, {
    ...good,
    current_active_claim_delta: 2,
    other_active_claim_delta: 1,
  });
  assert.equal(duplicate.pass, false);
  assert.ok(duplicate.failures.some((item) => /current_active_claim_delta/i.test(item)));
  assert.ok(duplicate.failures.some((item) => /other_active_claim_delta/i.test(item)));
});

test('deterministic fake judges drive real capture, relation, promotion, and idempotency paths', async () => {
  const result = await runMemoryCandidatePipelineBehavioralCases({
    cases: MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_CASES,
    runCase: runDeterministicCase,
  });

  assert.equal(result.pass, true);
  assert.equal(result.totalCases, 3);
  assert.equal(result.passedCases, 3);
  assert.equal(result.failedCases, 0);

  const byId = new Map(result.cases.map((item) => [item.id, item]));
  assert.equal(
    byId.get('new-durable-fact').observed.relation_judge_calls,
    0,
  );
  assert.equal(
    byId.get('same-existing-memory').observed.relation_judge_calls,
    1,
  );
  assert.equal(
    byId.get('cross-branch-isolation').observed.relation_judge_calls,
    0,
  );

  for (const item of result.cases) {
    assert.deepEqual(item.observed.second_run_ready, {
      importance: 0,
      relation: 0,
      promotion: 0,
    });
    assert.deepEqual(item.observed.first_run_failed_stages, []);
  }
});

test('manual provider-backed candidate pipeline eval runner imports without executing Codex', async () => {
  const runner = await import(
    '../../scripts/eval-codex-memory-candidate-pipeline.mjs'
  );
  assert.ok(runner && typeof runner === 'object');
});
