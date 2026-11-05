#!/usr/bin/env node
/** D9 operator-controlled single-file Git Evidence capture. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MemoryEngine } from '../memory-engine/index.mjs';
import { captureD9RepositoryFile } from '../memory-engine/memory-graph-d9-capture.mjs';

const HELP = 'D9 explicit repository Evidence capture (Node 24)\n\n'
  + '  node scripts/capture-memory-graph-d9.mjs --db-path PATH --repo-root ROOT\n'
  + '    --project-id ID --branch BRANCH --path RELATIVE_TRACKED_FILE [--write]\n\n'
  + 'Default is read-only dry-run. --write explicitly inserts one verified Git\n'
  + 'file-existence observation into an existing registered MemoryEngine database.\n'
  + 'No file contents are stored, no checkout mutations, no implicit project setup.\n'
  + 'Output contains fixed labels and booleans only, never file paths or raw errors.\n';

/** Require an exact, unambiguous, explicitly scoped capture request. */
export function parseD9Args(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('arguments required');
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const fields = new Map([
    ['--db-path', 'dbPath'], ['--repo-root', 'repoRoot'],
    ['--project-id', 'projectId'], ['--branch', 'branch'], ['--path', 'path'],
  ]);
  const options = { help: false, dbPath: null, repoRoot: null,
    projectId: null, branch: null, path: null, write: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new TypeError('duplicate flag');
    seen.add(flag);
    if (flag === '--write') { options.write = true; continue; }
    if (!fields.has(flag)) throw new TypeError('unknown option');
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim()
        || value.startsWith('--') || value.includes('\0')) {
      throw new TypeError('invalid option value');
    }
    options[fields.get(flag)] = value;
  }
  for (const name of ['dbPath', 'repoRoot', 'projectId', 'branch', 'path']) {
    if (!options[name]) throw new TypeError('explicit ' + name + ' required');
  }
  return options;
}

/** Never initialize a database or implicitly bind a project. */
export function executeD9Capture({ argv = [], emit = console.log } = {}) {
  const options = parseD9Args(argv);
  if (options.help) { emit(HELP); return { outcome: 'help' }; }
  const dbPath = resolve(options.dbPath);
  if (!existsSync(dbPath)) throw new Error('database_not_found');
  const memory = new MemoryEngine({ dbPath, readOnly: !options.write });
  try {
    const report = captureD9RepositoryFile({ memory, ...options });
    emit(JSON.stringify(report, null, 2));
    return report;
  } finally {
    memory.close();
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) {
  try {
    executeD9Capture({ argv: process.argv.slice(2) });
  } catch (error) {
    const code = error?.message === 'database_not_found'
      ? 'database_not_found'
      : error instanceof TypeError ? 'invalid_arguments'
        : 'capture_blocked';
    console.error(JSON.stringify({ schemaVersion: 1, outcome: 'blocked', code }));
    process.exitCode = 2;
  }
}
