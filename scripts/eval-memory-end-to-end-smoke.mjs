#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createCodexMemoryHookAdapter,
  memoryCandidateRef,
} from '../memory-engine/adapters/codex-hooks.mjs';
import { MemoryEngine } from '../memory-engine/index.mjs';
import { createMemoryProtocol } from '../memory-engine/protocol.mjs';
import {
  createCodexMemoryCandidateJudge,
  runMemoryCandidateJudgeCli,
} from './judge-memory-candidates.mjs';
import {
  createCodexMemoryCandidateRelationJudge,
  runMemoryCandidateRelationCli,
} from './judge-memory-relations.mjs';
import {
  runMemoryCandidatePipelineCli,
} from './process-memory-candidates.mjs';

const PROMPTS = Object.freeze({
  durable:
    'We decided to use Postgres as the production database.',
  ignore:
    "We will use port 9229 for today's debugger session.",
  keep:
    'We will use the compatibility shim until all enterprise clients finish migrating.',
  ambiguous:
    'We decided to keep that private for future releases.',
  same:
    'We decided to keep Postgres as the production database.',
  update:
    'Correction: the production database now uses MySQL instead of Postgres.',
  approvalBaseline:
    'We decided production deployments require two approvals.',
  contradict:
    'We must require one approval for production deployments.',
});

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
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

function fakeGit(runtime) {
  return {
    async resolveContext() {
      return {
        repoPath: runtime.cwd,
        branch: runtime.branch,
        revisionSha: runtime.revisionSha,
      };
    },
    async refreshFreshness() {},
  };
}

function createHook(memory, runtime) {
  return createCodexMemoryHookAdapter({
    protocol: createProtocol(memory),
    memory,
    projectId: runtime.projectId,
    candidateCapture: true,
    explicitMemoryRequests: true,
    clock: () => '2026-10-03T00:00:00.000Z',
    git: fakeGit(runtime),
  });
}

async function submitHook(hook, prompt, turnId) {
  return hook.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'memory-e2e-smoke',
    turn_id: turnId,
    cwd: '/repo',
    prompt,
  });
}

function activeUserClaims(memory, runtime) {
  return memory.exportCanonical().claims.filter((claim) => (
    claim.project_id === runtime.projectId
    && claim.branch_scope === runtime.branch
    && claim.state === 'active'
    && claim.kind === 'user_direct'
    && claim.subject === 'user memory'
    && claim.predicate === 'states'
  ));
}

function scopedUserClaims(memory, runtime) {
  return memory.exportCanonical().claims.filter((claim) => (
    claim.project_id === runtime.projectId
    && claim.branch_scope === runtime.branch
    && claim.kind === 'user_direct'
    && claim.subject === 'user memory'
    && claim.predicate === 'states'
  ));
}

function candidateForPrompt(memory, runtime, prompt) {
  return memory.listScopedCandidates({
    projectId: runtime.projectId,
    branch: runtime.branch,
  }).find((candidate) => candidate.proposed_value === prompt) ?? null;
}

function importanceDecision(candidate) {
  if (!candidate?.evaluation_json) return null;
  try {
    return JSON.parse(candidate.evaluation_json)?.decision ?? null;
  } catch {
    return null;
  }
}

function recallValues(memory, runtime, query) {
  const recalled = memory.recall({
    projectId: runtime.projectId,
    branch: runtime.branch,
    query,
    mode: 'current',
    limit: 10,
  });
  return {
    values: recalled.items.map((item) => item.claim.value),
    conflicts: recalled.conflicts,
  };
}

function findMemory(memories, pattern, caseId) {
  const matches = memories.filter((item) => pattern.test(item.value));
  if (matches.length !== 1) {
    throw new Error(
      caseId + ' expected one relation target matching ' + pattern
      + ' but found ' + matches.length,
    );
  }
  return matches[0];
}

