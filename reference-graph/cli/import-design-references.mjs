#!/usr/bin/env node

import { loadRecords, parseArgs } from '../../knowledge/design-references/scripts/lib.mjs';
import { importLegacyCatalog, planLegacyCatalogImport } from '../catalog-import.mjs';
import { ReferenceGraphSupabaseStore } from '../supabase-store.mjs';
import {
  assertBoundSupabaseUrl,
  readTargetBinding,
  redactDiagnostics,
} from '../target-binding.mjs';

function usage() {
  return [
    'Usage:',
    '  node reference-graph/cli/import-design-references.mjs --plan',
    '  node reference-graph/cli/import-design-references.mjs --apply --target <path> [--batch-size 25]',
    '',
    '--plan performs no network calls and requires no credentials.',
    '--apply requires --target plus SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
  ].join('\n');
}

function parseBatchSize(value) {
  if (value === undefined) return 25;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error('--batch-size must be an integer between 1 and 100');
  }
  return parsed;
}

function planSummary(plan) {
  return {
    mode: 'plan',
    applied: false,
    record_count: plan.record_count,
    capture_count: plan.capture_count,
    source_count: plan.source_count,
    asset_count: plan.asset_count,
    deduplicated_assets: plan.deduplicated_assets,
  };
}

function requireTargetPath(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`--apply requires --target <path>.\n\n${usage()}`);
  }
  return value.trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const planMode = args.plan === true;
  const applyMode = args.apply === true;

  if (planMode === applyMode) {
    throw new Error(`Choose exactly one of --plan or --apply.\n\n${usage()}`);
  }

  const records = loadRecords();
  const plan = planLegacyCatalogImport(records);

  if (planMode) {
    console.log(JSON.stringify(planSummary(plan), null, 2));
    return;
  }

  const targetPath = requireTargetPath(args.target);
  const binding = readTargetBinding(targetPath);
  assertBoundSupabaseUrl({
    binding,
    supabaseUrl: process.env.SUPABASE_URL,
  });

  const batchSize = parseBatchSize(args['batch-size']);
  const store = ReferenceGraphSupabaseStore.fromEnv(process.env);
  const imported = await importLegacyCatalog({
    records,
    store,
    batchSize,
  });
  const stats = await store.stats();

  console.log(JSON.stringify({
    mode: 'apply',
    applied: true,
    target: binding,
    record_count: imported.record_count,
    capture_count: imported.capture_count,
    imported_count: imported.imported_count,
    batch_count: imported.batch_count,
    batch_size: batchSize,
    source_count: imported.source_count,
    asset_count: imported.asset_count,
    deduplicated_assets: imported.deduplicated_assets,
    store_stats: stats,
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redactDiagnostics(message, [process.env.SUPABASE_SERVICE_ROLE_KEY]));
  process.exitCode = 1;
});
