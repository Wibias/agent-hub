#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseCodexHookCliOptions,
  runCodexMemoryHook,
} from './codex-hook-cli.mjs';
import {
  runCodexAgentDecisionHook,
} from './codex-agent-decision-hook-cli.mjs';
import {
  createCodexMemoryHookAdapter,
} from './codex-hooks.mjs';
import {
  CLAUDE_CODE_HARNESS,
  normalizeClaudePromptEvent,
  normalizeClaudeStopEvent,
} from './claude-code-events.mjs';

export async function runClaudeCodeHook({
  event,
  env = process.env,
  configOptions = {},
} = {}) {
  if (event?.hook_event_name === 'UserPromptSubmit') {
    return runCodexMemoryHook({
      event: normalizeClaudePromptEvent(event),
      env,
      configOptions,
      harness: CLAUDE_CODE_HARNESS,
      createAdapter: (options) => createCodexMemoryHookAdapter({
        ...options,
        harness: CLAUDE_CODE_HARNESS,
      }),
    });
  }

  if (
    event?.hook_event_name === 'Stop'
    || event?.hook_event_name === 'SubagentStop'
  ) {
    return runCodexAgentDecisionHook({
      event: normalizeClaudeStopEvent(event),
      env,
      configOptions: {
        ignoreMemoryEnv: configOptions.ignoreMemoryEnv === true,
        autoPipeline: false,
      },
      harness: CLAUDE_CODE_HARNESS,
    });
  }

  return null;
}

async function readStdin(stream = process.stdin) {
  stream.setEncoding('utf8');
  let raw = '';
  for await (const chunk of stream) raw += chunk;
  return raw;
}

function shouldWriteOutput(output) {
  if (output === null || output === undefined) return false;
  if (
    output.continue === true
    && Object.keys(output).length === 1
  ) {
    return false;
  }
  return true;
}

async function main() {
  try {
    const raw = await readStdin();
    const event = JSON.parse(raw);
    const output = await runClaudeCodeHook({
      event,
      configOptions: parseCodexHookCliOptions(process.argv.slice(2)),
    });
    if (shouldWriteOutput(output)) {
      process.stdout.write(`${JSON.stringify(output)}\n`);
    }
  } catch {
    // Claude Code command hooks are fail-soft here: exit 0 with no output.
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) await main();
