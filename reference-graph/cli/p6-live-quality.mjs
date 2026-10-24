#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadRecords, parseArgs } from '../../knowledge/design-references/scripts/lib.mjs';
import {
  REFERENCE_EMBEDDING_PROFILE,
  createProfileQueryProvider,
} from '../embedding-profile.mjs';
import { OllamaEmbeddingProvider } from '../ollama-embeddings.mjs';
import { createP6SupabaseShadowRetriever } from '../p6-live-shadow.mjs';
import { assertSecretFreeP6Receipt } from '../p6-receipt.mjs';
import {
  assessLegacyControlHealth,
  runCatalogShadowEvaluation,
} from '../shadow-eval.mjs';
import { ReferenceGraphSupabaseStore } from '../supabase-store.mjs';
import {
  assertBoundSupabaseUrl,
  readTargetBinding,
  redactDiagnostics,
} from '../target-binding.mjs';

const CASES_FILE = fileURLToPath(new URL('../shadow-cases.json', import.meta.url));
const PRODUCTION_SOURCE = 'legacy-control';

function usage() {
  return [
    'Usage:',
    '  node reference-graph/cli/p6-live-quality.mjs --current-control [--reference-date YYYY-MM-DD] [--receipt-out <path>]',
    '  node reference-graph/cli/p6-live-quality.mjs --embedding-coverage --target <path> [--reference-date YYYY-MM-DD] [--receipt-out <path>]',
    '  node reference-graph/cli/p6-live-quality.mjs --supabase-p6-lexical --target <path> [--reference-date YYYY-MM-DD] [--receipt-out <path>]',
    '  node reference-graph/cli/p6-live-quality.mjs --supabase-p6-semantic --target <path> [--reference-date YYYY-MM-DD] [--receipt-out <path>]',
    '  node reference-graph/cli/p6-live-quality.mjs --supabase-p6-hybrid --target <path> [--reference-date YYYY-MM-DD] [--receipt-out <path>]',
    '',
    'All P6 modes are read-only. production_source remains legacy-control.',
  ].join('\n');
}

function loadCases() {
  const cases = JSON.parse(readFileSync(CASES_FILE, 'utf8'));
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('shadow-cases.json must contain at least one case');
  }
  return cases;
}

function parseReferenceDate(value) {
  const raw = value === undefined
    ? new Date().toISOString().slice(0, 10)
    : String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error('--reference-date must be YYYY-MM-DD');
  }
  const date = new Date(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw new Error('--reference-date must be YYYY-MM-DD');
  }
  return { referenceDate: raw, controlNow: date };
}

function requireTargetPath(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`P6 live network modes require --target <path>.\n\n${usage()}`);
  }
  return value.trim();
}

function requireCredential(env) {
  const value = env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for P6 live network modes');
  }
  return value;
}

function resolveNetworkContext(args, env) {
  const target = readTargetBinding(requireTargetPath(args.target));
  assertBoundSupabaseUrl({ binding: target, supabaseUrl: env.SUPABASE_URL });
  const serviceRoleKey = requireCredential(env);
  return { target, serviceRoleKey };
}

function profileMetadata() {
  return {
    embedding_profile: REFERENCE_EMBEDDING_PROFILE.id,
    model_id: `ollama/${REFERENCE_EMBEDDING_PROFILE.modelTag}`,
    model_revision: REFERENCE_EMBEDDING_PROFILE.modelRevision,
    dimensions: REFERENCE_EMBEDDING_PROFILE.dimensions,
    quality_status: REFERENCE_EMBEDDING_PROFILE.qualityStatus,
    cutover_approved: REFERENCE_EMBEDDING_PROFILE.cutoverApproved,
  };
}

function createQueryProvider(env) {
  const documentProvider = new OllamaEmbeddingProvider({
    url: env.OLLAMA_URL,
    modelTag: REFERENCE_EMBEDDING_PROFILE.modelTag,
    modelRevision: REFERENCE_EMBEDDING_PROFILE.modelRevision,
  });
  return {
    documentProvider,
    queryProvider: createProfileQueryProvider(documentProvider),
  };
}

function exactEmbeddingCoverage(coverage) {
  return Number(coverage?.eligible_chunk_count) === 275
    && Number(coverage?.compatible_count) === 275
    && Number(coverage?.missing_count) === 0
    && Number(coverage?.text_hash_mismatch_count) === 0
    && Number(coverage?.coverage_rate) === 1;
}

function baseOutput(mode, referenceDate, target = null) {
  return {
    mode,
    production_source: PRODUCTION_SOURCE,
    reference_date: referenceDate,
    target,
    current_control_health: null,
    embedding_coverage: null,
    status: null,
    summary: null,
  };
}

