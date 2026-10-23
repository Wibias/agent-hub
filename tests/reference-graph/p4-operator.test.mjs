import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const relative = 'reference-graph/cli/p4-live-quality.mjs';

function run(args = [], env = {}) {
  return spawnSync(process.execPath, [path.join(root, relative), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('P4 operator exposes only read-only evidence modes and receipt output', () => {
  assert.equal(existsSync(path.join(root, relative)), true, `${relative} must exist`);
  const source = readFileSync(path.join(root, relative), 'utf8');

  for (const flag of [
    '--preflight',
    '--current-control',
    '--verify-import',
    '--verify-embeddings',
    '--shadow-lexical',
    '--shadow-semantic',
    '--shadow-hybrid',
    '--receipt-out',
  ]) {
    assert.match(source, new RegExp(flag.replaceAll('-', '\\-')));
  }
  assert.match(source, /legacy-control/);
  assert.match(source, /assertSecretFreeP4Receipt/);
  assert.match(source, /assertBoundSupabaseUrl/);
  assert.doesNotMatch(source, /persistCaptures\s*\(|persistEmbeddings\s*\(|recordVerifications\s*\(|reference_graph_ingest|apply migration/i);
});

test('P4 network evidence modes require target binding before network work', () => {
  for (const flag of ['--verify-import', '--verify-embeddings', '--shadow-lexical', '--shadow-semantic', '--shadow-hybrid']) {
    const result = run([flag], {
      SUPABASE_URL: 'http://127.0.0.1:1',
      SUPABASE_SERVICE_ROLE_KEY: 'should-not-be-used',
      OLLAMA_URL: 'http://127.0.0.1:1',
    });
    assert.notEqual(result.status, 0, flag);
    assert.match(result.stderr, /target/i, flag);
    assert.equal(result.stderr.includes('should-not-be-used'), false, flag);
  }
});

test('P4 preflight stays secret-free and requires exactly one explicit mode', () => {
  const noMode = run([], {});
  assert.notEqual(noMode.status, 0);
  assert.match(noMode.stderr, /exactly one/i);

  const twoModes = run(['--preflight', '--current-control'], {});
  assert.notEqual(twoModes.status, 0);
  assert.match(twoModes.stderr, /exactly one/i);
});

test('P4 operator source binds current-date graph and control evaluation and exact embedding profile', () => {
  const source = readFileSync(path.join(root, relative), 'utf8');
  assert.match(source, /REFERENCE_EMBEDDING_PROFILE/);
  assert.match(source, /embeddingCoverage/);
  assert.match(source, /runCatalogShadowEvaluation/);
  assert.match(source, /assessLegacyControlHealth/);
  assert.match(source, /reference_date|referenceDate/);
  assert.match(source, /snowflake|modelRevision|createProfileQueryProvider/i);
});
