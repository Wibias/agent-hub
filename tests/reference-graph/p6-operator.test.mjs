import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const relative = 'reference-graph/cli/p6-live-quality.mjs';

function run(args = [], env = {}) {
  return spawnSync(process.execPath, [path.join(root, relative), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('P6 operator exposes exactly the five read-only quality modes and P6 boundaries', () => {
  assert.equal(existsSync(path.join(root, relative)), true, `${relative} must exist`);
  const source = readFileSync(path.join(root, relative), 'utf8');

  for (const flag of [
    '--current-control',
    '--embedding-coverage',
    '--supabase-p6-lexical',
    '--supabase-p6-semantic',
    '--supabase-p6-hybrid',
    '--reference-date',
    '--receipt-out',
  ]) {
    assert.match(source, new RegExp(flag.replaceAll('-', '\\-')));
  }
  assert.match(source, /createP6SupabaseShadowRetriever/);
  assert.match(source, /assertSecretFreeP6Receipt/);
  assert.match(source, /assertBoundSupabaseUrl/);
  assert.match(source, /legacy-control/);
  assert.doesNotMatch(
    source,
    /persistCaptures\s*\(|persistEmbeddings\s*\(|recordVerifications\s*\(|reference_graph_ingest|apply migration/i,
  );
});

test('P6 network modes require target binding before any network work or credential disclosure', () => {
  for (const flag of [
    '--embedding-coverage',
    '--supabase-p6-lexical',
    '--supabase-p6-semantic',
    '--supabase-p6-hybrid',
  ]) {
    const result = run([flag, '--reference-date', '2026-10-23'], {
      SUPABASE_URL: 'http://127.0.0.1:1',
      SUPABASE_SERVICE_ROLE_KEY: 'should-not-be-used',
      OLLAMA_URL: 'http://127.0.0.1:1',
    });
    assert.notEqual(result.status, 0, flag);
    assert.match(result.stderr, /target/i, flag);
    assert.equal(result.stderr.includes('should-not-be-used'), false, flag);
  }
});

test('P6 current-control mode remains credential-free and measures the unchanged healthy control', () => {
  const result = run(['--current-control', '--reference-date', '2026-10-23'], {
    SUPABASE_SERVICE_ROLE_KEY: '',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.production_source, 'legacy-control');
  assert.equal(output.reference_date, '2026-10-23');
  assert.equal(output.current_control_health.case_count, 24);
  assert.equal(output.current_control_health.full_limit_case_count, 24);
  assert.equal(output.current_control_health.cases_with_coverage_gaps, 0);
  assert.equal(output.current_control_health.healthy, true);
});

test('P6 operator requires exactly one explicit mode', () => {
  const noMode = run([], {});
  assert.notEqual(noMode.status, 0);
  assert.match(noMode.stderr, /exactly one/i);

  const twoModes = run(['--current-control', '--embedding-coverage'], {});
  assert.notEqual(twoModes.status, 0);
  assert.match(twoModes.stderr, /exactly one/i);
});

test('P6 operator pins exact embedding identity and blocks semantic paths without complete coverage', () => {
  const source = readFileSync(path.join(root, relative), 'utf8');
  assert.match(source, /REFERENCE_EMBEDDING_PROFILE/);
  assert.match(source, /embeddingCoverage/);
  assert.match(source, /eligible_chunk_count/);
  assert.match(source, /text_hash_mismatch_count/);
  assert.match(source, /createProfileQueryProvider/);
  assert.match(source, /runCatalogShadowEvaluation/);
  assert.match(source, /assessLegacyControlHealth/);
  assert.match(source, /reference_date|referenceDate/);
});
