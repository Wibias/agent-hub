import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const relative = 'reference-graph/cli/p5-live-quality.mjs';

function run(args = [], env = {}) {
  return spawnSync(process.execPath, [path.join(root, relative), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('P5 operator exposes only current control, embedding coverage, and live read-only shadow modes', () => {
  assert.equal(existsSync(path.join(root, relative)), true, `${relative} must exist`);
  const source = readFileSync(path.join(root, relative), 'utf8');

  for (const flag of [
    '--current-control',
    '--embedding-coverage',
    '--supabase-lexical',
    '--supabase-semantic',
    '--supabase-hybrid',
    '--reference-date',
    '--receipt-out',
  ]) {
    assert.match(source, new RegExp(flag.replaceAll('-', '\\-')));
  }
  assert.match(source, /legacy-control/);
  assert.match(source, /assertSecretFreeP5Receipt/);
  assert.match(source, /assertBoundSupabaseUrl/);
  assert.doesNotMatch(
    source,
    /persistCaptures\s*\(|persistEmbeddings\s*\(|recordVerifications\s*\(|reference_graph_ingest|apply migration/i,
  );
});

test('P5 network modes require target binding before any network work', () => {
  for (const flag of [
    '--embedding-coverage',
    '--supabase-lexical',
    '--supabase-semantic',
    '--supabase-hybrid',
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

test('P5 current-control mode is credential-free and reports the repaired healthy current control', () => {
  const result = run(['--current-control', '--reference-date', '2026-10-23'], {
    SUPABASE_SERVICE_ROLE_KEY: '',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.production_source, 'legacy-control');
  assert.equal(output.reference_date, '2026-10-23');
  assert.equal(output.current_control_health.fresh_pool_count, 275);
  assert.equal(output.current_control_health.cases_with_coverage_gaps, 0);
  assert.equal(output.current_control_health.healthy, true);
});

test('P5 operator requires exactly one explicit mode', () => {
  const noMode = run([], {});
  assert.notEqual(noMode.status, 0);
  assert.match(noMode.stderr, /exactly one/i);

  const twoModes = run(['--current-control', '--embedding-coverage'], {});
  assert.notEqual(twoModes.status, 0);
  assert.match(twoModes.stderr, /exactly one/i);
});

test('P5 operator source binds the exact embedding profile and current-date shadow evaluator', () => {
  const source = readFileSync(path.join(root, relative), 'utf8');
  assert.match(source, /REFERENCE_EMBEDDING_PROFILE/);
  assert.match(source, /embeddingCoverage/);
  assert.match(source, /runCatalogShadowEvaluation/);
  assert.match(source, /assessLegacyControlHealth/);
  assert.match(source, /reference_date|referenceDate/);
  assert.match(source, /createProfileQueryProvider|snowflake|modelRevision/i);
});
