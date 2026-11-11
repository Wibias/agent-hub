#!/usr/bin/env node
import {
  TAXONOMY, loadRecords, loadPatterns, parseArgs,
} from './lib.mjs';
import { runP11RuntimeQuery } from '../../../reference-graph/p11-runtime-router.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeP69InstalledOffHost } from '../../../reference-graph/p69-installed-off-host.mjs';

/**
 * Actual Standard/Deep CLI entrypoint when P69 host binding is installed.
 * No Graph authorization exists here. Any signed lab canary remains denied.
 * Legacy selection/usage/output are unchanged, even if P68 is unavailable.
 */
export async function runP69BoundQuery({
  argv = process.argv.slice(2),
  env = process.env,
  records = loadRecords(),
  patterns = loadPatterns(),
  now = new Date(),
  probe = probeP69InstalledOffHost,
  query = runP11RuntimeQuery,
  stdout = process.stdout, stderr = process.stderr,
} = {}) {
  const args = parseArgs(argv);
  for (const required of ['surface','job','platform','dimensions']) {
    if (!args[required]) throw new Error('Missing --' + required);
  }
  const profile = args.profile || 'standard';
  if (!['standard','deep'].includes(profile)) {
    throw new Error('P69 Standard/Deep only; Quick is routed by the original P17 entrypoint');
  }
  const policy = TAXONOMY.profiles[profile];
  const limit = Number(args.limit || policy.default);
  if (!Number.isInteger(limit) || limit < policy.min || limit > policy.max) {
    throw new Error('Limit for ' + profile + ' must be ' + policy.min + '-' + policy.max);
  }
  const request = {
    profile,limit,
    surface: args.surface || '', platform: args.platform || '',
    job: args.job || '', dimensions: args.dimensions || '',
  };

  // Only a coordinator signed OFF is accepted. Missing config, network
  // failure, invalid signer and a signed LAB canary remain Legacy.
  const check = await probe({ configPath: env.AGENTHUB_P69_BINDING_FILE });
  if (env.AGENTHUB_P69_DIAGNOSTICS === '1') {
    stderr.write(check.signed_off
      ? 'P69_REAL_CLI_P68_SIGNED_OFF_CONNECTED\n'
      : 'P69_REAL_CLI_P68_UNAVAILABLE_OR_NOT_OFF_LEGACY\n');
  }
  const { result } = await query({
    records,patterns,request,now,graphMode:'legacy',
    recordUsageEnabled: !args['no-record-usage'],
    usageLogPath: args['usage-log'],
  });
  stdout.write(JSON.stringify(result, null, 2) + '\n');
  return { mode:'legacy', signed_off:check.signed_off,
    exitCode:result.coverageGaps.length ? 2 : 0 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const response = await runP69BoundQuery();
  process.exitCode = response.exitCode;
}
