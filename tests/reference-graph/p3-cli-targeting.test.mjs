import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const importCli = fileURLToPath(new URL('../../reference-graph/cli/import-design-references.mjs', import.meta.url));
const embedCli = fileURLToPath(new URL('../../reference-graph/cli/embed-design-references.mjs', import.meta.url));

function targetFile(projectRef = 'abcdefghijklmnopqrst') {
  const dir = mkdtempSync(join(tmpdir(), 'reference-graph-p3-'));
  const path = join(dir, 'target.json');
  writeFileSync(path, JSON.stringify({
    purpose: 'agent-hub-reference-graph',
    project_ref: projectRef,
    project_name: 'agent-hub-reference-graph',
    region: 'eu-central-1',
  }));
  return path;
}

test('P3 keeps import and embedding plan modes credential-free and target-free', () => {
  for (const cli of [importCli, embedCli]) {
    const result = spawnSync(process.execPath, [cli, '--plan'], {
      encoding: 'utf8',
      env: {},
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /--target/i);
  }
});

test('P3 import apply requires an explicit target before constructing the Supabase store', () => {
  const result = spawnSync(process.execPath, [importCli, '--apply'], {
    encoding: 'utf8',
    env: {
      SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--target/i);
});

test('P3 embedding apply requires target binding before Ollama or persistence work', () => {
  const result = spawnSync(
    process.execPath,
    [embedCli, '--apply', '--allow-experimental'],
    {
      encoding: 'utf8',
      env: {
        SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--target/i);
});

test('P3 write CLIs reject a target whose project ref does not match SUPABASE_URL', () => {
  const target = targetFile('abcdefghijklmnopqrst');
  const env = {
    SUPABASE_URL: 'https://zyxwvutsrqponmlkjihg.supabase.co',
  };

  const importResult = spawnSync(
    process.execPath,
    [importCli, '--apply', '--target', target],
    { encoding: 'utf8', env },
  );
  assert.notEqual(importResult.status, 0);
  assert.match(importResult.stderr, /project ref/i);

  const embedResult = spawnSync(
    process.execPath,
    [embedCli, '--apply', '--allow-experimental', '--target', target],
    { encoding: 'utf8', env },
  );
  assert.notEqual(embedResult.status, 0);
  assert.match(embedResult.stderr, /project ref/i);
});
