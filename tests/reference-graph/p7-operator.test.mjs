import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const relative = 'reference-graph/cli/p7-live-quality.mjs';

function run(args = [], env = {}) {
  return spawnSync(process.execPath, [path.join(root, relative), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('P7 operator exposes exactly three read-only parity modes and no write path', () => {
  assert.equal(existsSync(path.join(root, relative)), true, `${relative} must exist`);
  const source = readFileSync(path.join(root, relative), 'utf8');

  for (const flag of [
    '--current-control',
    '--candidate-pool',
    '--supabase-p7-parity-lexical',
    '--reference-date',
    '--receipt-out',
  ]) {
    assert.match(source, new RegExp(flag.replaceAll('-', '\\-')));
  }
  assert.match(source, /createP7SupabaseShadowRetriever/);
  assert.match(source, /assertSecretFreeP7Receipt/);
  assert.match(source, /assertBoundSupabaseUrl/);
  assert.match(source, /quickCandidatePoolP7/);
  assert.match(source, /legacy-control/);
  assert.doesNotMatch(source, /persistCaptures\s*\(|persistEmbeddings\s*\(|recordVerifications\s*\(|reference_graph_ingest|apply migration/i);
  assert.doesNotMatch(source, /supabase-p7-(?:semantic|hybrid)|embedding-coverage/i);
});

test('P7 network modes require target binding before network work or credential disclosure', () => {
  for (const flag of ['--candidate-pool', '--supabase-p7-parity-lexical']) {
    const result = run([flag, '--reference-date', '2026-10-23'], {
      SUPABASE_URL: 'http://127.0.0.1:1',
      SUPABASE_SERVICE_ROLE_KEY: 'should-not-be-used',
    });
    assert.notEqual(result.status, 0, flag);
    assert.match(result.stderr, /target/i, flag);
    assert.equal(result.stderr.includes('should-not-be-used'), false, flag);
  }
});

test('P7 current-control mode is credential-free and preserves the healthy 275-record control', () => {
  const result = run(['--current-control', '--reference-date', '2026-10-23'], {
    SUPABASE_SERVICE_ROLE_KEY: '',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.production_source, 'legacy-control');
  assert.equal(output.reference_date, '2026-10-23');
  assert.equal(output.current_control_health.fresh_pool_count, 275);
  assert.equal(output.current_control_health.case_count, 24);
  assert.equal(output.current_control_health.full_limit_case_count, 24);
  assert.equal(output.current_control_health.cases_with_coverage_gaps, 0);
  assert.equal(output.current_control_health.healthy, true);
});

test('P7 operator requires exactly one explicit mode', () => {
  const noMode = run([], {});
  assert.notEqual(noMode.status, 0);
  assert.match(noMode.stderr, /exactly one/i);

  const twoModes = run(['--current-control', '--candidate-pool'], {});
  assert.notEqual(twoModes.status, 0);
  assert.match(twoModes.stderr, /exactly one/i);
});

test('P7 operator source uses full-pool parity evaluation and no semantic provider', () => {
  const source = readFileSync(path.join(root, relative), 'utf8');
  assert.match(source, /runCatalogShadowEvaluation/);
  assert.match(source, /assessLegacyControlHealth/);
  assert.match(source, /reference_date|referenceDate/);
  assert.match(source, /eligible_count/);
  assert.match(source, /unique_legacy_id_count/);
  assert.doesNotMatch(source, /OllamaEmbeddingProvider|createProfileQueryProvider|semanticCandidatesP6|createP6SupabaseShadowRetriever/);
});
