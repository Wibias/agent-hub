#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createCodexMemoryHookAdapter,
} from '../memory-engine/adapters/codex-hooks.mjs';
import {
  MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_CASES,
  runMemoryCandidatePipelineBehavioralCases,
} from '../memory-engine/memory-candidate-pipeline-behavioral-eval.mjs';
import {
  MemoryEngine,
} from '../memory-engine/index.mjs';
import {
  createMemoryProtocol,
} from '../memory-engine/protocol.mjs';
import {
  createCodexMemoryCandidateJudge,
  resolveMemoryCandidateJudgeRuntime,
  runMemoryCandidateJudgeCli,
} from './judge-memory-candidates.mjs';
import {
  createCodexMemoryCandidateRelationJudge,
  runMemoryCandidateRelationCli,
} from './judge-memory-relations.mjs';
import {
  runMemoryCandidatePipelineCli,
} from './process-memory-candidates.mjs';

export const MEMORY_CANDIDATE_PIPELINE_EVAL_REMOTE =
  'https://example.invalid/agent-hub/memory-candidate-eval.git';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function runProcess(command, args, {
  cwd,
  env = process.env,
  input = null,
  timeoutMs = 30_000,
} = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGTERM');
      } catch {}
      reject(new Error(
        command + ' timed out after ' + timeoutMs + 'ms',
      ));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        code,
        signal,
        stdout,
        stderr,
      });
    });

    if (input === null) child.stdin.end();
    else child.stdin.end(input);
  });
}

async function runGit(workspace, args, env) {
  const result = await runProcess('git', args, {
    cwd: workspace,
    env,
  });
  if (result.code !== 0) {
    throw new Error(
      [
        'git ' + args.join(' ') + ' failed with exit ' + result.code,
        result.stderr.trim(),
        result.stdout.trim(),
      ].filter(Boolean).join(': '),
    );
  }
  return result.stdout.trim();
}

