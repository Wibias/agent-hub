import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createMemoryBackup,
} from '../memory-engine/memory-backup.mjs';
import {
  defaultCodexMemoryDbPath,
} from '../memory-engine/adapters/codex-hook-cli.mjs';

function parseArgs(argv) {
  let dbPath = defaultCodexMemoryDbPath();
  let backupRoot = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!['--db-path', '--output-dir'].includes(arg)) {
      throw new Error('unknown argument: ' + arg);
    }

    const value = argv[index + 1];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(arg + ' requires a path');
    }

    if (arg === '--db-path') dbPath = resolve(value);
    if (arg === '--output-dir') backupRoot = resolve(value);
    index += 1;
  }

  return {
    dbPath,
    ...(backupRoot === null ? {} : { backupRoot }),
  };
}

export async function runMemoryBackupCli({
  argv = process.argv.slice(2),
  log = console.log,
  createBackup = createMemoryBackup,
} = {}) {
  const options = parseArgs(argv);
  const result = await createBackup(options);
  log(JSON.stringify(result));
  return result;
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  runMemoryBackupCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
