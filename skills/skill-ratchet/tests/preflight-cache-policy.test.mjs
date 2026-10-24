import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runPreflight } from '../scripts/preflight.mjs';

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('preflight marks Codex plugin cache as discovery-only for mutations', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'skill-ratchet-cache-policy-'));
  const previousCodexHome = process.env.CODEX_HOME;
  const previousAgentsHome = process.env.AGENTS_HOME;

  t.after(async () => {
    restoreEnv('CODEX_HOME', previousCodexHome);
    restoreEnv('AGENTS_HOME', previousAgentsHome);
    await rm(tempRoot, { recursive: true, force: true });
  });

  process.env.CODEX_HOME = path.join(tempRoot, 'codex');
  process.env.AGENTS_HOME = path.join(tempRoot, 'agents');

  const cachedSkill = path.join(process.env.CODEX_HOME, 'plugins', 'cache', 'demo-skill');
  await mkdir(cachedSkill, { recursive: true });
  await writeFile(
    path.join(cachedSkill, 'SKILL.md'),
    [
      '---',
      'name: demo-skill',
      'description: Cached demo capability for mutation-policy testing.',
      '---',
      '',
      '# Demo Skill',
      '',
    ].join('\n'),
    'utf8',
  );

  const result = await runPreflight({
    query: 'cached demo capability',
    discoveryOnly: true,
    threshold: 0.1,
  });

  const cacheRoot = result.roots_checked.find((entry) => entry.label === 'codex-plugin-cache');
  assert.ok(cacheRoot, 'expected codex-plugin-cache root to be inventoried');
  assert.equal(cacheRoot.mutation_policy, 'discovery-only');

  const cachedCandidate = result.ranked.find((entry) => entry.source_root === 'codex-plugin-cache');
  assert.ok(cachedCandidate, 'expected cached skill to remain discoverable');
  assert.equal(cachedCandidate.mutation_policy, 'discovery-only');
});
