import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseTopLevelFrontmatterKeys,
  validateRepositoryRuntimePolicy,
} from '../../scripts/verify-portable-skills.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agent-runtime-test-'));
  await mkdir(join(root, 'skills', 'alpha'), { recursive: true });
  await mkdir(join(root, 'agent-runtime'), { recursive: true });
  await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ndescription: test\nmetadata:\n  version: 1\n---\n# Alpha\n`);
  await writeFile(join(root, 'agent-runtime', 'portable-skill-exceptions.json'), '{}\n');
  await writeFile(join(root, 'agent-runtime', 'skill-runtime.json'), JSON.stringify({
    version: 1,
    defaults: { reasoning: 'inherit', isolation: 'inherit', mutation: 'inherit' },
    skills: {},
  }, null, 2));
  return root;
}

test('frontmatter parser returns only top-level keys', () => {
  const keys = parseTopLevelFrontmatterKeys(`---\nname: demo\ndescription: >-\n  hello\nmetadata:\n  version: 2\n  author: x\nversion: 3\n---\nbody\n`);
  assert.deepEqual(keys, ['name', 'description', 'metadata', 'version']);
});

test('portable validator rejects unknown top-level field', async () => {
  const root = await fixture();
  await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ndescription: test\nmodel: pretend-model\n---\n`);
  const result = await validateRepositoryRuntimePolicy(root);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /skills\/alpha\/SKILL\.md.*model/);
});

test('exact documented exception permits one nonportable field', async () => {
  const root = await fixture();
  await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ndescription: test\nversion: 3\n---\n`);
  await writeFile(join(root, 'agent-runtime', 'portable-skill-exceptions.json'), JSON.stringify({
    'skills/alpha/SKILL.md': ['version'],
  }, null, 2));
  const result = await validateRepositoryRuntimePolicy(root);
  assert.deepEqual(result.errors, []);
});

test('runtime hints reject unknown skill and invalid semantic values', async () => {
  const root = await fixture();
  await writeFile(join(root, 'agent-runtime', 'skill-runtime.json'), JSON.stringify({
    version: 1,
    defaults: { reasoning: 'inherit', isolation: 'inherit', mutation: 'inherit' },
    skills: {
      missing: { reasoning: 'ultra' },
    },
  }, null, 2));
  const result = await validateRepositoryRuntimePolicy(root);
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.some((line) => /unknown skill.*missing/i.test(line)));
  assert.ok(result.errors.some((line) => /invalid reasoning.*ultra/i.test(line)));
});
