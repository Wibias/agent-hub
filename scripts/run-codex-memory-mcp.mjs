#!/usr/bin/env node
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveCodexMemoryMcp } from '../memory-engine/adapters/codex-readonly-memory-mcp.mjs';
import {
  defaultGlobalMemoryScopePath, readGlobalCodexMemory,
} from '../memory-engine/adapters/codex-global-memory-scope.mjs';

/** Old explicitly pinned project mode is preserved.
 * Global mode never accepts --cwd: the Codex runtime chooses process.cwd()
 * when launching a local stdio MCP server without configured cwd.
 */
export function parseMemoryMcpArgs(argv) {
  if (Array.isArray(argv) && argv.length === 2 && argv[0] === '--cwd'
    && typeof argv[1] === 'string' && isAbsolute(argv[1])) {
    return { mode: 'pinned_project', cwd: resolve(argv[1]) };
  }
  if (Array.isArray(argv)
    && (argv.length === 1 || argv.length === 3)
    && argv[0] === '--global'
    && (argv.length === 1 || (argv[1] === '--scope'
      && typeof argv[2] === 'string' && isAbsolute(argv[2])))) {
    return { mode: 'global_scoped',
      scopePath: argv.length === 3 ? resolve(argv[2]) : defaultGlobalMemoryScopePath() };
  }
  throw new Error('Usage: node scripts/run-codex-memory-mcp.mjs --global [--scope ABSOLUTE_SCOPE_FILE] OR --cwd ABSOLUTE_PROJECT_PATH');
}

export async function runMemoryMcp(args, {
  hostCwd = process.cwd(), input = process.stdin, output = process.stdout,
} = {}) {
  const opts = parseMemoryMcpArgs(args);
  if (opts.mode === 'pinned_project') {
    return serveCodexMemoryMcp({ cwd: opts.cwd, input, output });
  }
  return serveCodexMemoryMcp({
    cwd: hostCwd, input, output, env: {},
    recall: ({ cwd, query, maxItems }) => readGlobalCodexMemory({
      cwd, query, maxItems, scopePath: opts.scopePath,
    }),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await runMemoryMcp(process.argv.slice(2));
  } catch {
    process.stderr.write('AgentHub read-only memory MCP could not start.\n');
    process.exitCode = 1;
  }
}
