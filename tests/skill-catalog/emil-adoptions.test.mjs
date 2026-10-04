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

test('prototype UI variants declare a divergence axis and explicit win-cost tradeoffs', async () => {
  const ui = read('skills/prototype/UI.md');
  assert.match(ui, /named divergence axis/i);
  assert.match(ui, /realistic content/i);
  assert.match(ui, /working interactions/i);
  assert.match(ui, /when it wins/i);
  assert.match(ui, /cost|tradeoff/i);
  await assertStructurallyValid('prototype');
});

test('write-swift is a current-aware Swift owner instead of a frozen toolchain snapshot', async () => {
  assert.equal(existsSync(path.join(root, 'skills/write-swift/SKILL.md')), true, 'write-swift skill must exist');
  const skill = read('skills/write-swift/SKILL.md');
  assert.match(skill, /source-driven-development/);
  assert.match(skill, /official Swift/i);
  assert.match(skill, /version-sensitive/i);
  assert.match(skill, /do not .*current.*version|never .*current.*version|not .*timeless/i);
  await assertStructurallyValid('write-swift');
});
