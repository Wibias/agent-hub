import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW_PATH = '.github/workflows/verify-reference-graph-p19.yml';
const RUNBOOK_PATH = 'reference-graph/P19.md';

function workflow() {
  return readFileSync(WORKFLOW_PATH, 'utf8');
}

function runbook() {
  return readFileSync(RUNBOOK_PATH, 'utf8');
}

test('P19 governance runs permanent contract, secret, release, and disposable PostgreSQL gates', () => {
  const source = workflow();
  assert.match(source, /^name:\s*Reference graph P19 governance/m);
  assert.match(source, /pull_request\s*:/);
  assert.match(source, /push\s*:[\s\S]*branches\s*:[\s\S]*-\s+main/);
  assert.match(source, /actions\/setup-node@v4[\s\S]*node-version:\s*24/);
  assert.match(source, /node --test tests\/reference-graph\/p19-\*\.test\.mjs/);
  assert.match(source, /scan_secrets\.py reference-graph/);
  assert.match(source, /node scripts\/verify-public-release\.mjs/);
  assert.match(source, /image:\s*pgvector\/pgvector:pg16/);
  assert.match(source, /create role anon/i);
  assert.match(source, /create role authenticated/i);
  assert.match(source, /create role service_role/i);
});

test('P19 governance applies Reference Graph migrations 001 through 011 in exact order', () => {
  const source = workflow();
  const migrations = [
    '001_reference_graph.sql',
    '002_reference_graph_rpc.sql',
    '003_reference_graph_embeddings_rpc.sql',
    '004_reference_graph_lexical_overlap.sql',
    '005_reference_graph_freshness.sql',
    '006_reference_graph_retrieval_quality.sql',
    '007_reference_graph_lexical_parity.sql',
    '008_reference_graph_runtime_canary.sql',
    '009_reference_graph_runtime_projection.sql',
    '010_reference_graph_activation_grant_consumption.sql',
    '011_reference_graph_activation_attestation.sql',
  ];
  let previous = -1;
  for (const migration of migrations) {
    const index = source.indexOf(migration);
    assert.ok(index > previous, `${migration} must appear after the previous migration`);
    previous = index;
  }
});

test('P19 PostgreSQL smoke consumes one synthetic P16 row then attests only its public hashes', () => {
  const source = workflow();
  assert.match(source, /reference_graph_consume_activation_grant_nonce_p16/i);
  assert.match(source, /reference_graph_attest_activation_consumption_p19/i);
  assert.match(source, /matching_count/i);
  assert.match(source, /total_count/i);
  assert.match(source, /exact_match/i);
  assert.match(source, /expected.*matching_count.*1|matching_count.*expected.*1/is);
  assert.match(source, /expected.*total_count.*1|total_count.*expected.*1/is);
});

test('P19 governance proves service-role-only attestation without widening P16 table privileges', () => {
  const source = workflow();
  assert.match(source, /has_function_privilege\(\s*'anon'.*reference_graph_attest_activation_consumption_p19.*EXECUTE/is);
  assert.match(source, /has_function_privilege\(\s*'authenticated'.*reference_graph_attest_activation_consumption_p19.*EXECUTE/is);
  assert.match(source, /has_function_privilege\(\s*'service_role'.*reference_graph_attest_activation_consumption_p19.*EXECUTE/is);
  assert.match(source, /has_table_privilege\(\s*'anon'.*activation_grant_consumptions_p16.*SELECT/is);
  assert.match(source, /has_table_privilege\(\s*'authenticated'.*activation_grant_consumptions_p16.*SELECT/is);
  assert.match(source, /has_table_privilege\(\s*'service_role'.*activation_grant_consumptions_p16.*SELECT/is);
  assert.match(source, /has_table_privilege\(\s*'service_role'.*activation_grant_consumptions_p16.*INSERT/is);
});

test('P19 workflow is disposable-only and contains no production activation or production-project credential path', () => {
  const source = workflow();
  assert.doesNotMatch(source, /vrznfnxzlxaavpqbzbzd/);
  assert.doesNotMatch(source, /SUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY|PUBLISHABLE_KEY|URL)/);
  assert.doesNotMatch(source, /--activate-production|ACTIVATE-QUICK-REFERENCE-GRAPH/);
  assert.doesNotMatch(source, /executeP17Activation|applyP17LocalActivation|rollbackP17LocalActivation/);
});

test('P19 runbook separates one-time elevated attestation, publishable-only hourly soak, and later promotion authority', () => {
  const source = runbook();
  assert.match(source, /migration 011/i);
  assert.match(source, /after.*governance|governance.*after/is);
  assert.match(source, /--attest-consumption/);
  assert.match(source, /SUPABASE_SECRET_KEY/);
  assert.match(source, /Remove-Item Env:SUPABASE_SECRET_KEY/);
  assert.match(source, /Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /--sample/);
  assert.match(source, /hourly|every hour/i);
  assert.match(source, /publishable/i);
  assert.match(source, /p19-soak\.jsonl/);
  assert.match(source, /--evaluate/);
  assert.match(source, /24\s*(?:hours?|h)/i);
  assert.match(source, /eligible.*not.*permission|not.*permission.*eligible/is);
  assert.match(source, /new.*grant|consumed.*grant.*never.*reuse|never.*reuse.*grant/is);
});