function deterministicImportanceJudgment(candidate) {
  const value = candidate.proposed_value;

  if (value === PROMPTS.ignore) {
    return {
      decision: 'ignore',
      suggested_type: candidate.proposed_type,
      durability: 'short',
      future_utility: 'low',
      specificity: 'high',
      confidence: 'high',
      meaning_preserved: true,
      canonical_fact: null,
      reason: 'Deterministic one-off E2E smoke fixture.',
      risk_flags: ['transient'],
    };
  }

  if (value === PROMPTS.keep) {
    return {
      decision: 'keep_candidate',
      suggested_type: candidate.proposed_type,
      durability: 'medium',
      future_utility: 'high',
      specificity: 'high',
      confidence: 'high',
      meaning_preserved: true,
      canonical_fact: value,
      reason: 'Deterministic bounded multi-session E2E smoke fixture.',
      risk_flags: ['transient'],
    };
  }

  if (value === PROMPTS.ambiguous) {
    return {
      decision: 'needs_confirmation',
      suggested_type: candidate.proposed_type,
      durability: 'long',
      future_utility: 'medium',
      specificity: 'low',
      confidence: 'medium',
      meaning_preserved: true,
      canonical_fact: null,
      reason: 'Deterministic scope-unclear E2E smoke fixture.',
      risk_flags: ['ambiguous', 'scope_unclear'],
    };
  }

  return {
    decision: 'promote',
    suggested_type: candidate.proposed_type,
    durability: 'long',
    future_utility: 'high',
    specificity: 'high',
    confidence: 'high',
    meaning_preserved: true,
    canonical_fact: value,
    reason: 'Deterministic durable E2E smoke fixture.',
    risk_flags: [],
  };
}

function deterministicRelationJudgment({ candidate, memories }) {
  const value = candidate.proposed_value;

  if (value === PROMPTS.same) {
    const target = findMemory(
      memories,
      /Postgres as the production database/i,
      'same',
    );
    return {
      relation: 'same',
      target_ref: target.ref,
      confidence: 'high',
      meaning_preserved: true,
      reason: 'Deterministic paraphrase E2E smoke fixture.',
    };
  }

  if (value === PROMPTS.update) {
    const target = findMemory(
      memories,
      /Postgres as the production database/i,
      'update',
    );
    return {
      relation: 'update',
      target_ref: target.ref,
      confidence: 'high',
      meaning_preserved: true,
      reason: 'Deterministic explicit replacement E2E smoke fixture.',
    };
  }

  if (value === PROMPTS.contradict) {
    const target = findMemory(
      memories,
      /production deployments require two approvals/i,
      'contradict',
    );
    return {
      relation: 'contradict',
      target_ref: target.ref,
      confidence: 'high',
      meaning_preserved: true,
      reason: 'Deterministic incompatible constraint E2E smoke fixture.',
    };
  }

  return {
    relation: 'unrelated',
    target_ref: null,
    confidence: 'high',
    meaning_preserved: true,
    reason: 'Deterministic unrelated E2E smoke fixture.',
  };
}

