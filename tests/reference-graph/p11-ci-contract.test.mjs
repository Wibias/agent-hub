import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW = readFileSync(new URL('../../.github/workflows/verify-reference-graph.yml', import.meta.url), 'utf8');
const README = readFileSync(new URL('../../reference-graph/README.md', import.meta.url), 'utf8');
const QUERY = readFileSync(new URL('../../knowledge/design-references/scripts/query.mjs', import.meta.url), 'utf8');
const ROUTER = readFileSync(new URL('../../reference-graph/p11-runtime-router.mjs', import.meta.url), 'utf8');
const RUNTIME_SOURCE = `${QUERY}\n${ROUTER}`;

test('P11 governance secret-scans optional activation evidence with the P11 receipt contract', () => {
  assert.match(WORKFLOW, /assertSecretFreeP11Receipt/);
  assert.match(WORKFLOW, /reference-graph\/evidence\/p11-quick-activation-evidence\.json/);
});

test('P11 governance replaces historical query blob pin with default-off runtime invariants', () => {
  assert.match(WORKFLOW, /Verify P11 production runtime default-off and profile isolation/);
  assert.match(WORKFLOW, /REFERENCE_GRAPH_QUICK_RUNTIME/);
  assert.match(WORKFLOW, /default.*legacy|legacy.*default/i);
  assert.match(WORKFLOW, /standard.*no-network|standard.*zero-network/i);
  assert.match(WORKFLOW, /deep.*no-network|deep.*zero-network/i);
  assert.doesNotMatch(WORKFLOW, /EXPECTED_QUERY_BLOB='4963cfbaf4306a03084f4513a1e324f649ce36e5'/);
});

test('P11 permanent governance pins immutable P10 evidence and keeps migrations ending at 009', () => {
  assert.match(WORKFLOW, /Verify immutable P10 runtime projection evidence/);
  assert.match(WORKFLOW, /p10-runtime-projection-evidence\.json/);
  assert.match(WORKFLOW, /009_reference_graph_runtime_projection\.sql/);
  assert.doesNotMatch(WORKFLOW, /010_reference_graph/);
});

test('P11 runtime governance forbids benchmark leakage and service-role credentials', () => {
  assert.match(WORKFLOW, /Verify P11 runtime source is benchmark independent and least privilege/);
  assert.match(WORKFLOW, /shadow-cases|evidence/i);
  assert.match(WORKFLOW, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(RUNTIME_SOURCE, /SUPABASE_SERVICE_ROLE_KEY|service[_-]?role[_-]?(?:key|token|secret)/i);
  assert.doesNotMatch(RUNTIME_SOURCE, /shadow-cases\.json|p(?:7|8|9|10|11).*evidence\.json/i);
});

test('P11 production query keeps graph activation exact, quick-only, publishable-only, and reversible', () => {
  assert.match(QUERY, /REFERENCE_GRAPH_QUICK_RUNTIME/);
  assert.match(QUERY, /graphMode === "graph"/);
  assert.match(QUERY, /request\.profile === "quick"/);
  assert.match(QUERY, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(QUERY, /fetchP10QuickCandidatePool/);
  assert.match(QUERY, /timeoutMs: 1500/);
  assert.match(QUERY, /runP11RuntimeQuery/);
});

test('P11 README documents opt-in quick activation, exact parity fallback, and unchanged standard/deep legacy behavior', () => {
  assert.match(README, /P11/i);
  assert.match(README, /REFERENCE_GRAPH_QUICK_RUNTIME/);
  assert.match(README, /quick/i);
  assert.match(README, /exact.*record|record.*exact/i);
  assert.match(README, /exact.*pattern|pattern.*exact/i);
  assert.match(README, /fallback/i);
  assert.match(README, /publishable/i);
  assert.match(README, /standard.*legacy|legacy.*standard/i);
  assert.match(README, /deep.*legacy|legacy.*deep/i);
  assert.match(README, /default.*legacy|legacy.*default/i);
  assert.match(README, /no global activation|not globally activated|activation_performed.*false/i);
});
