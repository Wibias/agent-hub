import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const CLI_URL = new URL('../../reference-graph/cli/p8-cutover-review.mjs', import.meta.url);
const CLI_PATH = CLI_URL.pathname;
const CLI_SOURCE = readFileSync(CLI_URL, 'utf8');

function run(args, env = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('P8 operator exposes exactly offline-contract and supabase-quick-review modes', () => {
  assert.match(CLI_SOURCE, /offline-contract/);
  assert.match(CLI_SOURCE, /supabase-quick-review/);
  for (const forbidden of [
    'current-control',
    'candidate-pool',
    'supabase-p7-parity-lexical',
    '--apply',
  ]) {
    assert.equal(CLI_SOURCE.includes(forbidden), false, `forbidden mode leaked: ${forbidden}`);
  }
});

test('P8 offline contract is credential-free and proves 24/24 record plus pattern handoff parity', () => {
  const result = run([
    '--offline-contract',
    '--reference-date', '2026-10-23',
  ], {
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, 'offline-contract');
  assert.equal(output.production_source, 'legacy-control');
  assert.equal(output.activation_performed, false);
  assert.equal(output.reference_date, '2026-10-23');
  assert.equal(output.candidate_pool.eligible_count, 275);
  assert.equal(output.candidate_pool.complete_metadata_count, 275);
  assert.equal(output.candidate_pool.unique_legacy_id_count, 275);
  assert.equal(output.review.status, 'available');
  assert.equal(output.review.case_count, 24);
  assert.equal(output.review.exact_handoff_count, 24);
  assert.equal(output.review.mismatch_count, 0);
  assert.equal(output.review.pattern_exact_count, 24);
  assert.equal(output.review.hydration_failure_count, 0);
  assert.equal(output.rows.length, 24);
  for (const row of output.rows) {
    assert.equal(row.handoff_exact, true, row.case_id);
    assert.equal(row.pattern_handoff_exact, true, row.case_id);
  }
});

test('P8 operator requires exactly one explicit mode', () => {
  const none = run([]);
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /exactly one P8 cutover review mode/i);

  const both = run(['--offline-contract', '--supabase-quick-review']);
  assert.notEqual(both.status, 0);
  assert.match(both.stderr, /exactly one P8 cutover review mode/i);
});

test('P8 live review requires target binding before credential or network work', () => {
  const result = run([
    '--supabase-quick-review',
    '--reference-date', '2026-10-23',
  ], {
    SUPABASE_URL: 'https://vrznfnxzlxaavpqbzbzd.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'should-not-be-disclosed',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--target/);
  assert.equal(result.stderr.includes('should-not-be-disclosed'), false);
});

test('P8 operator source passes reference_date to the P7 pool and never records usage or invokes write paths', () => {
  assert.match(CLI_SOURCE, /quickCandidatePoolP7\(\{\s*reference_date:/s);
  assert.equal(/recordUsage/.test(CLI_SOURCE), false);
  for (const forbidden of ['ingestCapture', 'recordVerifications', 'upsertEmbeddings', 'persistEmbeddingRows']) {
    assert.equal(CLI_SOURCE.includes(forbidden), false, `write path leaked: ${forbidden}`);
  }
});

test('P8 operator keeps graph review quick-only and uses the canonical pattern selector', () => {
  assert.match(CLI_SOURCE, /selectPatterns/);
  assert.match(CLI_SOURCE, /request\.profile\s*!==\s*['"]quick['"]/);
  assert.match(CLI_SOURCE, /P8 graph review supports quick requests only/);
});

test('P8 live credential failures are redacted', () => {
  assert.match(CLI_SOURCE, /redactDiagnostics/);
  assert.match(CLI_SOURCE, /SUPABASE_SERVICE_ROLE_KEY/);
});