async function initializeWorkspace(workspace, env) {
  await mkdir(workspace, { recursive: true });
  await writeFile(
    join(workspace, 'README.md'),
    '# Isolated Agent Hub candidate pipeline behavioral eval\n',
    'utf8',
  );

  await runGit(workspace, ['init', '-b', 'main'], env);
  await runGit(workspace, ['config', 'user.name', 'Agent Hub Eval'], env);
  await runGit(
    workspace,
    ['config', 'user.email', 'agent-hub-eval@example.invalid'],
    env,
  );
  await runGit(workspace, ['add', 'README.md'], env);
  await runGit(workspace, ['commit', '-m', 'eval fixture'], env);
  await runGit(
    workspace,
    [
      'remote',
      'add',
      'origin',
      MEMORY_CANDIDATE_PIPELINE_EVAL_REMOTE,
    ],
    env,
  );
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

async function submitPrompt({
  memory,
  runtime,
  branch,
  turnId,
  prompt,
}) {
  const adapter = createCodexMemoryHookAdapter({
    protocol: createProtocol(memory),
    memory,
    projectId: runtime.projectId,
    candidateCapture: true,
    explicitMemoryRequests: true,
    git: {
      async resolveContext() {
        return {
          repoPath: runtime.cwd,
          branch,
          revisionSha: runtime.revisionSha,
        };
      },
      async refreshFreshness() {},
    },
  });

  return adapter.handle({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'candidate-pipeline-behavioral-eval',
    turn_id: turnId,
    cwd: runtime.cwd,
    prompt,
  });
}

function createProviderStageRunners({
  sourceCodexHome,
  env,
}) {
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
          createJudge(options) {
            return createCodexMemoryCandidateJudge({
              ...options,
              env,
              sourceCodexHome,
            });
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
            const resource = await createCodexMemoryCandidateRelationJudge({
              ...options,
              env,
              sourceCodexHome,
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

export async function runProviderBackedMemoryCandidatePipelineCase({
  caseSpec,
  model = null,
  reasoningEffort = 'medium',
  sourceCodexHome = (
    process.env.MEMORY_CANDIDATE_PIPELINE_SOURCE_CODEX_HOME
    || process.env.CODEX_HOME
    || join(homedir(), '.codex')
  ),
  env = process.env,
} = {}) {
  if (!caseSpec || typeof caseSpec !== 'object') {
    throw new TypeError('caseSpec must be an object');
  }
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
    throw new TypeError('reasoningEffort must be low, medium, or high');
  }
  if (!nonEmpty(sourceCodexHome)) {
    throw new TypeError('sourceCodexHome must be a non-empty string');
  }

  const root = await mkdtemp(
    join(tmpdir(), 'agent-hub-candidate-pipeline-eval-'),
  );
  const workspace = join(root, 'workspace');
  const dbPath = join(root, 'memory.sqlite3');
  let memory = null;

  try {
    await initializeWorkspace(workspace, env);

    const runtime = resolveMemoryCandidateJudgeRuntime({
      cwd: workspace,
      dbPath,
      env,
    });
    memory = new MemoryEngine({ dbPath });
    memory.registerProject({
      projectId: runtime.projectId,
      repoIdentity: runtime.projectId,
      createdAt: '2026-10-02T00:00:00.000Z',
    });

    const seededClaims = [];
    for (const [index, seed] of caseSpec.seed_memories.entries()) {
      seededClaims.push(seedDurableMemory(memory, {
        projectId: runtime.projectId,
        branch: seed.branch,
        id: caseSpec.id + '-' + index,
        value: seed.value,
      }));
    }

    const beforeCurrent = activeClaims(memory, {
      projectId: runtime.projectId,
      branch: caseSpec.branch,
    }).length;
    const beforeOther = activeClaims(memory, {
      projectId: runtime.projectId,
      branch: caseSpec.other_branch,
    }).length;

    await submitPrompt({
      memory,
      runtime,
      branch: caseSpec.branch,
      turnId: caseSpec.id + '-candidate',
      prompt: caseSpec.prompt,
    });

    const candidate = memory.listScopedCandidates({
      projectId: runtime.projectId,
      branch: caseSpec.branch,
    }).find((item) => item.proposed_value === caseSpec.prompt);
    if (!candidate) {
      throw new Error(caseSpec.id + ' candidate was not captured');
    }

    const stageRunners = createProviderStageRunners({
      sourceCodexHome,
      env,
    });
    const createMemory = ({ dbPath: candidateDbPath }) => (
      new MemoryEngine({ dbPath: candidateDbPath })
    );
    const argv = [
      '--apply',
      '--cwd', runtime.cwd,
      '--db-path', runtime.dbPath,
      '--limit', '10',
      '--reasoning-effort', reasoningEffort,
    ];
    if (model) argv.push('--model', model);

    const pipelineDependencies = {
      resolveRuntime() {
        return {
          ...runtime,
          branch: caseSpec.branch,
        };
      },
      createMemory,
      runImportance: stageRunners.runImportance,
      runRelation: stageRunners.runRelation,
    };

    const first = await runMemoryCandidatePipelineCli({
      argv,
      cwd: runtime.cwd,
      log() {},
      dependencies: pipelineDependencies,
    });

    const finalCandidate = memory.getCandidate(candidate.id);
    const afterCurrent = activeClaims(memory, {
      projectId: runtime.projectId,
      branch: caseSpec.branch,
    }).length;
    const afterOther = activeClaims(memory, {
      projectId: runtime.projectId,
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
      (conflict) => conflict.state === 'open',
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
      argv,
      cwd: runtime.cwd,
      log() {},
      dependencies: pipelineDependencies,
    });

    const afterSecondCurrent = activeClaims(memory, {
      projectId: runtime.projectId,
      branch: caseSpec.branch,
    }).length;
    const afterSecondOther = activeClaims(memory, {
      projectId: runtime.projectId,
      branch: caseSpec.other_branch,
    }).length;

    return {
      candidate_status: finalCandidate.status,
      relation: finalCandidate.relation,
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
      target_claim_state_after_first_run: targetAfterFirst?.state ?? null,
      promotion_claim_state_after_first_run: promotionClaim?.state ?? null,
      target_superseded_by_promotion_claim: Boolean(
        targetAfterFirst
        && promotionClaim
        && targetAfterFirst.superseded_by_claim_id === promotionClaim.id
      ),
      open_conflicts_after_first_run: openConflicts.length,
      open_conflict_links_target_and_promotion_claim:
        openConflictLinksTargetAndPromotionClaim,
    };
  } finally {
    if (memory) memory.close();
    await rm(root, {
      recursive: true,
      force: true,
    }).catch(() => {});
  }
}

async function main() {
  const model = nonEmpty(
    process.env.MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_MODEL,
  )
    ? process.env.MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_MODEL.trim()
    : null;
  const reasoningEffort = nonEmpty(
    process.env.MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_REASONING_EFFORT,
  )
    ? process.env.MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_REASONING_EFFORT
      .trim()
      .toLowerCase()
    : 'medium';
  const sourceCodexHome = (
    process.env.MEMORY_CANDIDATE_PIPELINE_SOURCE_CODEX_HOME
    || process.env.CODEX_HOME
    || join(homedir(), '.codex')
  );

  const result = await runMemoryCandidatePipelineBehavioralCases({
    cases: MEMORY_CANDIDATE_PIPELINE_BEHAVIORAL_CASES,
    runCase(caseSpec) {
      return runProviderBackedMemoryCandidatePipelineCase({
        caseSpec,
        model,
        reasoningEffort,
        sourceCodexHome,
        env: process.env,
      });
    },
  });

  for (const item of result.cases) {
    console.log(JSON.stringify({
      type: 'codex_memory_candidate_pipeline_behavioral_case',
      ...item,
    }));
  }

  console.log(JSON.stringify({
    type: 'codex_memory_candidate_pipeline_behavioral_summary',
    pass: result.pass,
    total_cases: result.totalCases,
    passed_cases: result.passedCases,
    failed_cases: result.failedCases,
    model: model ?? 'codex-default',
    reasoning_effort: reasoningEffort,
    isolation: {
      ephemeral_repository_per_case: true,
      ephemeral_sqlite_per_case: true,
      judge_codex_home_auth_only: true,
      inherited_hooks: false,
      inherited_config: false,
      inherited_legacy_memory: false,
    },
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
