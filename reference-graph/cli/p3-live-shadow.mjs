#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadRecords, parseArgs } from '../../knowledge/design-references/scripts/lib.mjs';
import {
  REFERENCE_EMBEDDING_PROFILE,
  createProfileQueryProvider,
} from '../embedding-profile.mjs';
import {
  createSupabaseShadowRetriever,
  probeCompatibleEmbeddings,
} from '../live-shadow.mjs';
import { OllamaEmbeddingProvider } from '../ollama-embeddings.mjs';
import { assertSecretFreeReceipt } from '../p3-receipt.mjs';
import {
  assessLegacyControlHealth,
  runCatalogShadowEvaluation,
} from '../shadow-eval.mjs';
import { ReferenceGraphSupabaseStore } from '../supabase-store.mjs';
import { assertBoundSupabaseUrl, readTargetBinding } from '../target-binding.mjs';

const CASES_FILE = fileURLToPath(new URL('../shadow-cases.json', import.meta.url));
const BENCHMARK_CONTROL_TIME = '2026-07-21T12:00:00.000Z';
const PRODUCTION_SOURCE = 'legacy-control';
const EXPECTED_ASSETS = 600;
const EXPECTED_SOURCES = 576;

function usage() {
  return [
    'Usage:',
    '  node reference-graph/cli/p3-live-shadow.mjs --preflight --target <path> [--receipt-out <path>]',
    '  node reference-graph/cli/p3-live-shadow.mjs --verify-import --target <path> [--receipt-out <path>]',
    '  node reference-graph/cli/p3-live-shadow.mjs --verify-embeddings --target <path> [--receipt-out <path>]',
    '  node reference-graph/cli/p3-live-shadow.mjs --shadow-lexical --target <path> [--receipt-out <path>]',
    '  node reference-graph/cli/p3-live-shadow.mjs --shadow-semantic --target <path> [--receipt-out <path>]',
    '  node reference-graph/cli/p3-live-shadow.mjs --shadow-hybrid --target <path> [--receipt-out <path>]',
    '',
    'All modes are read-only and keep production_source as legacy-control.',
  ].join('\n');
}

function loadCases() {
  const value = JSON.parse(readFileSync(CASES_FILE, 'utf8'));
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('shadow-cases.json must contain at least one case');
  }
  return value;
}

function requireTargetPath(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`P3 live operations require --target <path>.\n\n${usage()}`);
  }
  return value.trim();
}

function requireCredential(env) {
  const value = env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for P3 live operations');
  }
  return value;
}

function resolveContext(args, env) {
  const target = readTargetBinding(requireTargetPath(args.target));
  assertBoundSupabaseUrl({ target, binding: target, supabaseUrl: env.SUPABASE_URL });
  const serviceRoleKey = requireCredential(env);
  return { target, serviceRoleKey };
}

function profileMetadata() {
  return {
    embedding_profile: REFERENCE_EMBEDDING_PROFILE.id,
    quality_status: REFERENCE_EMBEDDING_PROFILE.qualityStatus,
    cutover_approved: REFERENCE_EMBEDDING_PROFILE.cutoverApproved,
    model_id: `ollama/${REFERENCE_EMBEDDING_PROFILE.modelTag}`,
    model_revision: REFERENCE_EMBEDDING_PROFILE.modelRevision,
  };
}

function createQueryProvider() {
  const provider = new OllamaEmbeddingProvider({
    url: process.env.OLLAMA_URL,
    modelTag: REFERENCE_EMBEDDING_PROFILE.modelTag,
    modelRevision: REFERENCE_EMBEDDING_PROFILE.modelRevision,
  });
  return {
    provider,
    queryProvider: createProfileQueryProvider(provider),
  };
}

function baseOutput(mode, target) {
  return {
    mode,
    production_source: PRODUCTION_SOURCE,
    target,
    control_reference_time: BENCHMARK_CONTROL_TIME,
    current_control_health: null,
    embedding_availability: null,
    latency_ms: null,
  };
}

