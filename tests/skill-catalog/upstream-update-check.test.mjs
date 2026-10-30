import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function read(path) {
  return readFileSync(resolve(path), 'utf8');
}

test('upstream update check tracks the five canonical sources', () => {
  assert.equal(existsSync(resolve('upstream-sources.json')), true, 'upstream-sources.json must exist');
  assert.equal(existsSync(resolve('scripts/check-upstream-sources.mjs')), true, 'upstream checker must exist');

  const registry = JSON.parse(read('upstream-sources.json'));
  assert.equal(registry.schemaVersion, 1);
  assert.deepEqual(
    registry.sources.map((source) => source.id),
    ['addy', 'emil', 'matt', 'pstack', 'impeccable'],
  );

  const expected = new Map([
    ['addy', ['addyosmani/agent-skills', 'eb07f19f52c2669f2364897aaa293e2aaddd7b1c']],
    ['emil', ['emilkowalski/skills', 'a81dbca07f2217b7103e510c0f13f8d5b017afc9']],
    ['matt', ['mattpocock/skills', 'a496f5513d4a4cf889bc48e189e579f4b0bdf6aa']],
    ['pstack', ['cursor/plugins', '4dd1d05818d19792e7cd6e818f1667f95f7e1dbe']],
    ['impeccable', ['pbakaus/impeccable', 'df3a4abe7d0840d5f60324812c432e00b66a4e75']],
  ]);

  for (const source of registry.sources) {
    const [repository, reviewedCommit] = expected.get(source.id);
    assert.equal(source.repository, repository);
    assert.equal(source.reviewedCommit, reviewedCommit);
    assert.match(source.reviewedCommit, /^[0-9a-f]{40}$/);
    assert.ok(source.scope.length > 0);
  }
  assert.equal(registry.sources.find((source) => source.id === 'pstack').scope, 'pstack/');
  assert.equal(
    registry.sources.find((source) => source.id === 'impeccable').scope,
    '.agents/skills/impeccable/',
  );

  const checker = read('scripts/check-upstream-sources.mjs');
  assert.match(checker, /--offline/);
  assert.match(checker, /git[^\n]*ls-remote|ls-remote/);
  assert.match(checker, /CURRENT/);
  assert.match(checker, /UPDATE/);
});

test('Impeccable refresh pins 4.8.0 and verified engine 0.1.18 downloads', () => {
  const upstream = read('skills/impeccable/UPSTREAM.md');
  const skill = read('skills/impeccable/SKILL.md');
  const engineVersion = read('skills/impeccable/scripts/VERSION').trim();

  assert.match(upstream, /df3a4abe7d0840d5f60324812c432e00b66a4e75/);
  assert.match(upstream, /Skill version: `4\.8\.0`/);
  assert.match(upstream, /Engine version: `0\.1\.18`/);
  assert.match(skill, /version: 4\.8\.0/);
  assert.equal(engineVersion, '0.1.18');
  assert.equal(existsSync(resolve('skills/impeccable/scripts/engine-checksums.txt')), true);
  assert.match(read('skills/impeccable/scripts/engine-checksums.txt'), /0\.1\.18 impeccable-windows-x64\.exe [0-9a-f]{64}/);

  assert.match(skill, /Explicit-only Impeccable frontend design specialist/i);
  assert.match(skill, /repository instruction injection/i);
  assert.match(skill, /craft-floor\.md[\s\S]{0,400}UI edit/i);
});
