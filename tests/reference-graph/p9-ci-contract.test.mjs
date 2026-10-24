import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW = readFileSync(new URL('../../.github/workflows/verify-reference-graph.yml', import.meta.url), 'utf8');
const README = readFileSync(new URL('../../reference-graph/README.md', import.meta.url), 'utf8');
const MIGRATION = readFileSync(new URL('../../reference-graph/schema/008_reference_graph_runtime_canary.sql', import.meta.url), 'utf8');
const CLIENT = readFileSync(new URL('../../reference-graph/p9-runtime-client.mjs', import.meta.url), 'utf8');
const CANARY = readFileSync(new URL('../../reference-graph/p9-runtime-canary.mjs', import.meta.url), 'utf8');
const CLI = readFileSync(new URL('../../reference-graph/cli/p9-runtime-canary.mjs', import.meta.url), 'utf8');

const RUNTIME_SOURCE = [CLIENT, CANARY, CLI].join('\n');

test('P9 governance secret-scans optional P9 evidence with the P9 receipt contract', () => {
  assert.match(WORKFLOW, /assertSecretFreeP9Receipt/);
  assert.match(WORKFLOW, /reference-graph\/evidence\/p9-runtime-canary-evidence\.json/);
});

test('P9 historical runtime boundary remains immutable while P11 owns current opt-in routing', () => {
  assert.match(WORKFLOW, /008_reference_graph_runtime_canary\.sql/);
  assert.match(WORKFLOW, /Verify immutable P9 runtime canary evidence/);
  assert.match(WORKFLOW, /p9-runtime-canary-evidence\.json/);
  assert.match(WORKFLOW, /Verify P11 production runtime default-off and profile isolation/);
  assert.match(WORKFLOW, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('P9 permanent DB smoke proves the narrow runtime wrapper and negative privilege matrix', () => {
  assert.match(WORKFLOW, /Smoke-test P9 least-privilege runtime wrapper and negative grants/);
  assert.match(WORKFLOW, /reference_graph_quick_candidate_pool_runtime_p9/);
  assert.match(WORKFLOW, /set role anon/);
  assert.match(WORKFLOW, /set role authenticated/);
  assert.match(WORKFLOW, /reference_graph_quick_candidate_pool_p7/);
  assert.match(WORKFLOW, /reference_graph_lexical_candidates_p6/);
  assert.match(WORKFLOW, /reference_graph_embedding_coverage/);
  assert.match(WORKFLOW, /reference_graph_ingest_capture/);
  assert.match(WORKFLOW, /reference_graph_record_verifications/);
  assert.match(WORKFLOW, /reference_graph_upsert_embeddings/);
  assert.match(WORKFLOW, /reference_graph\.assets|reference_graph\.sources|reference_graph\.chunks/);
  assert.match(WORKFLOW, /service_role/);
});

test('P9 runtime surfaces have no service-role credential or privileged operator path', () => {
  assert.doesNotMatch(RUNTIME_SOURCE, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(RUNTIME_SOURCE, /ReferenceGraphSupabaseStore/);
  assert.doesNotMatch(RUNTIME_SOURCE, /p[67]-(?:live|operator)|cli\/p[67]/i);
  assert.match(MIGRATION, /reference_graph_quick_candidate_pool_runtime_p9\(\)/);
  assert.match(MIGRATION, /grant execute[^;]*anon, authenticated, service_role/is);
});

test('P9 README documents shadow-only publishable transport and fail-closed legacy fallback', () => {
  assert.match(README, /P9/i);
  assert.match(README, /publishable/i);
  assert.match(README, /shadow/i);
  assert.match(README, /fallback/i);
  assert.match(README, /legacy-control/);
  assert.match(README, /standard/i);
  assert.match(README, /deep/i);
  assert.match(README, /no production activation|production activation.*false/i);
});
