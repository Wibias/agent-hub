#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { loadPatterns, loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { auditP41ProfileServerShadow } from '../p41-profile-server-shadow.mjs';

const TARGET = 'https://vrznfnxzlxaavpqbzbzd.supabase.co/';
const KEYS = [
  'profile', 'limit', 'surface', 'platform',
  'job', 'dimensions', 'witness-file', 'witness-sha256',
];
const SHA256 = /^[0-9a-f]{64}$/;
function reject() {
  throw new TypeError('P41 operator input rejected');
}

/** Input-only helper: no network, logging, output writes or activation. */
export function planP41OperatorShadow({
  argv = [],
  env = process.env,
  readText = file => readFileSync(file, 'utf8'),
  records = loadRecords(),
  patterns = loadPatterns(),
  now = new Date(),
} = {}) {
  if (!Array.isArray(argv) || argv.length !== KEYS.length * 2
    || !(now instanceof Date) || Number.isNaN(now.valueOf())
    || !Array.isArray(records) || !Array.isArray(patterns)
    || typeof env?.P40_SUPABASE_SECRET_KEY !== 'string'
    || !env.P40_SUPABASE_SECRET_KEY.startsWith('sb_secret_')) reject();

  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (typeof flag !== 'string' || !flag.startsWith('--')
      || !KEYS.includes(flag.slice(2))
      || Object.hasOwn(args, flag.slice(2))
      || typeof value !== 'string' || value.trim() === '') reject();
    args[flag.slice(2)] = value;
  }
  if (Object.keys(args).length !== KEYS.length
    || !['standard', 'deep'].includes(args.profile)
    || !/^[0-9]+$/.test(args.limit)
    || !SHA256.test(args['witness-sha256'])
    || args['witness-file'].length > 4096
    || args['witness-file'].includes('\0')) reject();

  let sourceWitnessJson;
  try {
    sourceWitnessJson = readText(args['witness-file']);
  } catch {
    reject();
  }
  if (typeof sourceWitnessJson !== 'string') reject();

  return {
    records,
    patterns,
    request: {
      profile: args.profile,
      limit: Number(args.limit),
      surface: args.surface,
      platform: args.platform,
      job: args.job,
      dimensions: args.dimensions,
    },
    now,
    sourceWitnessJson,
    sourceWitnessSha256: args['witness-sha256'],
    supabaseUrl: TARGET,
    serviceKey: env.P40_SUPABASE_SECRET_KEY,
    accessMode: 'server',
    timeoutMs: 5000,
  };
}

export async function runP41OperatorShadow({
  argv = process.argv.slice(2),
  env = process.env,
  readText = file => readFileSync(file, 'utf8'),
  records = loadRecords(),
  patterns = loadPatterns(),
  now = new Date(),
  stdout = process.stdout,
} = {}) {
  const input = planP41OperatorShadow({
    argv, env, readText, records, patterns, now,
  });
  const report = await auditP41ProfileServerShadow(input);
  stdout.write(JSON.stringify(report));
  return report.status === 'exact' ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = await runP41OperatorShadow();
  } catch {
    process.stderr.write('P41 shadow BLOCKED: invalid input or server audit\n');
    process.exitCode = 2;
  }
}
