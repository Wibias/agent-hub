#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { evaluateP35ReleasePreflight } from '../p35-release-preflight.mjs';

const LOCK_PATH = fileURLToPath(new URL('../p35-pr-stack-lock.json', import.meta.url));
const SHA256 = /^[a-f0-9]{64}$/;

function requireArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 6
    || argv[0] !== '--evidence'
    || argv[2] !== '--sha256'
    || argv[4] !== '--as-of'
    || typeof argv[1] !== 'string' || !argv[1]
    || typeof argv[3] !== 'string' || !SHA256.test(argv[3])
    || typeof argv[5] !== 'string') {
    throw new Error('P35 requires --evidence PATH --sha256 SHA256 --as-of UTC');
  }
  return {
    file: argv[1],
    expectedHash: argv[3],
    asOf: argv[5],
  };
}

function exactKeys(value, keys) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}

/**
 * Strictly offline verifier of externally captured, hashed GitHub and
 * Supabase project-inventory snapshots. No network, writes, or secrets.
 * Exit 2 means policy remains NO-GO; exit 1 means malformed input.
 */
export function runP35ReleasePreflightCli({
  argv = process.argv.slice(2),
  stdout = process.stdout,
} = {}) {
  const { file, expectedHash, asOf } = requireArgs(argv);
  const evidenceBytes = readFileSync(file);
  if (evidenceBytes.byteLength > 500_000 || evidenceBytes.byteLength === 0
    || createHash('sha256').update(evidenceBytes).digest('hex') !== expectedHash) {
    throw new Error('P35 evidence byte pin invalid');
  }
  const payload = JSON.parse(evidenceBytes.toString('utf8'));
  if (!exactKeys(payload, ['githubSnapshot', 'projectInventory'])) {
    throw new Error('P35 evidence envelope invalid');
  }
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
  const report = evaluateP35ReleasePreflight({
    lock,
    githubSnapshot: payload.githubSnapshot,
    projectInventory: payload.projectInventory,
    asOf,
  });
  stdout.write(JSON.stringify(report, null, 2) + '\n');
  // The P35 gate intentionally has no deployment-eligible terminal state.
  // Do not return a success exit code simply because code review is complete.
  return 2;
}

const invokedAsMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsMain) {
  try {
    process.exitCode = runP35ReleasePreflightCli();
  } catch {
    // Never print local evidence, paths, tokens or raw error details.
    process.stderr.write('P35 release preflight failed: invalid or stale evidence\n');
    process.exitCode = 1;
  }
}
