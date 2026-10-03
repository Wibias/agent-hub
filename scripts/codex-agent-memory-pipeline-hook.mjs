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
  defaultCodexMemoryDbPath,
  parseCodexMemoryConfig,
  resolveCodexProjectScope,
} from '../memory-engine/adapters/codex-hook-cli.mjs';
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
    || !nonEmpty(event.last_assistant_message)
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

  // The synchronous Stop/SubagentStop hook normally wins this race, but
  // Codex schedules async handlers independently. Re-running capture here is
  // intentional and safe because candidate fingerprints are idempotent.
  await captureDecision({
    event,
    env,
    configOptions: {
      ignoreMemoryEnv: configOptions.ignoreMemoryEnv === true,
      autoPipeline: false,
    },
  });

  const scope = resolveProjectScope({ event, config });
  const git = resolveGit({ cwd: event.cwd });
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

    await runCodexAgentPipelineHook({
      event,
      configOptions: options,
      createLog() {
        return log;
      },
    });
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
