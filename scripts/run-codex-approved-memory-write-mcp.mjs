#!/usr/bin/env node
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveApprovedMemoryWriteMcp } from '../memory-engine/adapters/codex-approved-memory-write-mcp.mjs';

export function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== '--cwd'
    || typeof argv[1] !== 'string' || !isAbsolute(argv[1])) {
    throw new Error('Usage: node scripts/run-codex-approved-memory-write-mcp.mjs --cwd ABSOLUTE_APPROVED_REPO_ROOT');
  }
  return { cwd: resolve(argv[1]) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await serveApprovedMemoryWriteMcp(parseArgs(process.argv.slice(2)));
  } catch {
    process.stderr.write('AgentHub Memory Write preview could not start.\n');
    process.exitCode = 2;
  }
}
