#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createCodexPassiveMemoryEventAdapter,
} from '../codex-run-observation-capture.mjs';
import {
  expireDueClaims,
} from '../claim-expiration-maintenance.mjs';
import {
  inspectBufferedTurnEligibility,
  runEvidenceBoundBufferedMemoryPipeline,
} from '../evidence-bound-buffered-run-pipeline.mjs';
import {
  createEvidenceBoundJudgeBundle,
} from '../evidence-bound-memory-pipeline.mjs';
import {
  createModelJudgeTelemetryRecorder,
} from '../model-judge-telemetry-recorder.mjs';
import {
  createPipelineRunId as defaultCreatePipelineRunId,
} from '../pipeline-observability.mjs';



function numericCount(value) {
  const count = Number(value ?? 0);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

function stageSummary(stage, keys) {
  const summary = {};
  for (const key of keys) summary[key] = numericCount(stage?.[key]);
  return summary;
}

export function summarizeEvidenceBoundPipelineRun(pipeline) {
  const extractionResults = Array.isArray(pipeline?.extraction?.results)
    ? pipeline.extraction.results
    : [];
  const extractionProposals = Array.isArray(pipeline?.extraction?.proposals)
    ? pipeline.extraction.proposals
    : [];

  const stageCounts = {
    evidence_extraction: {
      total: extractionResults.length,
      applied: extractionProposals.length,
      failed: numericCount(pipeline?.extraction?.failed),
    },
    evidence_importance: stageSummary(
      pipeline?.importance,
      ['total', 'evaluated', 'failed'],
    ),
    evidence_support: stageSummary(
      pipeline?.support,
      ['total', 'evaluated', 'failed'],
    ),
    evidence_relation: stageSummary(
      pipeline?.relation,
      ['total', 'evaluated', 'failed'],
    ),
    evidence_promotion: stageSummary(
      pipeline?.promotion,
      ['total', 'promoted', 'superseded', 'needs_confirmation', 'failed'],
    ),
  };

  const failed = Object.values(stageCounts)
    .reduce((total, stage) => total + numericCount(stage.failed), 0);

  return {
    promoted: numericCount(pipeline?.promotion?.promoted),
    failed,
    stageCounts,
  };
}

function finishEvidenceBoundPipelineRun({
  memory,
  run,
  pipeline,
  clock,
  status = null,
  error = null,
}) {
  if (!run || typeof memory?.finishPipelineRun !== 'function') return;
  const summary = summarizeEvidenceBoundPipelineRun(pipeline);
  const finishedAt = clock();
  const finishedMs = Date.parse(finishedAt);
  const durationMs = Number.isFinite(finishedMs) && Number.isFinite(run.startedMs)
    ? Math.max(0, finishedMs - run.startedMs)
    : 0;

  try {
    memory.finishPipelineRun({
      id: run.id,
      status: status ?? (summary.failed > 0 ? 'partial' : 'drained'),
      finishedAt,
      durationMs,
      rounds: 1,
      promotedCount: summary.promoted,
      stageCounts: summary.stageCounts,
      candidateRefs: [],
      error,
    });
  } catch {
    // Pipeline observability is operational state and must never block memory.
  }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validEvent(event) {
  return Boolean(
    event
    && typeof event === 'object'
    && !Array.isArray(event)
    && ['UserPromptSubmit', 'PostToolUse', 'Stop'].includes(event.hook_event_name)
    && nonEmpty(event.session_id)
    && nonEmpty(event.turn_id)
    && nonEmpty(event.cwd)
  );
}

export function parsePassiveMemoryHookOptions(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  const result = {
    ignoreMemoryEnv: false,
    model: null,
    reasoningEffort: 'medium',
    judgeTimeoutMs: 120_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--ignore-memory-env') {
      result.ignoreMemoryEnv = true;
      continue;
    }
    if (arg === '--model') {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error('--model requires a value');
      result.model = value.trim();
      index += 1;
      continue;
    }
    if (arg === '--reasoning-effort') {
      const value = argv[index + 1];
      if (!['low', 'medium', 'high'].includes(value)) {
        throw new Error('--reasoning-effort requires low, medium, or high');
      }
      result.reasoningEffort = value;
      index += 1;
      continue;
    }
    if (arg === '--judge-timeout-ms') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--judge-timeout-ms requires a positive integer');
      }
      result.judgeTimeoutMs = value;
      index += 1;
      continue;
    }
    throw new Error('unknown argument: ' + arg);
  }
  return result;
}

