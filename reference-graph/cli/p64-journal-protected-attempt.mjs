#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import {
  inspectP64LocalAttempt, runP64JournalAttempt,
} from '../p64-attempt-journal.mjs';

/**
 * One explicit operator invocation only, with per-attempt local records.
 * No scheduling, no DB writes, and no HTTP without P61's trusted-host key.
 */
export async function runP64Cli({
  argv = process.argv.slice(2),
  env = process.env,
  execute = runP64JournalAttempt,
  inspect = inspectP64LocalAttempt,
  stdout = process.stdout,
} = {}) {
  if (!Array.isArray(argv) || typeof stdout?.write !== 'function') {
    throw new Error('P64 operator command BLOCKED');
  }
  const result = argv.length === 2 && argv[0] === '--inspect-dir'
    ? inspect({ attemptDir: argv[1] })
    : await execute({ argv, env });
  stdout.write(JSON.stringify(result) + '\n');
  return result;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = await runP64Cli();
    if (result.outcome !== 'passed') process.exitCode = 2;
  } catch {
    // The thrown error might contain a credential, local path or raw JSON.
    process.stderr.write('P64 operator attempt BLOCKED\n');
    process.exitCode = 2;
  }
}
