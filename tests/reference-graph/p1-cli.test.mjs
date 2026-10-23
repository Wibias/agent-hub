import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const importCli = fileURLToPath(new URL('../../reference-graph/cli/import-design-references.mjs', import.meta.url));
const shadowCli = fileURLToPath(new URL('../../reference-graph/cli/shadow-design-references.mjs', import.meta.url));

test('catalog import CLI plans all 600 records without credentials or writes', () => {
  const result = spawnSync(process.execPath, [importCli, '--plan'], {
    encoding: 'utf8',
    env: {},
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, 'plan');
  assert.equal(output.capture_count, 600);
  assert.equal(output.record_count, 600);
  assert.equal(output.applied, false);
});

test('catalog import CLI refuses writes unless --apply is explicit', () => {
  const result = spawnSync(process.execPath, [importCli], {
    encoding: 'utf8',
    env: {},
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--plan|--apply/i);
});

test('offline shadow CLI evaluates all fixed cases without Supabase credentials', () => {
  const result = spawnSync(process.execPath, [shadowCli, '--offline'], {
    encoding: 'utf8',
    env: {},
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, 'offline-lexical');
  assert.equal(output.case_count, 24);
  assert.equal(output.production_source, 'legacy-control');
  assert.equal(typeof output.summary.cutover_ready, 'boolean');
});
