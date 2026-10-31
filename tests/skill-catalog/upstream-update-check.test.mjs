import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(path) {
  return readFileSync(resolve(path), 'utf8');
}

test('upstream update check tracks the five canonical sources and decisions', () => {
  assert.equal(existsSync(resolve('upstream-sources.json')), true, 'upstream-sources.json must exist');
  assert.equal(existsSync(resolve('scripts/check-upstream-sources.mjs')), true, 'upstream checker must exist');

  const registry = JSON.parse(read('upstream-sources.json'));
  assert.equal(registry.schemaVersion, 2);
  assert.deepEqual(
    registry.sources.map((source) => source.id),
    ['addy', 'emil', 'matt', 'pstack', 'impeccable'],
  );

  const expected = new Map([
    ['addy', ['addyosmani/agent-skills', 'eb07f19f52c2669f2364897aaa293e2aaddd7b1c', 'not-applicable']],
    ['emil', ['emilkowalski/skills', 'a81dbca07f2217b7103e510c0f13f8d5b017afc9', 'separate-pr']],
    ['matt', ['mattpocock/skills', 'a496f5513d4a4cf889bc48e189e579f4b0bdf6aa', 'not-applicable']],
    ['pstack', ['cursor/plugins', '4dd1d05818d19792e7cd6e818f1667f95f7e1dbe', 'current']],
    ['impeccable', ['pbakaus/impeccable', 'df3a4abe7d0840d5f60324812c432e00b66a4e75', 'current']],
  ]);

  for (const source of registry.sources) {
    const [repository, reviewedCommit, decision] = expected.get(source.id);
    assert.equal(source.repository, repository);
    assert.equal(source.reviewedCommit, reviewedCommit);
    assert.equal(source.decision, decision);
    assert.match(source.reviewedCommit, /^[0-9a-f]{40}$/);
    assert.ok(source.scope.length > 0);
  }

  const pstack = registry.sources.find((source) => source.id === 'pstack');
  assert.equal(pstack.scope, 'pstack/');
  assert.equal(pstack.localPin, 'c742dd61706fbacc1b95f1a20b7b988cf096ce6c');

  const impeccable = registry.sources.find((source) => source.id === 'impeccable');
  assert.equal(impeccable.scope, '.agents/skills/impeccable/');
  assert.equal(impeccable.localPin, 'df3a4abe7d0840d5f60324812c432e00b66a4e75');

  const checker = read('scripts/check-upstream-sources.mjs');
  assert.match(checker, /--offline/);
  assert.match(checker, /git[^\n]*ls-remote|ls-remote/);
  assert.match(checker, /CURRENT/);
  assert.match(checker, /UPDATE/);
  assert.match(checker, /PENDING/);
});

test('offline upstream check records Impeccable as fully adopted', () => {
  const result = spawnSync(process.execPath, ['scripts/check-upstream-sources.mjs', '--offline'], {
    cwd: resolve('.'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 5);
  assert.match(result.stdout, /RECORDED addy .*decision=not-applicable/);
  assert.match(result.stdout, /RECORDED emil .*decision=separate-pr/);
  assert.match(result.stdout, /RECORDED matt .*decision=not-applicable/);
  assert.match(result.stdout, /RECORDED pstack .*decision=current/);
  assert.match(
    result.stdout,
    /RECORDED impeccable df3a4abe7d0840d5f60324812c432e00b66a4e75 decision=current/,
  );
  assert.doesNotMatch(result.stdout, /PENDING impeccable/);
});

test('Impeccable vendor is fully refreshed to 4.8.0 and engine 0.1.18', () => {
  const upstream = read('skills/impeccable/UPSTREAM.md');
  const skill = read('skills/impeccable/SKILL.md');
  const engineVersion = read('skills/impeccable/scripts/VERSION').trim();

  assert.match(upstream, /df3a4abe7d0840d5f60324812c432e00b66a4e75/);
  assert.match(upstream, /Skill version: `4\.8\.0`/);
  assert.match(upstream, /Engine version: `0\.1\.18`/);
  assert.match(skill, /version: 4\.8\.0/);
  assert.equal(engineVersion, '0.1.18');
  assert.equal(existsSync(resolve('skills/impeccable/scripts/engine-checksums.txt')), true);
  assert.match(
    read('skills/impeccable/scripts/engine-checksums.txt'),
    /0\.1\.18 impeccable-windows-x64\.exe [0-9a-f]{64}/,
  );

  assert.match(skill, /Explicit-only Impeccable frontend design specialist/i);
  assert.match(skill, /repository instruction injection/i);
  assert.match(skill, /craft-floor\.md[\s\S]{0,400}UI edit/i);
});
