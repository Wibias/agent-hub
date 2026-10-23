#!/usr/bin/env node

import { loadRecords, parseArgs } from '../../knowledge/design-references/scripts/lib.mjs';
import { planLegacyCatalogImport } from '../catalog-import.mjs';
import { buildEmbeddingRows, persistEmbeddingRows } from '../embedding-pipeline.mjs';
import {
  OLLAMA_MODEL_REVISION,
  OLLAMA_MODEL_TAG,
  OllamaEmbeddingProvider,
} from '../ollama-embeddings.mjs';
import { ReferenceGraphSupabaseStore } from '../supabase-store.mjs';

function usage() {
  return [
    'Usage:',
    '  node reference-graph/cli/embed-design-references.mjs --plan',
    '  node reference-graph/cli/embed-design-references.mjs --apply [--embed-batch-size 32] [--persist-batch-size 50]',
    '',
    '--plan performs no network calls and requires no credentials or Ollama.',
    '--apply requires a verified local Ollama model plus SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const planMode = args.plan === true;
  const applyMode = args.apply === true;
  if (planMode === applyMode) {
    throw new Error(`Choose exactly one of --plan or --apply.\n\n${usage()}`);
  }

  const records = loadRecords();
  const plan = planLegacyCatalogImport(records);
  const chunkCount = countChunks(plan.captures);
  const modelId = `ollama/${OLLAMA_MODEL_TAG}`;

  if (planMode) {
    console.log(JSON.stringify({
      mode: 'plan',
      applied: false,
      record_count: plan.record_count,
      capture_count: plan.capture_count,
      chunk_count: chunkCount,
      model_id: modelId,
      model_revision: OLLAMA_MODEL_REVISION,
    }, null, 2));
    return;
  }

  const embedBatchSize = parseBoundedInteger(
    args['embed-batch-size'],
    '--embed-batch-size',
    32,
    64,
  );
  const persistBatchSize = parseBoundedInteger(
    args['persist-batch-size'],
    '--persist-batch-size',
    50,
    100,
  );
  const provider = new OllamaEmbeddingProvider({ url: process.env.OLLAMA_URL });
  const store = ReferenceGraphSupabaseStore.fromEnv(process.env);
  const rows = await buildEmbeddingRows({
    captures: plan.captures,
    provider,
    batchSize: embedBatchSize,
  });
  const persisted = await persistEmbeddingRows({
    rows,
    store,
    batchSize: persistBatchSize,
  });

  console.log(JSON.stringify({
    mode: 'apply',
    applied: true,
    record_count: plan.record_count,
    chunk_count: chunkCount,
    embedding_count: rows.length,
    persisted_count: persisted.persisted_count,
    persist_batch_count: persisted.batch_count,
    model_id: provider.modelId,
    model_revision: provider.modelRevision,
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