async function loadDefaultRuntime() {
  const [
    indexModule,
    protocolModule,
    gitModule,
    maintenanceModule,
    hookCliModule,
    hooksModule,
    judgeModule,
    semanticModule,
  ] = await Promise.all([
    import('../index.mjs'),
    import('../protocol.mjs'),
    import('../git-freshness.mjs'),
    import('../memory-maintenance-lock.mjs'),
    import('./codex-hook-cli.mjs'),
    import('./codex-hooks.mjs'),
    import('../../scripts/codex-isolated-memory-judge.mjs'),
    import('../../scripts/reindex-memory-semantic.mjs'),
  ]);

  return {
    MemoryEngine: indexModule.MemoryEngine,
    inspectMemoryTextSensitivity: indexModule.inspectMemoryTextSensitivity,
    createMemoryProtocol: protocolModule.createMemoryProtocol,
    resolveGitContext: gitModule.resolveGitContext,
    memoryRestoreLocked: maintenanceModule.memoryRestoreLocked,
    parseCodexMemoryConfig: hookCliModule.parseCodexMemoryConfig,
    defaultCodexMemoryDbPath: hookCliModule.defaultCodexMemoryDbPath,
    resolveCodexProjectScope: hookCliModule.resolveCodexProjectScope,
    parseExplicitMemoryPrompt: hooksModule.parseExplicitMemoryPrompt,
    createIsolatedCodexJsonJudge: judgeModule.createIsolatedCodexJsonJudge,
    reindexMemorySemantic: semanticModule.reindexMemorySemantic,
  };
}

function passiveAuthority({ sourceKind, metadata }) {
  if (metadata?.passive_run_extraction !== true) return 'unclassified';
  if (sourceKind === 'session') return 'user_direct';
  if (sourceKind === 'tool') return 'tool_observation';
  return 'unclassified';
}

