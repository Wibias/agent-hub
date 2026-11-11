#!/usr/bin/env node
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultGlobalMemoryScopePath, manageGlobalMemoryProject,
} from '../memory-engine/adapters/codex-global-memory-scope.mjs';

export function parseGlobalMemoryProjectArgs(argv) {
  if (!Array.isArray(argv)) throw new Error('Arguments required');
  let operation = null;
  let cwd = null;
  let dbPath = null;
  let scopePath = defaultGlobalMemoryScopePath();
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list' && !operation) operation = 'list';
    else if (arg === '--add' && !operation) operation = 'add';
    else if (arg === '--remove' && !operation) operation = 'remove';
    else if (arg === '--apply' && !apply) apply = true;
    else if (['--cwd', '--db', '--scope'].includes(arg)) {
      const value = argv[++i];
      if (!value || !isAbsolute(value)) throw new Error(arg + ' requires an absolute path');
      if (arg === '--cwd' && cwd === null) cwd = resolve(value);
      else if (arg === '--db' && dbPath === null) dbPath = resolve(value);
      else if (arg === '--scope') scopePath = resolve(value);
      else throw new Error('Repeated option: ' + arg);
    } else throw new Error('Unknown option: ' + arg);
  }
  if (!operation) throw new Error('Use --list, --add or --remove');
  if (operation === 'list' && (cwd !== null || dbPath !== null || apply)) {
    throw new Error('--list does not accept --cwd, --db or --apply');
  }
  if (operation !== 'list' && cwd === null) throw new Error('--cwd is required');
  if (operation === 'remove' && dbPath !== null) throw new Error('--db applies only to --add');
  return { operation, cwd, dbPath, scopePath, apply };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const input = parseGlobalMemoryProjectArgs(process.argv.slice(2));
    const result = manageGlobalMemoryProject(input);
    process.stdout.write(JSON.stringify({
      ...result,
      note: input.apply
        ? 'The scope allowlist was updated only; no Codex configuration or memory DB was changed.'
        : 'Dry-run only. Add --apply to change the approved project allowlist.',
    }, null, 2) + '\n');
  } catch (error) {
    process.stderr.write('GLOBAL_MEMORY_SCOPE_DENIED: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
