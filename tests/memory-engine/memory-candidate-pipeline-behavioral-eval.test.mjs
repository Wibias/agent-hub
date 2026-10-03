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
  canonicalizeGitRemote,
} from '../../memory-engine/adapters/codex-hook-cli.mjs';
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

function seedDurableMemory(memory, {
  projectId,
  branch,
  id,
  value,
}) {
  const stored = memory.ingest({
    evidence: {
      id: 'eval-seed-evidence-' + id,
      projectId,
      sourceKind: 'session',
      sourceRef: 'eval-seed:' + id,
      capturedAt: '2026-10-02T00:00:00.000Z',
      branch,
      content: value,
      authorityClass: 'user_direct',
      metadata: {
        behavioral_eval_seed: true,
      },
    },
    claim: {
      id: 'eval-seed-claim-' + id,
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value,
      branchScope: branch,
      createdAt: '2026-10-02T00:00:00.000Z',
    },
  });
  return stored.claim;
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

function lifecycleStats(memory, {
  projectId,
  branch,
}) {
  const exported = memory.exportCanonical();
  const scopedClaims = exported.claims.filter((claim) => (
    claim.project_id === projectId
    && claim.branch_scope === branch
    && claim.kind === 'user_direct'
    && claim.subject === 'user memory'
    && claim.predicate === 'states'
  ));
  const scopedClaimIds = new Set(scopedClaims.map((claim) => claim.id));

  return {
    current_superseded_claims_after_second_run: scopedClaims.filter(
      (claim) => claim.state === 'superseded',
    ).length,
    open_conflicts_after_second_run: exported.conflicts.filter((conflict) => (
      conflict.project_id === projectId
      && conflict.state === 'open'
      && scopedClaimIds.has(conflict.claim_a)
      && scopedClaimIds.has(conflict.claim_b)
    )).length,
    supersede_events_after_second_run: exported.lifecycle_events.filter(
      (event) => (
        event.project_id === projectId
        && event.action === 'supersede'
        && scopedClaimIds.has(event.source_claim_id)
        && scopedClaimIds.has(event.target_claim_id)
      ),
    ).length,
  };
}

function deterministicStageRunners(caseSpec) {
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
            evaluatorId: 'eval:importance-v2',
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
                relation: caseSpec.expected.relation,
                target_ref: memories[0].ref,
                confidence: 'high',
                meaning_preserved: true,
                reason: 'Deterministic behavioral relation fixture.',
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

  const seededClaims = [];
  for (const [index, seed] of caseSpec.seed_memories.entries()) {
    seededClaims.push(seedDurableMemory(memory, {
      projectId,
      branch: seed.branch,
      id: caseSpec.id + '-' + index,
      value: seed.value,
    }));
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
  const stageRunners = deterministicStageRunners(caseSpec);
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
  const promotion = memory.getCandidatePromotion(candidate.id);
  const target = seededClaims.find(
    (claim) => claim.branch_scope === caseSpec.branch,
  ) ?? null;
  const targetAfterFirst = target ? memory.getClaim(target.id) : null;
  const promotionClaim = promotion?.claim_id
    ? memory.getClaim(promotion.claim_id)
    : null;
  const openConflicts = memory.exportCanonical().conflicts.filter(
    (conflict) => (
      conflict.project_id === projectId
      && conflict.state === 'open'
    ),
  );
  const openConflictLinksTargetAndPromotionClaim = Boolean(
    targetAfterFirst
    && promotionClaim
    && openConflicts.some((conflict) => (
      [conflict.claim_a, conflict.claim_b].includes(targetAfterFirst.id)
      && [conflict.claim_a, conflict.claim_b].includes(promotionClaim.id)
    )),
  );

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
  const lifecycle = lifecycleStats(memory, {
    projectId,
    branch: caseSpec.branch,
  });

  const observed = {
    candidate_status: afterCandidate.status,
    relation: afterCandidate.relation,
    current_active_claim_delta: afterCurrent - beforeCurrent,
    other_active_claim_delta: afterOther - beforeOther,
    current_active_claims_after_second_run: afterSecondCurrent,
    other_active_claims_after_second_run: afterSecondOther,
    ...lifecycle,
    target_superseded_by_promotion_claim: Boolean(
      targetAfterFirst
      && promotionClaim
      && targetAfterFirst.superseded_by_claim_id === promotionClaim.id
    ),
    open_conflict_links_target_and_promotion_claim:
      openConflictLinksTargetAndPromotionClaim,
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

test('candidate pipeline behavioral fixture covers promotion, same, update, contradict, and branch isolation', () => {
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
        id: 'update-existing-memory',
        relation: 'update',
        candidateStatus: 'promoted',
        currentDelta: 0,
        otherDelta: 0,
      },
      {
        id: 'contradict-existing-memory',
        relation: 'contradict',
        candidateStatus: 'promoted',
        currentDelta: 1,
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

test('update and contradict fixtures require the correct lifecycle structure', () => {
  const update = MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_CASES.find(
    (item) => item.id === 'update-existing-memory',
  );
  const contradict = MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_CASES.find(
    (item) => item.id === 'contradict-existing-memory',
  );

  assert.deepEqual(
    {
      superseded: update?.expected.current_superseded_claims_after_second_run,
      openConflicts: update?.expected.open_conflicts_after_second_run,
      supersedeEvents: update?.expected.supersede_events_after_second_run,
    },
    {
      superseded: 1,
      openConflicts: 0,
      supersedeEvents: 1,
    },
  );
  assert.deepEqual(
    {
      superseded: contradict?.expected.current_superseded_claims_after_second_run,
      openConflicts: contradict?.expected.open_conflicts_after_second_run,
      supersedeEvents: contradict?.expected.supersede_events_after_second_run,
    },
    {
      superseded: 0,
      openConflicts: 1,
      supersedeEvents: 0,
    },
  );
});

test('update and contradict fixtures require exact target-to-promotion claim identity links', () => {
  const update = MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_CASES.find(
    (item) => item.id === 'update-existing-memory',
  );
  const contradict = MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_CASES.find(
    (item) => item.id === 'contradict-existing-memory',
  );

  assert.equal(
    update?.expected.target_superseded_by_promotion_claim,
    true,
  );
  assert.equal(
    contradict?.expected.open_conflict_links_target_and_promotion_claim,
    true,
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

  assert.equal(
    result.pass,
    true,
    JSON.stringify(result, null, 2),
  );
  assert.equal(result.totalCases, 5);
  assert.equal(result.passedCases, 5);
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
    byId.get('update-existing-memory').observed.relation_judge_calls,
    1,
  );
  assert.equal(
    byId.get('contradict-existing-memory').observed.relation_judge_calls,
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

test('manual provider-backed candidate pipeline eval uses a safe synthetic repository identity', async () => {
  const runner = await import(
    '../../scripts/eval-codex-memory-candidate-pipeline.mjs'
  );

  assert.equal(
    runner.MEMORY_CANDIDATE_PIPELINE_EVAL_REMOTE,
    'https://example.invalid/agent-hub/memory-candidate-eval.git',
  );
  assert.equal(
    canonicalizeGitRemote(runner.MEMORY_CANDIDATE_PIPELINE_EVAL_REMOTE),
    'example.invalid/agent-hub/memory-candidate-eval',
  );
});
