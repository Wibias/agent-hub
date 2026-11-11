#!/usr/bin/env node
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveCodexMemoryMcp } from '../memory-engine/adapters/codex-readonly-memory-mcp.mjs';

export function parseMemoryMcpArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== '--cwd'
    || typeof argv[1] !== 'string' || !isAbsolute(argv[1])) {
    throw new Error('usage: node scripts/run-codex-memory-mcp.mjs --cwd ABSOLUTE_REPOSITORY_PATH');
  }
  return { cwd: argv[1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const options = parseMemoryMcpArgs(process.argv.slice(2));
    await serveCodexMemoryMcp(options);
  } catch {
    // Protocol stdout must remain JSON-RPC only. Never print DB paths or data.
    process.stderr.write('AgentHub read-only memory MCP could not start.\n');
    process.exitCode = 1;
  }
}