function createStageRunners({
  providerBacked,
  model,
  reasoningEffort,
  sourceCodexHome,
  env,
}) {
  let importanceJudgeCalls = 0;
  let relationJudgeCalls = 0;

  return {
    get calls() {
      return {
        importance: importanceJudgeCalls,
        relation: relationJudgeCalls,
      };
    },

    async runImportance(args) {
      return runMemoryCandidateJudgeCli({
        ...args,
        dependencies: {
          ...args.dependencies,
          async createJudge(options) {
            if (!providerBacked) {
              return {
                evaluatorId: 'e2e-smoke:importance-v2',
                isolation: { deterministicFixture: true },
                async judge(candidate) {
                  importanceJudgeCalls += 1;
                  return deterministicImportanceJudgment(candidate);
                },
                async close() {},
              };
            }

            const resource = await createCodexMemoryCandidateJudge({
              ...options,
              model,
              reasoningEffort,
              sourceCodexHome,
              env,
            });
            const judge = resource.judge;
            return {
              ...resource,
              async judge(candidate) {
                importanceJudgeCalls += 1;
                return judge(candidate);
              },
            };
          },
        },
      });
    },

    async runRelation(args) {
      return runMemoryCandidateRelationCli({
        ...args,
        dependencies: {
          ...args.dependencies,
          async createJudge(options) {
            if (!providerBacked) {
              return {
                evaluatorId: 'e2e-smoke:relation-v1',
                isolation: { deterministicFixture: true },
                async judge(input) {
                  relationJudgeCalls += 1;
                  return deterministicRelationJudgment(input);
                },
                async close() {},
              };
            }

            const resource = await createCodexMemoryCandidateRelationJudge({
              ...options,
              model,
              reasoningEffort,
              sourceCodexHome,
              env,
            });
            const judge = resource.judge;
            return {
              ...resource,
              async judge(input) {
                relationJudgeCalls += 1;
                return judge(input);
              },
            };
          },
        },
      });
    },
  };
}

function createChecker(checks) {
  return (id, condition, details = {}) => {
    const pass = Boolean(condition);
    checks.push({ id, pass, ...details });
    if (!pass) {
      throw new Error('E2E smoke check failed: ' + id);
    }
  };
}

