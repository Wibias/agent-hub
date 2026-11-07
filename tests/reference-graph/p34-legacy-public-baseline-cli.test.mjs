import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../../reference-graph/cli/p34-freeze-legacy-public-baseline.mjs', import.meta.url));

test('P34 freeze CLI emits exactly 48 deterministic legacy-control public JSON fingerprints', () => {
  const run = spawnSync(process.execPath, [cli, '--date', '2026-11-07'], {
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  const report = JSON.parse(run.stdout);
  assert.deepEqual(Object.keys(report).sort(), [
    'cases', 'reference_date', 'schema_version',
  ]);
  assert.equal(report.schema_version, 'reference-graph.p34-legacy-public-baseline.v1');
  assert.equal(report.reference_date, '2026-11-07');
  assert.equal(report.cases.length, 48);
  const keys = new Set();
  for (const row of report.cases) {
    assert.deepEqual(Object.keys(row).sort(), [
      'profile', 'public_output_sha256', 'source_case_id',
    ]);
    assert.match(row.public_output_sha256, /^[a-f0-9]{64}$/);
    assert.ok(['standard', 'deep'].includes(row.profile));
    keys.add(row.source_case_id + ':' + row.profile);
  }
  assert.equal(keys.size, 48);
  assert.doesNotMatch(run.stdout, /"records":|"patterns":|"canonicalUrl":|search_text|__file|sb_secret_|SUPABASE_SERVICE_ROLE_KEY/);
});

test('P34 freeze CLI rejects missing, malformed, future-meaningless and extra switches', () => {
  for (const args of [[], ['--date', '2026-02-30'], ['--date', 'bad'],
    ['--date', '2026-11-07', '--activate'], ['--profile', 'standard']]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.status, 1, String(args));
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^P34 legacy public baseline failed:/);
  }
});

test('P34 freeze CLI is read-only, legacy-only and cannot contact Supabase', () => {
  const source = readFileSync(cli, 'utf8');
  assert.match(source, /graphMode: 'legacy'/);
  assert.match(source, /recordUsageEnabled: false/);
  assert.doesNotMatch(source, /fetchP30|fetch\(|process\.env|SUPABASE_SERVICE_ROLE_KEY|writeFileSync|selectP29ProfileCandidateIds|auditP34PatternPublicOutputParity/);
});
