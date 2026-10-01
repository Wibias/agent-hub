import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  auditCodexState,
} from '../memory-engine/codex-state-audit.mjs';

function parseArgs(argv) {
  let codexHome = process.env.CODEX_HOME || resolve(homedir(), '.codex');

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--codex-home') {
      const value = argv[index + 1];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error('--codex-home requires a path');
      }
      codexHome = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return {
    codexHome,
  };
}

function summarizeSurface(entry) {
  return {
    name: entry.name,
    type: entry.type,
    classification: entry.classification,
  };
}

export async function runCodexStateAudit({
  argv = process.argv.slice(2),
  log = console.log,
} = {}) {
  const { codexHome } = parseArgs(argv);
  const report = await auditCodexState({ codexHome });

  const output = {
    type: 'codex_state_audit',
    codex_home: report.codexHome,
    summary: report.summary,
    agent_hub_hook: report.agentHubHook,
    hook_read_error: report.hookReadError,
    direct_memory: report.directMemory.map(summarizeSurface),
    conversation_state: report.conversationState.map(summarizeSurface),
    persistent_runtime_state: report.persistentRuntimeState.map(summarizeSurface),
    instruction_surfaces: report.instructions.map(summarizeSurface),
    runtime_config: report.runtimeConfig.map(summarizeSurface),
    hooks: report.hooks.map(summarizeSurface),
    auth: report.auth.map(summarizeSurface),
    unknown: report.unknown.map(summarizeSurface),
  };

  log(JSON.stringify(output));
  return output;
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  runCodexStateAudit().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
