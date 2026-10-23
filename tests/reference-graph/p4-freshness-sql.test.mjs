import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeReferenceCapture } from '../../reference-graph/capture.mjs';
import { adaptLegacyDesignReference } from '../../reference-graph/legacy-import.mjs';
import { loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

test('P4 capture chunks carry the exact content SHA-256 used by embedding compatibility', () => {
  const content = 'Creator dashboard with a clear live-status hierarchy.';
  const capture = normalizeReferenceCapture({
    source: {
      canonicalUrl: 'https://example.com/dashboard',
      sourceKind: 'underlying-product',
    },
    asset: {
      kind: 'web-page',
      canonicalLocator: 'https://example.com/dashboard',
      capturedAt: '2026-10-23T00:00:00.000Z',
      contentText: content,
    },
    provenance: {},
  });

  assert.equal(capture.chunks.length, 1);
  assert.equal(capture.chunks[0].metadata.text_hash, sha256(content));
  assert.equal(capture.asset.content_hash, sha256(content));
});

test('P4 legacy adapter persists access status on the asset itself', () => {
  const record = loadRecords()[0];
  const capture = adaptLegacyDesignReference(record);

  assert.equal(capture.asset.metadata.access_status, record.accessStatus);
  assert.equal(capture.asset.metadata.legacy_id, record.id);
  assert.equal(capture.asset.provenance.review_status, record.reviewStatus);
  assert.equal(capture.asset.provenance.last_verified_at, record.lastVerifiedAt);
});

test('migration 005 adds append-only source verification evidence with closed access', () => {
  const sql = read('reference-graph/schema/005_reference_graph_freshness.sql');

  assert.match(sql, /create\s+table\s+reference_graph\.source_verifications/i);
  assert.match(sql, /decision_hash\s+text\s+primary\s+key/i);
  for (const column of ['legacy_id', 'verdict', 'verified_at', 'verifier', 'access_status', 'notes', 'metadata', 'created_at']) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, 'i'));
  }
  assert.match(sql, /alter\s+table\s+reference_graph\.source_verifications\s+enable\s+row\s+level\s+security/i);
  assert.match(sql, /revoke\s+all\s+on\s+reference_graph\.source_verifications\s+from\s+(?:public,\s*)?anon,\s*authenticated/i);
  assert.match(sql, /reference_graph_record_verifications\s*\(\s*p_verifications\s+jsonb/i);
  assert.match(sql, /on\s+conflict\s*\(\s*decision_hash\s*\)\s+do\s+nothing/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.reference_graph_record_verifications\s*\(\s*jsonb\s*\)\s+to\s+service_role/i);
  assert.doesNotMatch(sql, /grant\s+execute[^;]+\b(?:anon|authenticated)\b/is);
});

test('migration 005 defines one deterministic current legacy asset while keeping non-legacy assets', () => {
  const sql = read('reference-graph/schema/005_reference_graph_freshness.sql');

  assert.match(sql, /create\s+(?:or\s+replace\s+)?view\s+reference_graph\.current_assets/i);
  assert.match(sql, /partition\s+by\s+[^\n;]*legacy_id/i);
  assert.match(sql, /captured_at\s+desc[^;]*id\s+desc/is);
  assert.match(sql, /legacy_id\s+is\s+null/i);
  assert.match(sql, /row_number\s*\(/i);
});

test('migration 005 applies a shared explicit reference-date freshness predicate to retrieval', () => {
  const sql = read('reference-graph/schema/005_reference_graph_freshness.sql');

  for (const fn of [
    'reference_graph_lexical_candidates',
    'reference_graph_semantic_candidates',
    'reference_graph_candidate_context',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\b`, 'i'));
  }
  assert.match(sql, /reference_date/i);
  assert.match(sql, /current_date/i);
  assert.match(sql, /review_status/i);
  assert.match(sql, /access_status/i);
  assert.match(sql, /last_verified_at/i);
  assert.match(sql, /ttl_days/i);
  assert.match(sql, /\bAVAILABLE\b/i);
  assert.match(sql, /\bPAYWALLED\b/i);
  assert.match(sql, /reference_graph\.current_assets/i);
});

test('migration 005 embedding coverage is exact-model and text-hash bound', () => {
  const sql = read('reference-graph/schema/005_reference_graph_freshness.sql');

  assert.match(sql, /reference_graph_embedding_coverage\s*\(/i);
  assert.match(sql, /p_model_id\s+text/i);
  assert.match(sql, /p_model_revision\s+text/i);
  assert.match(sql, /p_reference_date\s+date/i);
  assert.match(sql, /model_id\s*=\s*p_model_id/i);
  assert.match(sql, /model_revision\s*=\s*p_model_revision/i);
  assert.match(sql, /text_hash/i);
  assert.match(sql, /metadata\s*->>\s*'text_hash'/i);
  for (const field of [
    'eligible_chunk_count',
    'compatible_count',
    'missing_count',
    'text_hash_mismatch_count',
    'coverage_rate',
  ]) {
    assert.match(sql, new RegExp(`\\b${field}\\b`, 'i'));
  }
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.reference_graph_embedding_coverage[^;]+service_role/is);
});
