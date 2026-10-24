#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadRecords, parseArgs } from '../../knowledge/design-references/scripts/lib.mjs';
import { planLegacyCatalogImport } from '../catalog-import.mjs';
import { buildEmbeddingRows } from '../embedding-pipeline.mjs';
import {
  REFERENCE_EMBEDDING_PROFILE,
  createProfileQueryProvider,
} from '../embedding-profile.mjs';
import {
  createSupabaseShadowRetriever,
  probeCompatibleEmbeddings,
} from '../live-shadow.mjs';
import { createOfflineCatalogRetriever } from '../offline-shadow.mjs';
import { OllamaEmbeddingProvider } from '../ollama-embeddings.mjs';
import { createOfflineEmbeddedRetriever } from '../semantic-shadow.mjs';
import {
  assessLegacyControlHealth,
  runCatalogShadowEvaluation,
} from '../shadow-eval.mjs';
import { ReferenceGraphSupabaseStore } from '../supabase-store.mjs';
import { assertBoundSupabaseUrl, readTargetBinding } from '../target-binding.mjs';

const CASES_FILE = fileURLToPath(new URL('../shadow-cases.json', import.meta.url));
const PRODUCTION_CONTROL = 'legacy-control';

function usage() {
  return [
    'Usage:',
    '  node reference-graph/cli/shadow-design-references.mjs --offline [--control-date YYYY-MM-DD]',
    '  node reference-graph/cli/shadow-design-references.mjs --supabase --target <path> [--control-date YYYY-MM-DD]',
    '  node reference-graph/cli/shadow-design-references.mjs --supabase-semantic --target <path> [--control-date YYYY-MM-DD]',
    '  node reference-graph/cli/shadow-design-references.mjs --supabase-hybrid --target <path> [--control-date YYYY-MM-DD]',
    '  node reference-graph/cli/shadow-design-references.mjs --ollama-semantic [--control-date YYYY-MM-DD]',
    '  node reference-graph/cli/shadow-design-references.mjs --ollama-hybrid [--control-date YYYY-MM-DD]',
    '',
    '--offline uses deterministic lexical retrieval only and requires no credentials.',
    '--supabase uses deployed lexical service-role RPCs and requires a bound target plus Supabase credentials.',
    '--supabase-semantic queries compatible persisted document embeddings and embeds only queries locally.',
    '--supabase-hybrid fuses deployed lexical ranking with compatible persisted semantic ranking.',
    '--ollama-semantic evaluates the current experimental embedding profile locally without changing production selection.',
    '--ollama-hybrid evaluates the same local semantic signal fused with lexical ranking.',
    '--control-date freezes only the benchmark control clock; production behavior remains current-time legacy control.',
    `All modes keep production_source as ${PRODUCTION_CONTROL}.`,
  ].join('\n');
}

function loadCases() {
  const parsed = JSON.parse(readFileSync(CASES_FILE, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('shadow-cases.json must contain at least one case');
  }
  return parsed;
}

function parseControlDate(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('--control-date must be YYYY-MM-DD');
  }
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('--control-date must be a valid YYYY-MM-DD date');
  }
  return parsed;
}

function requireTarget(args) {
  if (typeof args.target !== 'string' || args.target.trim().length === 0) {
    throw new Error(`Supabase shadow modes require --target <path>.\n\n${usage()}`);
  }
  const binding = readTargetBinding(args.target.trim());
  assertBoundSupabaseUrl({
    binding,
    supabaseUrl: process.env.SUPABASE_URL,
  });
  return binding;
}

async function buildOllamaRetriever(records, mode) {
  const plan = planLegacyCatalogImport(records);
  const documentProvider = new OllamaEmbeddingProvider({
    url: process.env.OLLAMA_URL,
    modelTag: REFERENCE_EMBEDDING_PROFILE.modelTag,
    modelRevision: REFERENCE_EMBEDDING_PROFILE.modelRevision,
  });
  const queryProvider = createProfileQueryProvider(documentProvider);
  const embeddingRows = await buildEmbeddingRows({
    captures: plan.captures,
    provider: documentProvider,
    batchSize: 32,
  });
  return {
    graphRetrieve: createOfflineEmbeddedRetriever({
      captures: plan.captures,
      embeddingRows,
      provider: queryProvider,
      mode,
    }),
    provider: documentProvider,
    embeddingCount: embeddingRows.length,
  };
}

