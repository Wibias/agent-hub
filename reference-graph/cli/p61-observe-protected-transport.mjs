#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { observeP61ProtectedSnapshot } from '../p61-protected-soak.mjs';

const SHA256 = /^[a-f0-9]{64}$/;

function blocked() {
  throw new Error('P61 operator probe BLOCKED');
}

/**
 * No service key appears in argv, stdout, local report or the GitHub repo.
 * A trusted operator supplies P40_SUPABASE_SECRET_KEY in its own process
 * environment, then separately archives this non-authorizing JSON report.
 */
export async function runP61OperatorProbe({
  argv = process.argv.slice(2),
  env = process.env,
  readText = path => readFileSync(path, 'utf8'),
  observe = observeP61ProtectedSnapshot,
  stdout = process.stdout,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 4
    || argv[0] !== '--witness-file' || argv[2] !== '--witness-sha256'
    || typeof argv[1] !== 'string' || argv[1].length === 0
    || argv[1].length > 4096 || argv[1].includes('\0')
    || !SHA256.test(argv[3] ?? '')
    || typeof env?.P40_SUPABASE_SECRET_KEY !== 'string'
    || !env.P40_SUPABASE_SECRET_KEY.startsWith('sb_secret_')
    || typeof readText !== 'function' || typeof observe !== 'function'
    || typeof stdout?.write !== 'function') blocked();
  let witness;
  try {
    witness = readText(argv[1]);
  } catch { blocked(); }
  if (typeof witness !== 'string') blocked();

  const result = await observe({
    sourceWitnessJson: witness,
    sourceWitnessSha256: argv[3],
    serviceKey: env.P40_SUPABASE_SECRET_KEY,
  });
  stdout.write(JSON.stringify(result) + '\n');
  return result;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await runP61OperatorProbe();
  } catch {
    // Never print source witness, key, network response, or input file paths.
    process.stderr.write('P61 protected read-only transport BLOCKED\n');
    process.exitCode = 2;
  }
}