export async function runCodexPassiveMemoryHook({
  event,
  env = process.env,
  configOptions = {},
  clock = () => new Date().toISOString(),
  runtime = null,
  ensureDbDirectory = (dbPath) => {
    mkdirSync(dirname(dbPath), { recursive: true });
  },
  createEventAdapter = createCodexPassiveMemoryEventAdapter,
  runStopPipeline = runEvidenceBoundBufferedMemoryPipeline,
  inspectEligibility = inspectBufferedTurnEligibility,
  expireClaims = expireDueClaims,
  createJudgeBundle = createEvidenceBoundJudgeBundle,
  createTelemetryRecorder = createModelJudgeTelemetryRecorder,
  syncSemantic = null,
  createPipelineRunId = defaultCreatePipelineRunId,
} = {}) {
  const response = { continue: true };
  if (!validEvent(event)) return response;
  if (event.hook_event_name === 'Stop' && event.stop_hook_active === true) {
    return response;
  }

  let memory = null;
  let judgeBundle = null;
  let telemetryRecorder = null;
  let evidenceRun = null;
  try {
    const deps = runtime ?? await loadDefaultRuntime();
    const config = deps.parseCodexMemoryConfig(env, {
      ignoreMemoryEnv: configOptions.ignoreMemoryEnv === true,
    });
    if (!nonEmpty(config.dbPath)) {
      config.dbPath = deps.defaultCodexMemoryDbPath({ env });
    }
    if (deps.memoryRestoreLocked({ dbPath: config.dbPath })) return response;

    const scope = deps.resolveCodexProjectScope({ event, config });
    const git = deps.resolveGitContext({ cwd: event.cwd });
    if (
      configOptions.ignoreMemoryEnv === true
      || !nonEmpty(env.AGENT_HUB_MEMORY_DB)
    ) {
      ensureDbDirectory(config.dbPath);
    }

    memory = new deps.MemoryEngine({ dbPath: config.dbPath });
    if (!memory.getProject(scope.projectId)) {
      const registration = {
        projectId: scope.projectId,
        repoIdentity: scope.repoIdentity,
      };
      if (scope.canonicalRemote !== null) {
        registration.canonicalRemote = scope.canonicalRemote;
      }
      memory.registerProject(registration);
    }

    const protocol = deps.createMemoryProtocol({
      memory,
      classifyAuthority: passiveAuthority,
    });

    const commonAdapterOptions = {
      dbPath: config.dbPath,
      projectId: scope.projectId,
      inspectTextSensitivity: deps.inspectMemoryTextSensitivity,
      resolveContext: async () => git,
      isMemoryControlPrompt: (prompt) => (
        deps.parseExplicitMemoryPrompt(prompt) !== null
      ),
      runStopPipeline,
      clock,
    };

    if (event.hook_event_name === 'Stop') {
      const eligibility = inspectEligibility({
        dbPath: config.dbPath,
        projectId: scope.projectId,
        branch: git.branch,
        sessionId: event.session_id,
        turnId: event.turn_id,
      });
      if (!eligibility.eligible) return response;

      expireClaims({
        dbPath: config.dbPath,
        projectId: scope.projectId,
        branch: git.branch,
        now: clock(),
      });

      if (typeof memory.startPipelineRun === 'function') {
        try {
          const startedAt = clock();
          const startedMs = Date.parse(startedAt);
          evidenceRun = {
            id: createPipelineRunId(),
            startedAt,
            startedMs: Number.isFinite(startedMs) ? startedMs : null,
          };
          memory.startPipelineRun({
            id: evidenceRun.id,
            projectId: scope.projectId,
            branch: git.branch,
            revisionSha: git.revisionSha ?? null,
            trigger: 'Stop:evidence_bound',
            startedAt,
          });
        } catch {
          evidenceRun = null;
        }
      }

      telemetryRecorder = createTelemetryRecorder({
        dbPath: config.dbPath,
        projectId: scope.projectId,
        branch: git.branch,
        clock,
      });
      judgeBundle = await createJudgeBundle({
        createJsonJudge: deps.createIsolatedCodexJsonJudge,
        model: configOptions.model ?? null,
        reasoningEffort: configOptions.reasoningEffort ?? 'medium',
        env,
        timeoutMs: configOptions.judgeTimeoutMs ?? 120_000,
        onUsage: telemetryRecorder.onUsage,
      });
      commonAdapterOptions.stopPipelineOptions = {
        protocol,
        memory,
        extractionJudge: judgeBundle.extractionJudge,
        importanceJudge: judgeBundle.importanceJudge,
        supportJudge: judgeBundle.supportJudge,
        relationJudge: judgeBundle.relationJudge,
        evaluatorIds: judgeBundle.evaluatorIds,
      };
    } else {
      commonAdapterOptions.stopPipelineOptions = {
        protocol,
        memory,
      };
    }

    const adapter = createEventAdapter(commonAdapterOptions);
    let handled;
    try {
      handled = await adapter.handle(event);
    } catch (error) {
      if (event.hook_event_name === 'Stop' && evidenceRun !== null) {
        finishEvidenceBoundPipelineRun({
          memory,
          run: evidenceRun,
          pipeline: null,
          clock,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
        evidenceRun = null;
      }
      throw error;
    }

    if (event.hook_event_name === 'Stop' && evidenceRun !== null) {
      finishEvidenceBoundPipelineRun({
        memory,
        run: evidenceRun,
        pipeline: handled?.pipeline ?? null,
        clock,
      });
      evidenceRun = null;
    }

    if (
      event.hook_event_name === 'Stop'
      && Number(handled?.pipeline?.promotion?.promoted ?? 0) > 0
    ) {
      const synchronize = syncSemantic ?? deps.reindexMemorySemantic;
      if (typeof synchronize === 'function') {
        try {
          await synchronize({
            dbPath: config.dbPath,
            projectId: scope.projectId,
            branch: git.branch,
            log() {},
          });
        } catch {
          // Semantic vectors are derived state. Canonical promotion remains
          // valid when the E5 worker or derived-state synchronization fails.
        }
      }
    }
  } catch (error) {
    if (event.hook_event_name === 'Stop' && evidenceRun !== null && memory) {
      finishEvidenceBoundPipelineRun({
        memory,
        run: evidenceRun,
        pipeline: null,
        clock,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      evidenceRun = null;
    }
    // Passive memory is optional. Never block the host turn.
  } finally {
    if (judgeBundle && typeof judgeBundle.close === 'function') {
      try { await judgeBundle.close(); } catch {}
    }
    if (telemetryRecorder && typeof telemetryRecorder.close === 'function') {
      try { telemetryRecorder.close(); } catch {}
    }
    if (memory && typeof memory.close === 'function') {
      try { memory.close(); } catch {}
    }
  }
  return response;
}

async function readStdin(stream = process.stdin) {
  stream.setEncoding('utf8');
  let raw = '';
  for await (const chunk of stream) raw += chunk;
  return raw;
}

async function main() {
  let output = { continue: true };
  try {
    const event = JSON.parse(await readStdin());
    output = await runCodexPassiveMemoryHook({
      event,
      configOptions: parsePassiveMemoryHookOptions(process.argv.slice(2)),
    });
  } catch {
    output = { continue: true };
  }
  process.stdout.write(JSON.stringify(output) + '\n');
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) await main();