async function buildSupabaseRetriever(args, mode) {
  const target = requireTarget(args);
  const store = ReferenceGraphSupabaseStore.fromEnv(process.env);

  if (mode === 'lexical') {
    return {
      target,
      graphRetrieve: createSupabaseShadowRetriever({ store, mode: 'lexical' }),
      provider: null,
      embeddingAvailability: null,
    };
  }

  const documentProvider = new OllamaEmbeddingProvider({
    url: process.env.OLLAMA_URL,
    modelTag: REFERENCE_EMBEDDING_PROFILE.modelTag,
    modelRevision: REFERENCE_EMBEDDING_PROFILE.modelRevision,
  });
  const queryProvider = createProfileQueryProvider(documentProvider);
  const availability = await probeCompatibleEmbeddings({
    store,
    queryProvider,
    modelId: documentProvider.modelId,
    modelRevision: documentProvider.modelRevision,
  });

  return {
    target,
    graphRetrieve: createSupabaseShadowRetriever({
      store,
      queryProvider,
      mode,
      modelId: documentProvider.modelId,
      modelRevision: documentProvider.modelRevision,
    }),
    provider: documentProvider,
    embeddingAvailability: availability,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modes = [
    ['offline', args.offline === true],
    ['supabase', args.supabase === true],
    ['supabase-semantic', args['supabase-semantic'] === true],
    ['supabase-hybrid', args['supabase-hybrid'] === true],
    ['ollama-semantic', args['ollama-semantic'] === true],
    ['ollama-hybrid', args['ollama-hybrid'] === true],
  ].filter(([, enabled]) => enabled);

  if (modes.length !== 1) {
    throw new Error(`Choose exactly one shadow mode.\n\n${usage()}`);
  }

  const controlNow = parseControlDate(args['control-date']);
  const selectedMode = modes[0][0];
  const records = loadRecords();
  const cases = loadCases();
  const currentControlHealth = assessLegacyControlHealth({
    records,
    cases,
    now: new Date(),
  });
  let graphRetrieve;
  let mode;
  let semanticEnabled = false;
  let modelId = null;
  let modelRevision = null;
  let embeddingCount = null;
  let embeddingProfile = null;
  let embeddingAvailability = null;
  let qualityStatus = null;
  let cutoverApproved = false;
  let target = null;

  if (selectedMode === 'offline') {
    graphRetrieve = createOfflineCatalogRetriever(records);
    mode = 'offline-lexical';
  } else if (selectedMode === 'supabase') {
    const deployed = await buildSupabaseRetriever(args, 'lexical');
    graphRetrieve = deployed.graphRetrieve;
    target = deployed.target;
    mode = 'supabase-lexical';
  } else if (selectedMode === 'supabase-semantic' || selectedMode === 'supabase-hybrid') {
    const retrievalMode = selectedMode === 'supabase-semantic' ? 'semantic' : 'hybrid';
    const deployed = await buildSupabaseRetriever(args, retrievalMode);
    graphRetrieve = deployed.graphRetrieve;
    target = deployed.target;
    modelId = deployed.provider.modelId;
    modelRevision = deployed.provider.modelRevision;
    embeddingProfile = REFERENCE_EMBEDDING_PROFILE.id;
    embeddingAvailability = deployed.embeddingAvailability;
    qualityStatus = REFERENCE_EMBEDDING_PROFILE.qualityStatus;
    cutoverApproved = REFERENCE_EMBEDDING_PROFILE.cutoverApproved;
    semanticEnabled = embeddingAvailability.status === 'available';
    mode = selectedMode;

    if (!semanticEnabled) {
      console.log(JSON.stringify({
        mode,
        case_count: cases.length,
        production_source: PRODUCTION_CONTROL,
        target,
        control_reference_time: controlNow?.toISOString() ?? null,
        current_control_health: currentControlHealth,
        semantic_enabled: false,
        embedding_profile: embeddingProfile,
        embedding_availability: embeddingAvailability,
        quality_status: qualityStatus,
        cutover_approved: cutoverApproved,
        model_id: modelId,
        model_revision: modelRevision,
        summary: null,
        rows: [],
      }, null, 2));
      return;
    }
  } else {
    const embedded = await buildOllamaRetriever(
      records,
      selectedMode === 'ollama-semantic' ? 'semantic' : 'hybrid',
    );
    graphRetrieve = embedded.graphRetrieve;
    modelId = embedded.provider.modelId;
    modelRevision = embedded.provider.modelRevision;
    embeddingCount = embedded.embeddingCount;
    embeddingProfile = REFERENCE_EMBEDDING_PROFILE.id;
    qualityStatus = REFERENCE_EMBEDDING_PROFILE.qualityStatus;
    cutoverApproved = REFERENCE_EMBEDDING_PROFILE.cutoverApproved;
    semanticEnabled = true;
    mode = selectedMode;
  }

  const evaluation = await runCatalogShadowEvaluation({
    records,
    cases,
    graphRetrieve,
    controlNow,
  });
  if (evaluation.production_source !== PRODUCTION_CONTROL) {
    throw new Error(`unexpected production control: ${evaluation.production_source}`);
  }

  const output = {
    mode,
    case_count: cases.length,
    production_source: evaluation.production_source,
    target,
    control_reference_time: evaluation.control_reference_time,
    control_health: evaluation.control_health,
    current_control_health: currentControlHealth,
    semantic_enabled: semanticEnabled,
    embedding_profile: embeddingProfile,
    embedding_availability: embeddingAvailability,
    quality_status: qualityStatus,
    cutover_approved: cutoverApproved,
    model_id: modelId,
    model_revision: modelRevision,
    embedding_count: embeddingCount,
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
