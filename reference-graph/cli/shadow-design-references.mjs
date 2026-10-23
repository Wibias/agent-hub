#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadRecords, parseArgs } from '../../knowledge/design-references/scripts/lib.mjs';
import { createOfflineCatalogRetriever } from '../offline-shadow.mjs';
import { runCatalogShadowEvaluation } from '../shadow-eval.mjs';
import { ReferenceGraphSupabaseStore } from '../supabase-store.mjs';

const CASES_FILE = fileURLToPath(new URL('../shadow-cases.json', import.meta.url));

function usage() {
  return [
    'Usage:',
    '  node reference-graph/cli/shadow-design-references.mjs --offline',
    '  node reference-graph/cli/shadow-design-references.mjs --supabase',
    '',
    '--offline uses deterministic lexical retrieval only and requires no credentials.',
    '--supabase uses the deployed service-role RPCs and requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    'Neither mode changes the production selector; legacy remains the control.',
  ].join('\n');
}

function loadCases() {
  const parsed = JSON.parse(readFileSync(CASES_FILE, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('shadow-cases.json must contain at least one case');
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const offline = args.offline === true;
  const supabase = args.supabase === true;

  if (offline === supabase) {
    throw new Error(`Choose exactly one of --offline or --supabase.\n\n${usage()}`);
  }

  const records = loadRecords();
  const cases = loadCases();
  let graphRetrieve;
  let mode;

  if (offline) {
    graphRetrieve = createOfflineCatalogRetriever(records);
    mode = 'offline-lexical';
  } else {
    const store = ReferenceGraphSupabaseStore.fromEnv(process.env);
    graphRetrieve = async ({ query, filters, maxItems }) => store.retrieve({
      query,
      filters,
      maxItems,
    });
    mode = 'supabase-lexical';
  }

  const evaluation = await runCatalogShadowEvaluation({
    records,
    cases,
    graphRetrieve,
  });

  const output = {
    mode,
    case_count: cases.length,
    production_source: evaluation.production_source,
    semantic_enabled: false,
    summary: evaluation.summary,
    rows: evaluation.rows,
  };
  console.log(JSON.stringify(output, null, 2));

  if (args['require-ready'] === true && !evaluation.summary.cutover_ready) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
