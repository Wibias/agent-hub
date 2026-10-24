#!/usr/bin/env node

import { writeFileSync } from 'node:fs';

import { loadRecords, parseArgs } from '../../knowledge/design-references/scripts/lib.mjs';
import { planLegacyCatalogImport } from '../catalog-import.mjs';
import {
  assertCompleteEmbeddingCoverage,
  buildEmbeddingRows,
  createEmbeddingExportArtifact,
  persistEmbeddingRows,
} from '../embedding-pipeline.mjs';
import { REFERENCE_EMBEDDING_PROFILE } from '../embedding-profile.mjs';
import { OllamaEmbeddingProvider } from '../ollama-embeddings.mjs';
import { ReferenceGraphSupabaseStore } from '../supabase-store.mjs';
import {
  assertBoundSupabaseUrl,
  readTargetBinding,
  redactDiagnostics,
} from '../target-binding.mjs';

function usage() {
  return [
    'Usage:',
    '  node reference-graph/cli/embed-design-references.mjs --plan',
    '  node reference-graph/cli/embed-design-references.mjs --export-rows <path> [--embed-batch-size 32]',
    '  node reference-graph/cli/embed-design-references.mjs --apply --allow-experimental --target <path> [--embed-batch-size 32] [--persist-batch-size 50]',
    '',
    '--plan performs no network calls and requires no credentials or Ollama.',
    '--export-rows requires the pinned Ollama model but no Supabase credentials.',
    '--apply persists the current experimental profile and therefore requires --allow-experimental.',
    '--apply also requires --target, a verified local Ollama model, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY.',
  ].join('\n');
}

function parseBoundedInteger(value, name, fallback, max = 100) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return parsed;
}

function countChunks(captures) {
  return captures.reduce(
    (total, capture) => total + (Array.isArray(capture?.chunks) ? capture.chunks.length : 0),
    0,
  );
}

function profileOutput() {
  return {
    embedding_profile: REFERENCE_EMBEDDING_PROFILE.id,
    model_id: `ollama/${REFERENCE_EMBEDDING_PROFILE.modelTag}`,
    model_revision: REFERENCE_EMBEDDING_PROFILE.modelRevision,
    dimensions: REFERENCE_EMBEDDING_PROFILE.dimensions,
    quality_status: REFERENCE_EMBEDDING_PROFILE.qualityStatus,
    cutover_approved: REFERENCE_EMBEDDING_PROFILE.cutoverApproved,
  };
}

function requireTargetPath(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`--apply requires --target <path>.\n\n${usage()}`);
  }
  return value.trim();
}

function requireExportPath(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`--export-rows requires a path.\n\n${usage()}`);
  }
  return value.trim();
}

function assertSecretFreeExport(serialized, env = process.env) {
  for (const key of [
    'SUPABASE_SERVICE_ROLE_KEY',
    'DATABASE_PASSWORD',
    'SUPABASE_DB_PASSWORD',
    'ACCESS_TOKEN',
  ]) {
    const secret = env[key];
    if (typeof secret === 'string' && secret.length > 0 && serialized.includes(secret)) {
      throw new Error(`embedding export contains secret material from ${key}`);
    }
  }
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const planMode = args.plan === true;
  const applyMode = args.apply === true;
  const exportRequested = args['export-rows'] !== undefined;
  const selectedModes = Number(planMode) + Number(applyMode) + Number(exportRequested);
  if (selectedModes !== 1) {
    throw new Error(`Choose exactly one of --plan, --export-rows, or --apply.\n\n${usage()}`);
  }

  if (
    applyMode
    && REFERENCE_EMBEDDING_PROFILE.qualityStatus === 'experimental'
    && args['allow-experimental'] !== true
  ) {
    throw new Error(
      'The active embedding profile is experimental. Re-run with --allow-experimental to acknowledge experimental persistence.',
    );
  }

  const records = loadRecords();
  const plan = planLegacyCatalogImport(records);
  const chunkCount = countChunks(plan.captures);

  if (planMode) {
    console.log(JSON.stringify({
      mode: 'plan',
      applied: false,
      record_count: plan.record_count,
      capture_count: plan.capture_count,
      chunk_count: chunkCount,
      ...profileOutput(),
    }, null, 2));
    return;
  }

  let binding = null;
  let store = null;
  if (applyMode) {
    const targetPath = requireTargetPath(args.target);
    binding = readTargetBinding(targetPath);
    assertBoundSupabaseUrl({
      binding,
      supabaseUrl: process.env.SUPABASE_URL,
    });
    store = ReferenceGraphSupabaseStore.fromEnv(process.env);
  }

  const embedBatchSize = parseBoundedInteger(
    args['embed-batch-size'],
    '--embed-batch-size',
    32,
    64,
  );
  const provider = new OllamaEmbeddingProvider({
    url: process.env.OLLAMA_URL,
    modelTag: REFERENCE_EMBEDDING_PROFILE.modelTag,
    modelRevision: REFERENCE_EMBEDDING_PROFILE.modelRevision,
  });
  const rows = await buildEmbeddingRows({
    captures: plan.captures,
    provider,
    batchSize: embedBatchSize,
  });

  if (exportRequested) {
    const outputPath = requireExportPath(args['export-rows']);
    const artifact = createEmbeddingExportArtifact({
      rows,
      profile: REFERENCE_EMBEDDING_PROFILE,
    });
    const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
    assertSecretFreeExport(serialized);
    writeFileSync(outputPath, serialized, 'utf8');
    console.log(JSON.stringify({
      mode: 'export',
      applied: false,
      output: outputPath,
      record_count: plan.record_count,
      chunk_count: chunkCount,
      embedding_count: rows.length,
      ...profileOutput(),
    }, null, 2));
    return;
  }

  const persistBatchSize = parseBoundedInteger(
    args['persist-batch-size'],
    '--persist-batch-size',
    50,
    100,
  );
  const persisted = await persistEmbeddingRows({
    rows,
    store,
    batchSize: persistBatchSize,
  });
  const referenceDate = new Date().toISOString().slice(0, 10);
  const coverage = await store.embeddingCoverage(
    `ollama/${REFERENCE_EMBEDDING_PROFILE.modelTag}`,
    REFERENCE_EMBEDDING_PROFILE.modelRevision,
    referenceDate,
  );
  assertCompleteEmbeddingCoverage(coverage);

  console.log(JSON.stringify({
    mode: 'apply',
    applied: true,
    target: binding,
    reference_date: referenceDate,
    record_count: plan.record_count,
    chunk_count: chunkCount,
    embedding_count: rows.length,
    persisted_count: persisted.persisted_count,
    persist_batch_count: persisted.batch_count,
    embedding_coverage: coverage,
    ...profileOutput(),
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redactDiagnostics(message, [process.env.SUPABASE_SERVICE_ROLE_KEY]));
  process.exitCode = 1;
});
