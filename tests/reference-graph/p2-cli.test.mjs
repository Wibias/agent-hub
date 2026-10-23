import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

function read(relative) {
  return readFileSync(path.join(root, relative), 'utf8');
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

test('shadow CLI exposes separate ollama semantic and hybrid modes without changing production control', () => {
  const source = read('reference-graph/cli/shadow-design-references.mjs');

  assert.match(source, /--ollama-semantic/);
  assert.match(source, /--ollama-hybrid/);
  assert.match(source, /production_source/);
  assert.match(source, /legacy-control/);
  assert.match(source, /semantic_enabled/);
});
