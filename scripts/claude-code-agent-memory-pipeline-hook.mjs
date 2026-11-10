#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runCodexAgentDecisionHook,
} from '../memory-engine/adapters/codex-agent-decision-hook-cli.mjs';
import {
  CLAUDE_CODE_HARNESS,
  normalizeClaudeStopEvent,
} from '../memory-engine/adapters/claude-code-events.mjs';
import {
  parseCodexAgentPipelineHookOptions,
  runCodexAgentPipelineHook,
} from './codex-agent-memory-pipeline-hook.mjs';

export async function runClaudeAgentPipelineHook({
  event,
  env = process.env,
  configOptions = {},
} = {}) {
  return runCodexAgentPipelineHook({
    event: normalizeClaudeStopEvent(event),
    env,
    configOptions,
    captureDecision: (args) => runCodexAgentDecisionHook({
      ...args,
      harness: CLAUDE_CODE_HARNESS,
    }),
  });
}

async function readStdin(stream = process.stdin) {
  stream.setEncoding('utf8');
  let raw = '';
  for await (const chunk of stream) raw += chunk;
  return raw;
}

async function main() {
  try {
    const options = parseCodexAgentPipelineHookOptions(
      process.argv.slice(2),
    );
    const raw = await readStdin();
    await runClaudeAgentPipelineHook({
      event: JSON.parse(raw),
      configOptions: options,
    });
  } catch {
    // Background memory processing must never block or fail the Claude turn.
    process.exitCode = 0;
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) await main();
