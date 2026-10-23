import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

function read(relative) {
  return readFileSync(path.join(root, relative), 'utf8');
}

function run(relative, args = [], env = {}) {
  return spawnSync(process.execPath, [path.join(root, relative), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('P2 exposes an explicit embedding CLI with plan and apply boundaries', () => {
  const relative = 'reference-graph/cli/embed-design-references.mjs';
  assert.equal(existsSync(path.join(root, relative)), true, `${relative} must exist`);
  const source = read(relative);

  assert.match(source, /--plan/);
  assert.match(source, /--apply/);
  assert.match(source, /SUPABASE_URL/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /OllamaEmbeddingProvider/);
  assert.match(source, /persistEmbeddingRows/);
});

test('embedding CLI plan is credential-free and reports the pinned model without contacting services', () => {
  const result = run('reference-graph/cli/embed-design-references.mjs', ['--plan'], {
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    OLLAMA_URL: 'http://127.0.0.1:1',
  });

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.record_count, 600);
  assert.equal(body.chunk_count, 600);
  assert.equal(body.model_id, 'ollama/all-minilm:22m-l6-v2-fp16');
  assert.equal(body.model_revision, '1b226e2802db');
});

test('embedding CLI refuses work when neither plan nor apply is explicit', () => {
  const result = run('reference-graph/cli/embed-design-references.mjs');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly one.*--plan.*--apply|choose exactly one/i);
});

test('shadow CLI exposes separate ollama semantic and hybrid modes without changing production control', () => {
  const source = read('reference-graph/cli/shadow-design-references.mjs');

  assert.match(source, /--ollama-semantic/);
  assert.match(source, /--ollama-hybrid/);
  assert.match(source, /--control-date/);
  assert.match(source, /current_control_health/);
  assert.match(source, /production_source/);
  assert.match(source, /legacy-control/);
  assert.match(source, /semantic_enabled/);
});

test('offline shadow CLI can benchmark against the explicit healthy catalog snapshot', () => {
  const result = run(
    'reference-graph/cli/shadow-design-references.mjs',
    ['--offline', '--control-date', '2026-07-21'],
  );

  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.control_reference_time, '2026-07-21T12:00:00.000Z');
  assert.equal(body.control_health.healthy, true);
  assert.equal(body.control_health.fresh_pool_count, 600);
  assert.equal(body.current_control_health.healthy, false);
  assert.equal(body.production_source, 'legacy-control');
  assert.equal(body.case_count, 24);
});

test('shadow CLI rejects an invalid control date before retrieval work', () => {
  const result = run(
    'reference-graph/cli/shadow-design-references.mjs',
    ['--offline', '--control-date', 'not-a-date'],
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /control-date.*yyyy-mm-dd|invalid.*control date/i);
});