function emitOutput(output, { receiptOut, serviceRoleKey = null } = {}) {
  assertSecretFreeP6Receipt(output, [serviceRoleKey]);
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (receiptOut !== undefined) {
    if (typeof receiptOut !== 'string' || receiptOut.trim().length === 0) {
      throw new Error('--receipt-out requires a path');
    }
    writeFileSync(receiptOut.trim(), serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

function currentControlEvidence(referenceDate, controlNow) {
  const records = loadRecords();
  const cases = loadCases();
  return {
    records,
    cases,
    health: assessLegacyControlHealth({ records, cases, now: controlNow }),
    reference_date: referenceDate,
  };
}

async function readEmbeddingCoverage(store, referenceDate) {
  return store.embeddingCoverage(
    `ollama/${REFERENCE_EMBEDDING_PROFILE.modelTag}`,
    REFERENCE_EMBEDDING_PROFILE.modelRevision,
    referenceDate,
  );
}

async function shadowEvidence({ mode, target, store, referenceDate, controlNow, env }) {
  const { records, cases, health } = currentControlEvidence(referenceDate, controlNow);
  if (health.healthy !== true) {
    return {
      ...baseOutput(`supabase-p6-${mode}`, referenceDate, target),
      current_control_health: health,
      status: 'blocked',
      blockers: ['current legacy control is unhealthy'],
      case_count: cases.length,
      rows: [],
    };
  }

  let embeddingCoverage = null;
  let queryProvider = null;
  let modelId = null;
  let modelRevision = null;

  if (mode !== 'lexical') {
    embeddingCoverage = await readEmbeddingCoverage(store, referenceDate);
    if (!exactEmbeddingCoverage(embeddingCoverage)) {
      return {
        ...baseOutput(`supabase-p6-${mode}`, referenceDate, target),
        ...profileMetadata(),
        current_control_health: health,
        embedding_coverage: embeddingCoverage,
        semantic_enabled: false,
        status: 'incomplete',
        blockers: ['exact-profile embedding coverage is incomplete or text-hash mismatched'],
        case_count: cases.length,
        rows: [],
      };
    }

    const providers = createQueryProvider(env);
    queryProvider = providers.queryProvider;
    modelId = providers.documentProvider.modelId;
    modelRevision = providers.documentProvider.modelRevision;
  }

  const graphRetrieve = createP6SupabaseShadowRetriever({
    store,
    queryProvider,
    mode,
    modelId,
    modelRevision,
    candidateLimit: 24,
  });
  const evaluation = await runCatalogShadowEvaluation({
    records,
    cases,
    graphRetrieve,
    controlNow,
  });
  if (evaluation.production_source !== PRODUCTION_SOURCE) {
    throw new Error(`unexpected production source: ${evaluation.production_source}`);
  }

  return {
    ...baseOutput(`supabase-p6-${mode}`, referenceDate, target),
    ...(mode === 'lexical' ? {} : profileMetadata()),
    current_control_health: health,
    embedding_coverage: embeddingCoverage,
    semantic_enabled: mode !== 'lexical',
    status: 'available',
    case_count: cases.length,
    control_health: evaluation.control_health,
    summary: evaluation.summary,
    latency_ms: evaluation.summary.latency_ms,
    rows: evaluation.rows,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modes = [
    ['current-control', args['current-control'] === true],
    ['embedding-coverage', args['embedding-coverage'] === true],
    ['supabase-p6-lexical', args['supabase-p6-lexical'] === true],
    ['supabase-p6-semantic', args['supabase-p6-semantic'] === true],
    ['supabase-p6-hybrid', args['supabase-p6-hybrid'] === true],
  ].filter(([, enabled]) => enabled);

  if (modes.length !== 1) {
    throw new Error(`Choose exactly one P6 live quality mode.\n\n${usage()}`);
  }

  const selectedMode = modes[0][0];
  const { referenceDate, controlNow } = parseReferenceDate(args['reference-date']);
  let serviceRoleKey = null;
  let output;

  if (selectedMode === 'current-control') {
    const { health } = currentControlEvidence(referenceDate, controlNow);
    output = {
      ...baseOutput('current-control', referenceDate),
      current_control_health: health,
      status: health.healthy ? 'available' : 'blocked',
    };
  } else {
    const context = resolveNetworkContext(args, process.env);
    serviceRoleKey = context.serviceRoleKey;
    const { target } = context;
    const store = ReferenceGraphSupabaseStore.fromEnv(process.env);

    if (selectedMode === 'embedding-coverage') {
      const coverage = await readEmbeddingCoverage(store, referenceDate);
      const verified = exactEmbeddingCoverage(coverage);
      output = {
        ...baseOutput('embedding-coverage', referenceDate, target),
        ...profileMetadata(),
        embedding_coverage: coverage,
        verified,
        status: verified ? 'available' : 'incomplete',
      };
      if (!verified) process.exitCode = 2;
    } else {
      output = await shadowEvidence({
        mode: selectedMode.replace('supabase-p6-', ''),
        target,
        store,
        referenceDate,
        controlNow,
        env: process.env,
      });
    }
  }

  emitOutput(output, {
    receiptOut: args['receipt-out'],
    serviceRoleKey,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redactDiagnostics(message, [process.env.SUPABASE_SERVICE_ROLE_KEY]));
  process.exitCode = 1;
});
