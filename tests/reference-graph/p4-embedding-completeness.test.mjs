import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { REFERENCE_EMBEDDING_PROFILE } from '../../reference-graph/embedding-profile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

function row(id, overrides = {}) {
  return {
    chunk_id: id,
    model_id: 'ollama/snowflake-arctic-embed:33m',
    model_revision: 'e8db018629b4',
    text_hash: id.padEnd(64, 'a').slice(0, 64),
    embedding: Array(384).fill(0.01),
    ...overrides,
  };
}

test('P4 embedding summary is exact-profile bound and rejects malformed rows', async () => {
  const { summarizeExpectedEmbeddingRows } = await import('../../reference-graph/embedding-pipeline.mjs');
  const rows = [row('b'), row('a')];

  assert.deepEqual(summarizeExpectedEmbeddingRows(rows, REFERENCE_EMBEDDING_PROFILE), {
    row_count: 2,
    model_id: 'ollama/snowflake-arctic-embed:33m',
    model_revision: 'e8db018629b4',
    dimensions: 384,
    text_hash_count: 2,
  });

  assert.throws(
    () => summarizeExpectedEmbeddingRows([row('x', { embedding: Array(383).fill(0.01) })], REFERENCE_EMBEDDING_PROFILE),
    /384|dimension/i,
  );
  assert.throws(
    () => summarizeExpectedEmbeddingRows([row('x', { embedding: [...Array(383).fill(0.01), Number.NaN] })], REFERENCE_EMBEDDING_PROFILE),
    /finite|number/i,
  );
  assert.throws(
    () => summarizeExpectedEmbeddingRows([row('x', { model_revision: 'wrong' })], REFERENCE_EMBEDDING_PROFILE),
    /revision|profile/i,
  );
});

test('P4 export artifact sorts rows deterministically and exposes only public profile metadata', async () => {
  const { createEmbeddingExportArtifact } = await import('../../reference-graph/embedding-pipeline.mjs');
  const artifact = createEmbeddingExportArtifact({
    rows: [row('chunk-z'), row('chunk-a')],
    profile: REFERENCE_EMBEDDING_PROFILE,
  });

  assert.equal(artifact.schema_version, 'reference-graph.embedding-export.v1');
  assert.deepEqual(artifact.rows.map((entry) => entry.chunk_id), ['chunk-a', 'chunk-z']);
  assert.deepEqual(artifact.profile, {
    id: 'snowflake-arctic-embed-33m-raw-v1',
    model_id: 'ollama/snowflake-arctic-embed:33m',
    model_revision: 'e8db018629b4',
    dimensions: 384,
    quality_status: 'experimental',
    cutover_approved: false,
  });
  assert.equal(JSON.stringify(artifact).includes('queryPrefix'), false);
  assert.equal(JSON.stringify(artifact).includes('service'), false);
});

test('P4 completeness gate rejects partial coverage and text-hash mismatch', async () => {
  const { assertCompleteEmbeddingCoverage } = await import('../../reference-graph/embedding-pipeline.mjs');

  assert.throws(() => assertCompleteEmbeddingCoverage({
    eligible_chunk_count: 600,
    compatible_count: 599,
    missing_count: 1,
    text_hash_mismatch_count: 0,
    coverage_rate: 599 / 600,
  }), /incomplete|coverage|missing/i);

  assert.throws(() => assertCompleteEmbeddingCoverage({
    eligible_chunk_count: 600,
    compatible_count: 599,
    missing_count: 0,
    text_hash_mismatch_count: 1,
    coverage_rate: 599 / 600,
  }), /hash|mismatch|coverage/i);

  assert.equal(assertCompleteEmbeddingCoverage({
    eligible_chunk_count: 600,
    compatible_count: 600,
    missing_count: 0,
    text_hash_mismatch_count: 0,
    coverage_rate: 1,
  }), true);
});

test('embedding CLI exposes exactly plan export and apply modes and hard-gates apply coverage', () => {
  const source = readFileSync(path.join(root, 'reference-graph/cli/embed-design-references.mjs'), 'utf8');

  assert.match(source, /--export-rows/);
  assert.match(source, /assertCompleteEmbeddingCoverage/);
  assert.match(source, /embeddingCoverage/);
  assert.match(source, /writeFileSync/);
  assert.match(source, /--allow-experimental/);
  assert.match(source, /export.*no Supabase|no Supabase.*export/is);
});