export async function runMemoryEndToEndSmoke({
  providerBacked = false,
  model = null,
  reasoningEffort = 'medium',
  sourceCodexHome = (
    process.env.MEMORY_E2E_SMOKE_SOURCE_CODEX_HOME
    || process.env.CODEX_HOME
    || join(homedir(), '.codex')
  ),
  env = process.env,
} = {}) {
  if (typeof providerBacked !== 'boolean') {
    throw new TypeError('providerBacked must be a boolean');
  }
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
    throw new TypeError('reasoningEffort must be low, medium, or high');
  }
  if (providerBacked && !nonEmpty(sourceCodexHome)) {
    throw new TypeError('sourceCodexHome must be a non-empty string');
  }

  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-e2e-smoke-'));
  const dbPath = join(root, 'memory.sqlite3');
  const runtime = {
    cwd: process.cwd(),
    dbPath,
    projectId: 'e2e-smoke-project',
    branch: 'main',
    revisionSha: 'a'.repeat(40),
  };
  const memory = new MemoryEngine({ dbPath });
  const checks = [];
  const check = createChecker(checks);

  try {
    memory.registerProject({
      projectId: runtime.projectId,
      repoIdentity: runtime.projectId,
      createdAt: '2026-10-03T00:00:00.000Z',
    });

    const hook = createHook(memory, runtime);
    const stageRunners = createStageRunners({
      providerBacked,
      model,
      reasoningEffort,
      sourceCodexHome,
      env,
    });
    const createMemory = ({ dbPath: candidateDbPath }) => (
      new MemoryEngine({ dbPath: candidateDbPath })
    );
    const pipelineDependencies = {
      resolveRuntime: () => runtime,
      createMemory,
      runImportance: stageRunners.runImportance,
      runRelation: stageRunners.runRelation,
    };

    async function runPipeline() {
      return runMemoryCandidatePipelineCli({
        argv: [
          '--apply',
          '--limit', '20',
          '--reasoning-effort', reasoningEffort,
          ...(model ? ['--model', model] : []),
        ],
        cwd: runtime.cwd,
        log() {},
        dependencies: pipelineDependencies,
      });
    }

    async function capture(prompt, turnId) {
      await submitHook(hook, prompt, turnId);
      const candidate = candidateForPrompt(memory, runtime, prompt);
      check(
        turnId + '.captured',
        candidate !== null,
        { prompt },
      );
      return candidate;
    }

    // 1. New durable fact -> automatic durable memory.
    let candidate = await capture(PROMPTS.durable, 'durable');
    await runPipeline();
    candidate = memory.getCandidate(candidate.id);
    check('durable.promoted', candidate.status === 'promoted', {
      status: candidate.status,
      relation: candidate.relation,
    });
    check('durable.unrelated', candidate.relation === 'unrelated', {
      relation: candidate.relation,
    });
    check(
      'durable.one_active_claim',
      activeUserClaims(memory, runtime).length === 1,
      { active: activeUserClaims(memory, runtime).length },
    );

    const durableList = await submitHook(hook, 'memory list', 'durable-list');
    check(
      'durable.memory_list',
      durableList?.decision === 'block'
        && durableList.reason.includes(PROMPTS.durable),
    );
    let recalled = recallValues(
      memory,
      runtime,
      'production database Postgres',
    );
    check(
      'durable.recall',
      recalled.values.includes(PROMPTS.durable),
      { values: recalled.values },
    );

    // 2. One-off state -> ignored and never becomes a Claim.
    const beforeIgnoreClaims = scopedUserClaims(memory, runtime).length;
    candidate = await capture(PROMPTS.ignore, 'ignore');
    await runPipeline();
    candidate = memory.getCandidate(candidate.id);
    check('ignore.ignored', candidate.status === 'ignored', {
      status: candidate.status,
      decision: importanceDecision(candidate),
    });
    check(
      'ignore.no_claim',
      scopedUserClaims(memory, runtime).length === beforeIgnoreClaims,
    );

    // 3. Bounded multi-session -> keep_candidate -> visible -> explicit confirm.
    candidate = await capture(PROMPTS.keep, 'keep');
    let pipeline = await runPipeline();
    candidate = memory.getCandidate(candidate.id);
    check(
      'keep.review_backlog',
      candidate.status === 'pending'
        && importanceDecision(candidate) === 'keep_candidate',
      {
        status: candidate.status,
        decision: importanceDecision(candidate),
      },
    );
    check(
      'keep.pipeline_count',
      pipeline.final.kept_for_review === 1,
      { kept_for_review: pipeline.final.kept_for_review },
    );

    const keepListing = await submitHook(
      hook,
      'memory candidates',
      'keep-list',
    );
    const keepRef = memoryCandidateRef(candidate.id);
    check(
      'keep.visible',
      keepListing?.decision === 'block'
        && keepListing.reason.includes(keepRef)
        && /judge=keep_candidate/i.test(keepListing.reason),
    );

    const keepConfirm = await submitHook(
      hook,
      'memory candidate confirm: ' + keepRef + ' => unrelated',
      'keep-confirm',
    );
    candidate = memory.getCandidate(candidate.id);
    check(
      'keep.confirmed',
      keepConfirm?.decision === 'block'
        && candidate.status === 'promoted',
      { status: candidate.status },
    );
    check(
      'keep.exact_text_claim',
      activeUserClaims(memory, runtime).some(
        (claim) => claim.value === PROMPTS.keep,
      ),
    );

    // 4. Scope-unclear important fact -> needs_confirmation, no Claim.
    const beforeAmbiguousClaims = scopedUserClaims(memory, runtime).length;
    candidate = await capture(PROMPTS.ambiguous, 'ambiguous');
    pipeline = await runPipeline();
    candidate = memory.getCandidate(candidate.id);
    check(
      'ambiguous.needs_confirmation',
      candidate.status === 'needs_confirmation'
        && importanceDecision(candidate) === 'needs_confirmation',
      {
        status: candidate.status,
        decision: importanceDecision(candidate),
      },
    );
    check(
      'ambiguous.pipeline_count',
      pipeline.final.needs_confirmation === 1,
      { needs_confirmation: pipeline.final.needs_confirmation },
    );
    check(
      'ambiguous.no_claim',
      scopedUserClaims(memory, runtime).length === beforeAmbiguousClaims,
    );

    const ambiguousListing = await submitHook(
      hook,
      'memory candidates',
      'ambiguous-list',
    );
    check(
      'ambiguous.visible',
      ambiguousListing?.decision === 'block'
        && ambiguousListing.reason.includes(memoryCandidateRef(candidate.id))
        && /status=needs_confirmation/i.test(ambiguousListing.reason),
    );

    // 5. Paraphrase of active durable fact -> same, no duplicate Claim.
    const beforeSameActive = activeUserClaims(memory, runtime).length;
    candidate = await capture(PROMPTS.same, 'same');
    await runPipeline();
    candidate = memory.getCandidate(candidate.id);
    check(
      'same.superseded_candidate',
      candidate.status === 'superseded'
        && candidate.relation === 'same',
      { status: candidate.status, relation: candidate.relation },
    );
    check(
      'same.no_duplicate_claim',
      activeUserClaims(memory, runtime).length === beforeSameActive,
    );

    // 6. Explicit replacement -> update, old Claim superseded, recall uses new.
    candidate = await capture(PROMPTS.update, 'update');
    await runPipeline();
    candidate = memory.getCandidate(candidate.id);
    check(
      'update.promoted',
      candidate.status === 'promoted'
        && candidate.relation === 'update',
      { status: candidate.status, relation: candidate.relation },
    );

    const databaseClaims = scopedUserClaims(memory, runtime).filter(
      (claim) => /production database/i.test(claim.value),
    );
    const oldDatabase = databaseClaims.find(
      (claim) => claim.value === PROMPTS.durable,
    );
    const newDatabase = databaseClaims.find(
      (claim) => claim.value === PROMPTS.update,
    );
    check(
      'update.old_superseded',
      oldDatabase?.state === 'superseded'
        && oldDatabase.superseded_by_claim_id === newDatabase?.id,
      {
        old_state: oldDatabase?.state ?? null,
        superseded_by: oldDatabase?.superseded_by_claim_id ?? null,
        new_id: newDatabase?.id ?? null,
      },
    );
    check(
      'update.new_active',
      newDatabase?.state === 'active',
      { new_state: newDatabase?.state ?? null },
    );

    const updateList = await submitHook(hook, 'memory list', 'update-list');
    check(
      'update.memory_list_current_only',
      updateList?.reason.includes(PROMPTS.update)
        && !updateList.reason.includes(PROMPTS.durable),
    );
    recalled = recallValues(memory, runtime, 'production database MySQL');
    check(
      'update.recall_current_only',
      recalled.values.includes(PROMPTS.update)
        && !recalled.values.includes(PROMPTS.durable),
      { values: recalled.values },
    );

    // 7. Build a durable comparison Claim through the same pipeline.
    candidate = await capture(
      PROMPTS.approvalBaseline,
      'approval-baseline',
    );
    await runPipeline();
    candidate = memory.getCandidate(candidate.id);
    check(
      'contradict.baseline_promoted',
      candidate.status === 'promoted'
        && candidate.relation === 'unrelated',
      { status: candidate.status, relation: candidate.relation },
    );

    // 8. Incompatible durable constraint -> conflict, no silent winner.
    candidate = await capture(PROMPTS.contradict, 'contradict');
    await runPipeline();
    candidate = memory.getCandidate(candidate.id);
    check(
      'contradict.promoted',
      candidate.status === 'promoted'
        && candidate.relation === 'contradict',
      { status: candidate.status, relation: candidate.relation },
    );

    const deploymentClaims = activeUserClaims(memory, runtime).filter(
      (claim) => /production deployments/i.test(claim.value),
    );
    const deploymentIds = new Set(deploymentClaims.map((claim) => claim.id));
    const openConflicts = memory.exportCanonical().conflicts.filter(
      (conflict) => (
        conflict.project_id === runtime.projectId
        && conflict.state === 'open'
        && deploymentIds.has(conflict.claim_a)
        && deploymentIds.has(conflict.claim_b)
      ),
    );
    check(
      'contradict.both_active',
      deploymentClaims.length === 2,
      { active_deployment_claims: deploymentClaims.length },
    );
    check(
      'contradict.open_conflict',
      openConflicts.length === 1,
      { open_conflicts: openConflicts.length },
    );

    recalled = recallValues(
      memory,
      runtime,
      'production deployments approvals',
    );
    check(
      'contradict.recall_conflict_visible',
      recalled.conflicts.length >= 1,
      { recall_conflicts: recalled.conflicts.length },
    );

    // Final queues are drained except the intentionally unconfirmed candidate.
    pipeline = await runPipeline();
    check(
      'final.automatic_queues_empty',
      pipeline.final.importance_ready === 0
        && pipeline.final.relation_ready === 0
        && pipeline.final.promotion_ready === 0
        && pipeline.final.kept_for_review === 0
        && pipeline.final.needs_confirmation === 1,
      { final: pipeline.final },
    );

    const finalList = await submitHook(hook, 'memory list', 'final-list');
    check(
      'final.list_excludes_non_durable',
      !finalList.reason.includes(PROMPTS.ignore)
        && !finalList.reason.includes(PROMPTS.ambiguous)
        && finalList.reason.includes(PROMPTS.keep)
        && finalList.reason.includes(PROMPTS.update),
    );

    return {
      pass: checks.every((item) => item.pass),
      mode: providerBacked ? 'provider' : 'deterministic',
      model: providerBacked ? (model ?? 'codex-default') : 'deterministic',
      reasoning_effort: reasoningEffort,
      policies: {
        capture: 'capture-v1',
        importance: 'importance-v2',
        relation: 'relation-v1',
        promotion: 'promotion-v1',
        confirmation: 'confirmation-v2',
      },
      checks,
      judge_calls: stageRunners.calls,
      final: {
        active_claims: activeUserClaims(memory, runtime).length,
        scoped_claims: scopedUserClaims(memory, runtime).length,
        open_conflicts: memory.exportCanonical().conflicts.filter(
          (conflict) => (
            conflict.project_id === runtime.projectId
            && conflict.state === 'open'
          ),
        ).length,
        candidates: memory.listScopedCandidates({
          projectId: runtime.projectId,
          branch: runtime.branch,
        }).map((item) => ({
          status: item.status,
          relation: item.relation,
          importance: importanceDecision(item),
          value: item.proposed_value,
        })),
      },
    };
  } finally {
    memory.close();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const model = nonEmpty(process.env.MEMORY_E2E_SMOKE_MODEL)
    ? process.env.MEMORY_E2E_SMOKE_MODEL.trim()
    : null;
  const reasoningEffort = nonEmpty(
    process.env.MEMORY_E2E_SMOKE_REASONING_EFFORT,
  )
    ? process.env.MEMORY_E2E_SMOKE_REASONING_EFFORT.trim().toLowerCase()
    : 'medium';
  const sourceCodexHome = (
    process.env.MEMORY_E2E_SMOKE_SOURCE_CODEX_HOME
    || process.env.CODEX_HOME
    || join(homedir(), '.codex')
  );

  const result = await runMemoryEndToEndSmoke({
    providerBacked: true,
    model,
    reasoningEffort,
    sourceCodexHome,
    env: process.env,
  });

  for (const item of result.checks) {
    console.log(JSON.stringify({
      type: 'memory_e2e_smoke_check',
      ...item,
    }));
  }
  console.log(JSON.stringify({
    type: 'memory_e2e_smoke_summary',
    pass: result.pass,
    mode: result.mode,
    model: result.model,
    reasoning_effort: result.reasoning_effort,
    policies: result.policies,
    judge_calls: result.judge_calls,
    final: result.final,
  }));

  if (!result.pass) process.exitCode = 1;
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