function emitOutput(output, { receiptOut, serviceRoleKey } = {}) {
  assertSecretFreeReceipt(output, [serviceRoleKey]);
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (receiptOut !== undefined) {
    if (typeof receiptOut !== 'string' || receiptOut.trim().length === 0) {
      throw new Error('--receipt-out requires a path');
    }
    writeFileSync(receiptOut.trim(), serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

async function shadowResult({ mode, target, store }) {
  const records = loadRecords();
  const cases = loadCases();
  const currentControlHealth = assessLegacyControlHealth({
    records,
    cases,
    now: new Date(),
  });

  let graphRetrieve;
  let embeddingAvailability = null;
  let semanticMetadata = {};

  if (mode === 'lexical') {
    graphRetrieve = createSupabaseShadowRetriever({ store, mode: 'lexical' });
  } else {
    const { provider, queryProvider } = createQueryProvider();
    embeddingAvailability = await probeCompatibleEmbeddings({
      store,
      queryProvider,
      modelId: provider.modelId,
      modelRevision: provider.modelRevision,
    });
    semanticMetadata = profileMetadata();

    if (embeddingAvailability.status === 'unavailable') {
      return {
        ...baseOutput(`supabase-${mode}`, target),
        current_control_health: currentControlHealth,
        embedding_availability: embeddingAvailability,
        ...semanticMetadata,
        case_count: cases.length,
        semantic_enabled: false,
        summary: null,
        rows: [],
      };
    }

    graphRetrieve = createSupabaseShadowRetriever({
      store,
      queryProvider,
      mode,
      modelId: provider.modelId,
      modelRevision: provider.modelRevision,
    });
  }

  const evaluation = await runCatalogShadowEvaluation({
    records,
    cases,
    graphRetrieve,
    controlNow: new Date(BENCHMARK_CONTROL_TIME),
  });
  if (evaluation.production_source !== PRODUCTION_SOURCE) {
    throw new Error(`unexpected production source: ${evaluation.production_source}`);
  }

  return {
    ...baseOutput(`supabase-${mode}`, target),
    current_control_health: currentControlHealth,
    embedding_availability: embeddingAvailability,
    ...semanticMetadata,
    case_count: cases.length,
    semantic_enabled: mode !== 'lexical',
    control_health: evaluation.control_health,
    summary: evaluation.summary,
    latency_ms: evaluation.summary.latency_ms,
    rows: evaluation.rows,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modes = [
    ['preflight', args.preflight === true],
    ['verify-import', args['verify-import'] === true],
    ['verify-embeddings', args['verify-embeddings'] === true],
    ['shadow-lexical', args['shadow-lexical'] === true],
    ['shadow-semantic', args['shadow-semantic'] === true],
    ['shadow-hybrid', args['shadow-hybrid'] === true],
  ].filter(([, enabled]) => enabled);

  if (modes.length !== 1) {
    throw new Error(`Choose exactly one P3 live mode.\n\n${usage()}`);
  }

  const selectedMode = modes[0][0];
  const { target, serviceRoleKey } = resolveContext(args, process.env);
  let output;

  if (selectedMode === 'preflight') {
    output = {
      ...baseOutput('preflight', target),
      credential_present: true,
      verified: true,
    };
  } else {
    const store = ReferenceGraphSupabaseStore.fromEnv(process.env);

    if (selectedMode === 'verify-import') {
      const stats = await store.stats();
      const assets = Number(stats.assets ?? 0);
      const sources = Number(stats.sources ?? 0);
      const verified = assets === EXPECTED_ASSETS && sources === EXPECTED_SOURCES;
      output = {
        ...baseOutput('verify-import', target),
        verified,
        expected: { assets: EXPECTED_ASSETS, sources: EXPECTED_SOURCES },
        store_stats: stats,
      };
      if (!verified) process.exitCode = 2;
    } else if (selectedMode === 'verify-embeddings') {
      const { provider, queryProvider } = createQueryProvider();
      const availability = await probeCompatibleEmbeddings({
        store,
        queryProvider,
        modelId: provider.modelId,
        modelRevision: provider.modelRevision,
      });
      output = {
        ...baseOutput('verify-embeddings', target),
        ...profileMetadata(),
        embedding_availability: availability,
        verified: availability.status === 'available',
      };
      if (!output.verified) process.exitCode = 2;
    } else {
      const retrievalMode = selectedMode.replace('shadow-', '');
      output = await shadowResult({ mode: retrievalMode, target, store });
    }
  }

  emitOutput(output, {
    receiptOut: args['receipt-out'],
    serviceRoleKey,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
