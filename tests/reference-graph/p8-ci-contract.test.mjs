import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW = readFileSync(new URL('../../.github/workflows/verify-reference-graph.yml', import.meta.url), 'utf8');
const README = readFileSync(new URL('../../reference-graph/README.md', import.meta.url), 'utf8');

test('P8 governance secret-scans optional P8 evidence with the P8 receipt contract', () => {
  assert.match(WORKFLOW, /assertSecretFreeP8Receipt/);
  assert.match(WORKFLOW, /reference-graph\/evidence\/p8-cutover-review-evidence\.json/);
});

test('P8 governance pins the production query CLI blob and runtime credential boundary', () => {
  assert.match(WORKFLOW, /Verify P8 production CLI remains legacy-only/);
  assert.match(WORKFLOW, /4963cfbaf4306a03084f4513a1e324f649ce36e5/);
  assert.match(WORKFLOW, /git hash-object knowledge\/design-references\/scripts\/query\.mjs/);
  assert.match(WORKFLOW, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(WORKFLOW, /ReferenceGraphSupabaseStore/);
  assert.match(WORKFLOW, /quickCandidatePoolP7/);
  assert.match(WORKFLOW, /p7-parity-policy/);
  assert.match(WORKFLOW, /knowledge\/design-references/);
});

test('P8 governance executes the offline 24-case record and pattern handoff contract', () => {
  assert.match(WORKFLOW, /Verify P8 offline quick handoff contract/);
  assert.match(WORKFLOW, /p8-cutover-review\.mjs --offline-contract --reference-date 2026-10-23/);
  assert.match(WORKFLOW, /exact_handoff_count/);
  assert.match(WORKFLOW, /pattern_exact_count/);
  assert.match(WORKFLOW, /hydration_failure_count/);
  assert.match(WORKFLOW, /mismatch_count/);
});

test('P8 governance keeps P7 receipt semantics immutable while later phases preserve the P8 boundary', () => {
  assert.match(WORKFLOW, /p7-lexical-parity-evidence\.json/);
  assert.match(WORKFLOW, /average_overlap_at_k[^\n]*1|legacy_top1_retention_rate[^\n]*1/s);
  assert.match(WORKFLOW, /eligible_for_cutover_review/);
  assert.match(WORKFLOW, /production_source[^\n]*legacy-control/s);
  assert.match(WORKFLOW, /007_reference_graph_lexical_parity\.sql/);
  assert.match(WORKFLOW, /Verify immutable P8 runtime boundary/);
});

test('P8 README documents review-only quick eligibility and service-role non-runtime boundary', () => {
  assert.match(README, /P8/i);
  assert.match(README, /quick/i);
  assert.match(README, /review-only/i);
  assert.match(README, /service.?role/i);
  assert.match(README, /legacy-control/);
  assert.match(README, /standard/i);
  assert.match(README, /deep/i);
});
