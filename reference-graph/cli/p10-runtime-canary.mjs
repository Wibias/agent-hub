#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import {
  TAXONOMY,
  loadPatterns,
  loadRecords,
  parseArgs,
} from '../../knowledge/design-references/scripts/lib.mjs';
import { recordUsage } from '../../knowledge/design-references/scripts/usage.mjs';
import { fetchP10QuickCandidatePool } from '../p10-runtime-client.mjs';
import { runP9ShadowCanary } from '../p9-runtime-canary.mjs';

const STRICT_CANARY_FLAG = '--strict-canary';
const NO_RECORD_USAGE_FLAG = '--no-record-usage';

function requireReferenceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('--reference-date must use YYYY-MM-DD');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('--reference-date must be a valid YYYY-MM-DD date');
  }
  return value;
}

export function parseP10RuntimeCanaryArgs(argv, env = process.env) {
  const args = parseArgs(argv);
  for (const required of ['surface', 'job', 'platform', 'dimensions']) {
    if (!args[required]) throw new Error(`Missing --${required}`);
  }

  const profile = args.profile || 'standard';
  const policy = TAXONOMY.profiles[profile];
  if (!policy) throw new Error(`Unknown profile: ${profile}`);
  const limit = Number(args.limit || policy.default);
  if (!Number.isInteger(limit) || limit < policy.min || limit > policy.max) {
    throw new Error(`Limit for ${profile} must be ${policy.min}-${policy.max}`);
  }

  const request = {
    profile,
    limit,
    surface: String(args.surface),
    platform: String(args.platform),
    job: String(args.job),
    dimensions: String(args.dimensions),
  };

  let supabaseUrl = null;
  let publishableKey = null;
  let referenceDate = null;
  if (profile === 'quick') {
    supabaseUrl = args['supabase-url'] || env.SUPABASE_URL || null;
    publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || null;
    if (!supabaseUrl) throw new Error('Quick canary requires SUPABASE_URL or --supabase-url');
    if (!publishableKey) {
      throw new Error('Quick canary requires SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY');
    }
    referenceDate = requireReferenceDate(
      args['reference-date'] || new Date().toISOString().slice(0, 10),
    );
  }

  const timeoutMs = Number(args['timeout-ms'] || 1500);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('--timeout-ms must be a positive integer');
  }

  return {
    request,
    supabaseUrl,
    publishableKey,
    referenceDate,
    timeoutMs,
    strictCanary: Boolean(args[STRICT_CANARY_FLAG.slice(2)]),
    recordUsageEnabled: !args[NO_RECORD_USAGE_FLAG.slice(2)],
    usageLog: args['usage-log'] || undefined,
  };
}

export async function runP10RuntimeCanaryCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  fetchImpl = fetch,
} = {}) {
  const config = parseP10RuntimeCanaryArgs(argv, env);
  const fetchCandidatePool = config.request.profile === 'quick'
    ? () => fetchP10QuickCandidatePool({
        supabaseUrl: config.supabaseUrl,
        publishableKey: config.publishableKey,
        timeoutMs: config.timeoutMs,
        expectedDate: config.referenceDate,
        fetchImpl,
      })
    : undefined;

  const result = await runP9ShadowCanary({
    records: loadRecords(),
    patterns: loadPatterns(),
    request: config.request,
    fetchCandidatePool,
    recordUsageFn: (selected, request) => recordUsage(selected, request, config.usageLog),
    recordUsageEnabled: config.recordUsageEnabled,
  });

  stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (
    config.strictCanary
    && config.request.profile === 'quick'
    && result.graph_canary.status !== 'exact'
  ) {
    return 3;
  }
  if (result.coverageGaps.length > 0) return 2;
  return 0;
}

const isMain = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (isMain) {
  try {
    process.exitCode = await runP10RuntimeCanaryCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'P10 runtime canary failed');
    process.exitCode = 1;
  }
}
