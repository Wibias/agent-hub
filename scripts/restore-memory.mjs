import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  recoverMemoryRestore,
  restoreMemoryBackup,
  validateMemoryBackup,
} from '../memory-engine/memory-backup.mjs';
import {
  defaultCodexMemoryDbPath,
} from '../memory-engine/adapters/codex-hook-cli.mjs';

function parseArgs(argv) {
  let backupDir = null;
  let dbPath = defaultCodexMemoryDbPath();
  let backupRoot = null;
  let apply = false;
  let recover = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--apply') {
      apply = true;
      continue;
    }

    if (arg === '--recover') {
      recover = true;
      continue;
    }

    if (arg === '--db-path' || arg === '--backup-root') {
      const value = argv[index + 1];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(arg + ' requires a path');
      }
      if (arg === '--db-path') dbPath = resolve(value);
      if (arg === '--backup-root') backupRoot = resolve(value);
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error('unknown argument: ' + arg);
    }

    if (backupDir !== null) {
      throw new Error('only one backup directory may be provided');
    }
    backupDir = resolve(arg);
  }

  if (recover) {
    if (apply) {
      throw new Error('--recover cannot be combined with --apply');
    }
    if (backupDir !== null) {
      throw new Error('--recover does not accept a backup directory');
    }
  } else if (backupDir === null) {
    throw new Error('backup directory is required');
  }

  return {
    backupDir,
    dbPath,
    apply,
    recover,
    ...(backupRoot === null ? {} : { backupRoot }),
  };
}

export async function runMemoryRestoreCli({
  argv = process.argv.slice(2),
  log = console.log,
  validateBackup = validateMemoryBackup,
  restoreBackup = restoreMemoryBackup,
  recoverRestore = recoverMemoryRestore,
} = {}) {
  const options = parseArgs(argv);

  if (options.recover) {
    const result = await recoverRestore({
      dbPath: options.dbPath,
    });
    const output = {
      type: 'agent_hub_memory_restore',
      mode: 'recover',
      result,
    };
    log(JSON.stringify(output));
    return output;
  }

  if (!options.apply) {
    const validation = await validateBackup({
      backupDir: options.backupDir,
    });
    const output = {
      type: 'agent_hub_memory_restore',
      mode: 'dry-run',
      backupDir: options.backupDir,
      dbPath: options.dbPath,
      validation,
      nextStep: 'rerun with --apply to restore this validated backup',
    };
    log(JSON.stringify(output));
    return output;
  }

  const result = await restoreBackup({
    backupDir: options.backupDir,
    dbPath: options.dbPath,
    ...(options.backupRoot === undefined
      ? {}
      : { backupRoot: options.backupRoot }),
  });

  const output = {
    type: 'agent_hub_memory_restore',
    mode: 'apply',
    result,
  };
  log(JSON.stringify(output));
  return output;
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  runMemoryRestoreCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
