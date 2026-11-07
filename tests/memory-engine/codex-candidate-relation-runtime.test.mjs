import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCodexMemoryCandidateRelationJudge } from '../../scripts/judge-memory-relations.mjs';
import { createCodexMemoryCandidateJudge } from '../../scripts/judge-memory-candidates.mjs';

async function fakeCodexRun({ fail = false } = {}, run) {
  const root = await mkdtemp(join(tmpdir(), 'memory-shell-free-'));
  const codexHome = join(root, 'codex-home');
  const runner = join(root, 'fake-codex.mjs');
  try {
    await mkdir(codexHome, { recursive: true });
    await writeFile(join(codexHome, 'auth.json'), '{}');
    const source = fail
      ? "process.stderr.write('SECRET-STDERR'); process.stdout.write('SECRET-STDOUT'); process.exit(1);"
      : "import { writeFileSync } from 'node:fs';\nconst index = process.argv.indexOf('--output-last-message');\nif (index < 0) process.exit(2);\nwriteFileSync(process.argv[index + 1], '{\"probe\":\"ok\"}');\n";
    await writeFile(runner, source);
    return await run({ runner, codexHome });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('relation judge executes a synthetic local Node fixture without shell', async () => {
  await fakeCodexRun({}, async ({ runner, codexHome }) => {
    const resource = await createCodexMemoryCandidateRelationJudge({
      cwd: process.cwd(),
      sourceCodexHome: codexHome,
      env: { ...process.env, CODEX_BIN: runner },
    });
    try {
      const response = await resource.judge({ prompt: 'synthetic unrelated relation test' });
      assert.deepEqual(JSON.parse(response), { probe: 'ok' });
      assert.equal(resource.isolation.inheritedHooks, false);
    } finally {
      await resource.close();
    }
  });
});

test('relation judge failure does not contain stderr, stdout, or sensitive content', async () => {
  await fakeCodexRun({ fail: true }, async ({ runner, codexHome }) => {
    const resource = await createCodexMemoryCandidateRelationJudge({
      cwd: process.cwd(),
      sourceCodexHome: codexHome,
      env: { ...process.env, CODEX_BIN: runner },
    });
    try {
      await assert.rejects(
        resource.judge({ prompt: 'PRIVATE TEST CANDIDATE' }),
        (error) => error.message === 'codex relation judge failed with exit 1: unknown',
      );
    } finally {
      await resource.close();
    }
  });
});

test('importance judge also executes a synthetic local Node fixture without shell', async () => {
  await fakeCodexRun({}, async ({ runner, codexHome }) => {
    const resource = await createCodexMemoryCandidateJudge({
      cwd: process.cwd(),
      sourceCodexHome: codexHome,
      env: { ...process.env, CODEX_BIN: runner },
    });
    try {
      const response = await resource.judge({
        id: 'synthetic-probe',
        proposed_type: 'constraint',
        source_authority: 'user_direct',
        proposed_value: 'Test filenames remain lowercase.',
      });
      assert.deepEqual(JSON.parse(response), { probe: 'ok' });
    } finally {
      await resource.close();
    }
  });
});
