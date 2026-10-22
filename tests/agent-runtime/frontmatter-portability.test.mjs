import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePortableFrontmatterSyntax } from '../../scripts/verify-portable-skills.mjs';

test('portable frontmatter accepts quoted scalars and block descriptions', () => {
  const errors = validatePortableFrontmatterSyntax(`---\nname: demo\ndescription: >-\n  Use when this skill applies.\nmetadata:\n  source: x\nlicense: "MIT: compatible"\n---\n# Demo\n`);
  assert.deepEqual(errors, []);
});

test('portable frontmatter rejects YAML shapes known to break strict hosts', () => {
  const cases = [
    [`---\nname: demo\ndescription: Use this: when needed\n---\n`, /unquoted ': '/],
    [`---\nname: demo\ndescription: \`other-skill\` does work\n---\n`, /reserved '`'/],
    [`---\nname: demo\ndescription: "unterminated\n---\n`, /never closes/],
    [`---\nname: demo\n\tdescription: bad indent\n---\n`, /tab for indentation/],
  ];

  for (const [source, expected] of cases) {
    const errors = validatePortableFrontmatterSyntax(source);
    assert.ok(errors.some((line) => expected.test(line)), `${source}\n${errors.join('\n')}`);
  }
});
