#!/usr/bin/env node
import {
  appendFileSync,
  mkdirSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runCodexAgentDecisionHook,
} from '../memory-engine/adapters/codex-agent-decision-hook-cli.mjs';
import {
  automaticMemoryCandidatePipelineReady,
  defaultCodexMemoryDbPath,
  parseCodexMemoryConfig,
  resolveCodexProjectScope,
} from '../memory-engine/adapters/codex-hook-cli.mjs';
import { MemoryEngine } from '../memory-engine/index.mjs';
import {
  defaultMemoryCandidatePipelineLogFile,
} from '../memory-engine/candidate-pipeline-launcher.mjs';
import { resolveGitContext } from '../memory-engine/git-freshness.mjs';
import {
  runMemoryCandidatePipelineWorker,
} from './run-memory-candidate-pipeline-worker.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validEvent(event) {
  if (
    !event
    || typeof event !== 'object'
    || !['Stop', 'SubagentStop'].includes(event.hook_event_name)
    || !nonEmpty(event.session_id)
    || !nonEmpty(event.cwd)
    || !nonEmpty(event.turn_id)
  ) {
    return false;
  }
  if (event.hook_event_name === 'SubagentStop') {
    return nonEmpty(event.agent_id) && nonEmpty(event.agent_type);
  }
  return true;
}

export function parseCodexAgentPipelineHookOptions(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  for (const arg of argv) {
    if (arg !== '--ignore-memory-env') {
      throw new Error('unknown argument: ' + arg);
    }
  }
  return {
    ignoreMemoryEnv: argv.includes('--ignore-memory-env'),
  };
}

/** Read-only preflight: do not start a costly judge when there is no actionable
 * project/branch candidate. Review-only candidates stay untouched.
 */
export function inspectCodexCandidateQueue({
  dbPath, projectId, branch,
  createMemory = ({ dbPath: path }) => new MemoryEngine({ dbPath: path, readOnly: true }),
} = {}) {
  let memory = null;
  try {
    memory = createMemory({ dbPath });
    if (!memory.getProject(projectId)) return 'project_not_registered';
    return automaticMemoryCandidatePipelineReady(memory, {
      projectId, branch,
    }) ? 'ready' : 'empty';
  } catch {
    return 'queue_unavailable';
  } finally {
    if (memory && typeof memory.close === 'function') memory.close();
  }
}

function createPipelineLog(logFile) {
  mkdirSync(dirname(logFile), { recursive: true });
  return (value) => {
    appendFileSync(logFile, String(value) + '\n', 'utf8');
  };
}

export async function runCodexAgentPipelineHook({
  event,
  env = process.env,
  configOptions = {},
  captureDecision = runCodexAgentDecisionHook,
  resolveProjectScope = resolveCodexProjectScope,
  resolveGit = resolveGitContext,
  runWorker = runMemoryCandidatePipelineWorker,
  inspectQueue = inspectCodexCandidateQueue,
  createLog = createPipelineLog,
} = {}) {
  if (!validEvent(event) || event.stop_hook_active === true) {
    return {
      status: 'skipped',
      reason: 'invalid_or_recursive_event',
    };
  }

  const config = parseCodexMemoryConfig(env, {
    ignoreMemoryEnv: configOptions.ignoreMemoryEnv === true,
  });
  if (!nonEmpty(config.dbPath)) {
    config.dbPath = defaultCodexMemoryDbPath({ env });
  }

  // Codex legitimately emits null last_assistant_message. That means there is
  // no agent decision to capture, not that the user's pending candidates vanish.
  // The two Stop hooks execute independently; a capture failure must not block
  // processing the previously captured direct-user queue.
  if (nonEmpty(event.last_assistant_message)) {
    try {
      await captureDecision({
        event,
        env,
        configOptions: {
          ignoreMemoryEnv: configOptions.ignoreMemoryEnv === true,
          autoPipeline: false,
        },
      });
    } catch {
      // Fail soft for agent decision capture; existing user candidates remain.
    }
  }

  const scope = resolveProjectScope({ event, config });
  const git = resolveGit({ cwd: event.cwd });
  const queue = inspectQueue({
    dbPath: config.dbPath,
    projectId: scope.projectId,
    branch: git.branch,
  });
  if (queue !== 'ready') {
    return {
      status: 'skipped',
      reason: queue === 'empty' ? 'no_actionable_candidates' : queue,
    };
  }

  const logFile = defaultMemoryCandidatePipelineLogFile(config.dbPath);
  const log = createLog(logFile);

  const result = await runWorker({
    cwd: git.repoPath,
    dbPath: config.dbPath,
    projectId: scope.projectId,
    branch: git.branch,
    revisionSha: git.revisionSha,
    trigger: event.hook_event_name,
    log,
  });
  log(JSON.stringify(result));

  return {
    status: 'completed',
    result,
    logFile,
  };
}

async function readStdin(stream = process.stdin) {
  stream.setEncoding('utf8');
  let raw = '';
  for await (const chunk of stream) raw += chunk;
  return raw;
}

async function main() {
  let config = null;
  let log = null;

  try {
    const options = parseCodexAgentPipelineHookOptions(
      process.argv.slice(2),
    );
    const raw = await readStdin();
    const event = JSON.parse(raw);

    config = parseCodexMemoryConfig(process.env, {
      ignoreMemoryEnv: options.ignoreMemoryEnv,
    });
    if (!nonEmpty(config.dbPath)) {
      config.dbPath = defaultCodexMemoryDbPath({ env: process.env });
    }
    log = createPipelineLog(
      defaultMemoryCandidatePipelineLogFile(config.dbPath),
    );

    const result = await runCodexAgentPipelineHook({
      event,
      configOptions: options,
      createLog() {
        return log;
      },
    });
    if (result.status === 'skipped' && result.reason === 'queue_unavailable') {
      log(JSON.stringify({
        type: 'agent_hub_codex_agent_pipeline_skip',
        reason: result.reason,
      }));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      if (log === null) {
        const dbPath = nonEmpty(config?.dbPath)
          ? config.dbPath
          : defaultCodexMemoryDbPath({ env: process.env });
        log = createPipelineLog(
          defaultMemoryCandidatePipelineLogFile(dbPath),
        );
      }
      log(JSON.stringify({
        type: 'agent_hub_codex_agent_pipeline_hook_error',
        error: message,
      }));
    } catch {}

    // Background memory processing must never block or fail the Codex turn.
    process.exitCode = 0;
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  await main();
}
