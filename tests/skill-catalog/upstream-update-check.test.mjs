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
    ['emil', ['emilkowalski/skills', '4061b67b8d976a186aca118594f54b638c5f718a', 'current']],
    ['matt', ['mattpocock/skills', '4ae2317ddb22b046e26455e4f9c9b3aaaf62212d', 'not-applicable']],
    ['pstack', ['cursor/plugins', 'bb68f2365eceafa0cb2d253112f675acf5f144cc', 'current']],
    ['impeccable', ['pbakaus/impeccable', 'acb4cfe14470b1fdf51e855431af618d936b7db8', 'update-pending']],
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
  assert.equal(impeccable.localPin, 'acb4cfe14470b1fdf51e855431af618d936b7db8');

  const checker = read('scripts/check-upstream-sources.mjs');
  assert.match(checker, /--offline/);
  assert.match(checker, /git[^\n]*ls-remote|ls-remote/);
  assert.match(checker, /CURRENT/);
  assert.match(checker, /UPDATE/);
  assert.match(checker, /PENDING/);
  assert.match(checker, /hasScopedChanges/);
});

test('offline upstream check flags Impeccable reference and engine adoption as pending', () => {
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
    /PENDING impeccable reviewed=acb4cfe14470b1fdf51e855431af618d936b7db8 local=acb4cfe14470b1fdf51e855431af618d936b7db8/,
  );
  assert.doesNotMatch(result.stdout, /RECORDED impeccable/);
});

test('Impeccable released engine 0.1.24 remains subject to runtime verification', () => {
  const upstream = read('skills/impeccable/UPSTREAM.md');
  const skill = read('skills/impeccable/SKILL.md');
  const engineVersion = read('skills/impeccable/scripts/VERSION').trim();

  assert.match(upstream, /acb4cfe14470b1fdf51e855431af618d936b7db8/);
  assert.match(upstream, /acb4cfe14470b1fdf51e855431af618d936b7db8/);
  assert.match(upstream, /cssAuthoring\.styleClose/);
  assert.match(upstream, /update.pending/i);
  assert.match(upstream, /Skill version: `4\.8\.2`/);
  assert.match(upstream, /Engine version: `0\.1\.22`/);
  assert.match(skill, /version: 4\.8\.2/);
  assert.equal(engineVersion, '0.1.24');
  assert.equal(existsSync(resolve('skills/impeccable/scripts/engine-checksums.txt')), true);
  assert.match(
    read('skills/impeccable/scripts/engine-checksums.txt'),
    /0\.1\.22 impeccable-windows-x64\.exe [0-9a-f]{64}/,
  );

  assert.match(skill, /Explicit-only Impeccable frontend design specialist/i);
  assert.match(skill, /repository instruction injection/i);
  assert.match(skill, /craft-floor\.md[\s\S]{0,400}UI edit/i);
});

test('Impeccable pinned shared release files match exact upstream blob SHAs', () => {
  const expected = new Map([
    ['agents/impeccable_finish_reviewer.toml', '40d58d11818cde624baad91316a637e553f09f67'],
    ['reference/adapt.md', 'd2e5415b70357902a19e5e8f2696970fc067a580'],
    ['reference/audit.md', '6df698d674d5652c60d9b0885b22e0b40637addc'],
    ['reference/degraded/finish-reviewer.md', 'b2cc1cceaa3f0692541ea2ac51d4d8a0107a8fac'],
    ['reference/distill.md', 'c667ade7a9b1abc7418d4ee983757a61d5d9317d'],
    ['reference/foundations.md', 'ce0d376256e20827a697e26932f79294f5d7053a'],
    ['reference/hooks.md', '3d407938c965f0e228db99a0e422ace2b4e2f737'],
    ['reference/init.md', '0be86b1c536c32609d5f158c43704bb5d6723c28'],
    ['reference/live.md', 'a7d75515a20d10aeadff0a5e7b6e2a9442d3abdf'],
    ['reference/new-work.md', 'a4737d17c99105b607b9b976ee377f8a8c463e6a'],
    ['reference/onboard.md', 'f53ed67d710adf3e8a29f7ac2bb55ede6abe2d45'],
    ['reference/overdrive.md', '4ac7f17fc7d3a96a08e12d6e915e2108b8fedda5'],
    ['reference/quieter.md', '2c22e505657e0d2674e1334a09008d9a106202ac'],
    ['scripts/VERSION', '5a48b6be2afb3d5511388c8f0da2eb4f0479f21c'],
    ['scripts/engine-checksums.txt', '5a8d94b95d095e5ec003c983b63a255c37e7b62c'],
    ['scripts/impeccable', '502652747b67ba10ad79d347553cc64a458b7408'],
    ['scripts/impeccable.cmd', 'ab90ace70ee4cb60671a3afdb6b9f022cab82da0'],
    ['scripts/live-browser.js', '4ab37e343e4f330106f101a2143f4f8d219110e1'],
  ]);
  for (const [relative, sha] of expected) {
    const path = 'skills/impeccable/' + relative;
    assert.equal(git('hash-object', path), sha, path + ' must match release provenance');
  }
  assert.equal(git('hash-object', 'skills/impeccable/scripts/command-metadata.json'),
    '4686bb6deea643493198bff1369bc2958b3909a7');
  assert.match(git('ls-tree', 'HEAD', 'skills/impeccable/scripts/impeccable'), /^100755 blob /);
});
