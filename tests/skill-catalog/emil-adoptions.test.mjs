import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateSkill } from '../../skills/skill-ratchet/scripts/validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

async function assertStructurallyValid(skill) {
  const skillRoot = path.join(root, 'skills', skill);
  assert.equal(existsSync(skillRoot), true, `${skill} skill must exist`);
  const result = await validateSkill({ skillRoot });
  assert.equal(result.ok, true, `${skill} structural validation failed:\n${result.errors.join('\n')}`);
}

test('fortify owns executable worst-case UI stress testing', async () => {
  const skill = read('skills/fortify/SKILL.md');
  assert.match(skill, /worst-case <surface>/i);
  assert.match(skill, /references\/worst-case-data\.md/);
  assert.equal(existsSync(path.join(root, 'skills/fortify/references/worst-case-data.md')), true);
  await assertStructurallyValid('fortify');
});

test('design-with-ai owns motion building plus mobile-web and native motion branches', async () => {
  const skill = read('skills/design-with-ai/SKILL.md');
  assert.match(skill, /motion-build <target-or-description>/);
  for (const reference of ['mobile-web.md', 'motion-build.md', 'react-native-motion.md', 'direct-manipulation.md']) {
    assert.match(skill, new RegExp(`references/${reference.replace('.', '\\.')}`));
    assert.equal(existsSync(path.join(root, 'skills/design-with-ai/references', reference)), true, `${reference} must exist`);
  }
  await assertStructurallyValid('design-with-ai');
});

test('DWA owns direction divergence and representative slice tradeoffs after prototype retirement', async () => {
  assert.equal(existsSync(path.join(root, 'skills/prototype/SKILL.md')), false);
  const core = read('skills/design-with-ai/references/core-design-workflow.md');
  const lineage = read('skills/design-with-ai/references/design-decision-lineage.md');
  assert.match(core, /2-3/);
  assert.match(core, /interaction and traversal model/);
  assert.match(lineage, /representativenessRationale/);
  assert.match(lineage, /tradeoffs/);
  assert.match(lineage, /coveredContent/);
  await assertStructurallyValid('design-with-ai');
});
