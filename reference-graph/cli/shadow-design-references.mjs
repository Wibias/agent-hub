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
import { createOfflineCatalogRetriever } from '../offline-shadow.mjs';
import { OllamaEmbeddingProvider } from '../ollama-embeddings.mjs';
import { createOfflineEmbeddedRetriever } from '../semantic-shadow.mjs';
import {
  assessLegacyControlHealth,
  runCatalogShadowEvaluation,
} from '../shadow-eval.mjs';
import { ReferenceGraphSupabaseStore } from '../supabase-store.mjs';

const CASES_FILE = fileURLToPath(new URL('../shadow-cases.json', import.meta.url));
const PRODUCTION_CONTROL = 'legacy-control';

function usage() {
  return [
    'Usage:',
    '  node reference-graph/cli/shadow-design-references.mjs --offline [--control-date YYYY-MM-DD]',
    '  node reference-graph/cli/shadow-design-references.mjs --supabase [--control-date YYYY-MM-DD]',
    '  node reference-graph/cli/shadow-design-references.mjs --ollama-semantic [--control-date YYYY-MM-DD]',
    '  node reference-graph/cli/shadow-design-references.mjs --ollama-hybrid [--control-date YYYY-MM-DD]',
    '',
    '--offline uses deterministic lexical retrieval only and requires no credentials.',
    '--supabase uses deployed lexical service-role RPCs and requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    '--ollama-semantic evaluates the current experimental embedding profile without changing production selection.',
    '--ollama-hybrid evaluates the same experimental semantic signal fused with lexical ranking.',
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modes = [
    ['offline', args.offline === true],
    ['supabase', args.supabase === true],
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
  let qualityStatus = null;
  let cutoverApproved = false;

  if (selectedMode === 'offline') {
    graphRetrieve = createOfflineCatalogRetriever(records);
    mode = 'offline-lexical';
  } else if (selectedMode === 'supabase') {
    const store = ReferenceGraphSupabaseStore.fromEnv(process.env);
    graphRetrieve = async ({ query, filters, maxItems }) => store.retrieve({
      query,
      filters,
      maxItems,
    });
    mode = 'supabase-lexical';
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
    control_reference_time: evaluation.control_reference_time,
    control_health: evaluation.control_health,
    current_control_health: currentControlHealth,
    semantic_enabled: semanticEnabled,
    embedding_profile: embeddingProfile,
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
