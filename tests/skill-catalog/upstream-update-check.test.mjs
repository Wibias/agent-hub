import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(path) {
  return readFileSync(resolve(path), 'utf8');
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: resolve('.'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
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
    ['addy', ['addyosmani/agent-skills', '301b02b12bff98e4688e6984af6556802322bbde', 'current']],
    ['emil', ['emilkowalski/skills', 'c8a79627b59d72d764d6ab6f2c87c09a48169833', 'current']],
    ['matt', ['mattpocock/skills', '4ae2317ddb22b046e26455e4f9c9b3aaaf62212d', 'not-applicable']],
    ['pstack', ['cursor/plugins', 'bb68f2365eceafa0cb2d253112f675acf5f144cc', 'current']],
    ['impeccable', ['pbakaus/impeccable', '5af4319c4e7a7ee3e5e2b9fe899bcfb21c6190cb', 'current']],
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
  assert.equal(impeccable.localPin, '5af4319c4e7a7ee3e5e2b9fe899bcfb21c6190cb');

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
  assert.match(result.stdout, /RECORDED addy .*decision=current/);
  assert.match(result.stdout, /RECORDED emil .*decision=current/);
  assert.match(result.stdout, /RECORDED matt .*decision=not-applicable/);
  assert.match(result.stdout, /RECORDED pstack .*decision=current/);
  assert.match(
    result.stdout,
    /RECORDED impeccable 5af4319c4e7a7ee3e5e2b9fe899bcfb21c6190cb decision=current/,
  );
  assert.doesNotMatch(result.stdout, /PENDING impeccable/);
});

test('Impeccable vendor is fully refreshed to 4.8.0 and engine 0.1.18', () => {
  const upstream = read('skills/impeccable/UPSTREAM.md');
  const skill = read('skills/impeccable/SKILL.md');
  const engineVersion = read('skills/impeccable/scripts/VERSION').trim();

  assert.match(upstream, /5af4319c4e7a7ee3e5e2b9fe899bcfb21c6190cb/);
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

test('Impeccable shared vendor bytes match the audited 4.8.0 snapshot', () => {
  assert.equal(
    git('rev-parse', 'HEAD:skills/impeccable/agents'),
    '10097e136ce06d86dbf36f7d5cbb25953f9412e6',
  );
  assert.equal(
    git('rev-parse', 'HEAD:skills/impeccable/reference'),
    'b8d6f1cec9bbe18fdbb01ab995ecbfe949583e18',
  );

  const blobs = new Map([
    ['skills/impeccable/scripts/VERSION', 'f8bc4c6256ab7d4bb54c2ab7af94c4fa5e58ac56'],
    ['skills/impeccable/scripts/command-metadata.json', '4686bb6deea643493198bff1369bc2958b3909a7'],
    ['skills/impeccable/scripts/engine-checksums.txt', '2e948006a8ac3cb811b775f88b131def849f2237'],
    ['skills/impeccable/scripts/impeccable', '0b31c9e1b9921cdb443aa735a06ac2707259e475'],
    ['skills/impeccable/scripts/impeccable.cmd', '6157693b75c837249060089f2240b363d38e8023'],
    ['skills/impeccable/scripts/live-browser-dom.js', 'ef1ca8928111080ddb923da14c7827b7396a9e62'],
    ['skills/impeccable/scripts/live-browser-ignores.js', '1a2912e57a3b2b10a0d961b5dfe568253133fe53'],
    ['skills/impeccable/scripts/live-browser-session.js', '6871770720d3dd7a284c545e20b97b613635f36f'],
    ['skills/impeccable/reference/init.md', '0be86b1c536c32609d5f158c43704bb5d6723c28'],
    ['skills/impeccable/reference/live.md', '6af0ac4d20cf1c799f4b3662cecb0fe88affebff'],
    ['skills/impeccable/scripts/live-browser.js', 'cc049774b8247c478748fc487901fd38ef66514e'],
  ]);

  for (const [path, expected] of blobs) {
    assert.equal(git('hash-object', path), expected, `${path} must match upstream byte-for-byte`);
  }

  assert.match(git('ls-tree', 'HEAD', 'skills/impeccable/scripts/impeccable'), /^100755 blob /);
});
