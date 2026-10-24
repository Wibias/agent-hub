import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

const DECOMMISSIONED_SKILLS = Object.freeze(['pnpm', 'write-swift']);

test('decommissioned skills stay absent from active catalog surfaces', () => {
  const readme = read('README.md');
  const indexMd = read('knowledge/INDEX.md');
  const indexJson = JSON.parse(read('knowledge/index.json'));
  const indexedIds = new Set(indexJson.entries.map((entry) => entry.id));

  for (const skill of DECOMMISSIONED_SKILLS) {
    assert.equal(existsSync(path.join(root, 'skills', skill, 'SKILL.md')), false, `${skill} must remain decommissioned`);
    assert.equal(readme.includes(`skill-doc:${skill}`), false, `${skill} must not remain in the active README skill map`);
    assert.equal(readme.includes(`route-doc:${skill}:`), false, `${skill} must not retain active README routes`);
    assert.equal(indexMd.includes(`**${skill}**`), false, `${skill} must not remain in the generated Markdown index`);
    assert.equal(indexedIds.has(`agents/${skill}`), false, `${skill} must not remain in the generated JSON index`);
  }
});
