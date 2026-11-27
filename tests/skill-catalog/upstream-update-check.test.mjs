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
  assert.equal(registry.reviewedAt, '2026-11-27');
  assert.deepEqual(
    registry.sources.map((source) => source.id),
    ['addy', 'emil', 'matt', 'pstack', 'impeccable'],
  );

  const expected = new Map([
    ['addy', ['addyosmani/agent-skills', 'e997ac5b9a74eab332d5e9793bb38a38c8cfdd74', 'current']],
    ['emil', ['emilkowalski/skills', '64eb3deb9a5fbfa041faf783e0bc3fd635872e9c', 'current']],
    ['matt', ['mattpocock/skills', '6f7f7831a625f040a8e06a0e7954826b87ce775a', 'not-applicable']],
    ['pstack', ['cursor/plugins', 'b7b93c36be9bcc36a74db438e0fd385d660bc559', 'current']],
    ['impeccable', ['pbakaus/impeccable', '2fc5e1459efbbf06d92c7306517c286bf12490cf', 'update-pending']],
  ]);

  for (const source of registry.sources) {
    const [repository, reviewedCommit, decision] = expected.get(source.id);
    assert.equal(source.repository, repository);
    assert.equal(source.reviewedCommit, reviewedCommit);
    assert.equal(source.decision, decision);
    assert.match(source.reviewedCommit, /^[0-9a-f]{40}$/);
    assert.ok(source.scope.length > 0);
  }

  assert.equal(registry.sources.find((source) => source.id === 'emil').reviewedAt, '2026-11-20');
  assert.equal(registry.sources.find((source) => source.id === 'matt').reviewedAt, '2026-11-27');
  for (const id of ['addy', 'pstack', 'impeccable']) {
    const source = registry.sources.find((entry) => entry.id === id);
    assert.equal(source.reviewedAt, '2026-11-27');
    assert.equal(source.reviewEvidence, 'docs/upstream-reviews/2026-11-27-all-sources.md');
  }

  const pstack = registry.sources.find((source) => source.id === 'pstack');
  assert.equal(pstack.scope, 'pstack/');
  assert.equal(pstack.localPin, 'aaeb0ea3a0584995aa8f55ce44c6c5259414b896');

  const impeccable = registry.sources.find((source) => source.id === 'impeccable');
  assert.equal(impeccable.scope, '.agents/skills/impeccable/');
  assert.equal(impeccable.localPin, 'acb4cfe14470b1fdf51e855431af618d936b7db8');
  assert.equal(impeccable.integrationOwner, 'design-with-ai');
  assert.equal(impeccable.activeEngineVersion, '0.1.31');
  assert.equal(impeccable.pendingIssue, 450);
  assert.notEqual(impeccable.decision, 'not-applicable');
  const policy = read('skills/design-with-ai/UPSTREAM.md');
  assert.match(policy, /## Impeccable upstream integration policy/);
  for (const decision of ['INTEGRATE', 'ALREADY_COVERED', 'NOT_RELEVANT', 'BLOCKED_PENDING']) {
    assert.ok(policy.includes(decision), decision);
  }
  assert.match(policy, /single owner/);
  assert.equal(existsSync(resolve('skills/impeccable/SKILL.md')), false);
  assert.equal(existsSync(resolve('skills/design-with-ai/internal/impeccable/SKILL.md')), false);

  const checker = read('scripts/check-upstream-sources.mjs');
  assert.match(checker, /--offline/);
  assert.match(checker, /git[^\n]*ls-remote|ls-remote/);
  assert.match(checker, /classifyUpstreamStatus/);
  assert.match(checker, /needsUpstreamAction/);
  assert.match(read('scripts/lib/upstream-status.mjs'), /CURRENT/);
  assert.match(checker, /PENDING/);
  assert.match(checker, /hasScopedChanges/);
  assert.match(checker, /validateUpstreamIntegration/);
});

test('offline upstream check keeps native Rust Live pending after engine 0.1.31 merge', () => {
  const result = spawnSync(process.execPath, ['scripts/check-upstream-sources.mjs', '--offline'], {
    cwd: resolve('.'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 14, 'five canonical sources plus nine reference-only GitHub sources');
  assert.equal(lines.filter(line => line.startsWith('REFERENCE_RECORDED ')).length, 9);
  assert.match(result.stdout, /RECORDED addy .*decision=current/);
  assert.match(result.stdout, /RECORDED emil .*decision=current/);
  assert.match(result.stdout, /RECORDED matt .*decision=not-applicable/);
  assert.match(result.stdout, /RECORDED pstack .*decision=current/);
  assert.match(
    result.stdout,
    /PENDING impeccable reviewed=2fc5e1459efbbf06d92c7306517c286bf12490cf local=acb4cfe14470b1fdf51e855431af618d936b7db8/,
  );
  assert.doesNotMatch(result.stdout, /RECORDED impeccable/);
  assert.match(result.stdout, /REFERENCE_RECORDED penpot-mcp 28f63af16e14ae26c51c2e18225180de432af1fb decision=current scope=mcp\/packages\//);
  assert.match(result.stdout, /REFERENCE_RECORDED ui-ux-pro-max 72e5fc76a4f3eb37747dc472cb3091bd46e7752a decision=current/);

});

test('integrated Impeccable engine pin remains unqualified until executable verification', () => {
  const upstream = read('skills/design-with-ai/internal/impeccable/UPSTREAM.md');
  const routes = read('skills/design-with-ai/references/impeccable-routes.md');
  const skill = read('skills/design-with-ai/SKILL.md');
  const scripts = 'skills/design-with-ai/internal/impeccable/scripts/';
  assert.match(upstream, /2fc5e1459efbbf06d92c7306517c286bf12490cf/);
  assert.match(upstream, /Skill version: `4[.]9[.]1`/);
  assert.match(upstream, /Engine version: `0[.]1[.]24`/);
  assert.equal(read(scripts + 'VERSION').trim(), '0.1.31');
  assert.match(upstream, /Active engine version: `0[.]1[.]31`/);
  assert.match(read(scripts + 'engine-checksums.txt'),
    /0[.]1[.]31 impeccable-windows-x64[.]exe [0-9a-f]{64}/);
  assert.match(routes, /DWA/);
  assert.match(skill, /^name: design-with-ai$/m);
  assert.match(skill, /impeccable <verb>/);
  assert.equal(existsSync(resolve('skills/impeccable/SKILL.md')), false);
});

test('reviewed engine 0.1.31 manifest and launcher files retain tagged Git blob provenance', () => {
  const expected = new Map([
    ['agents/impeccable_finish_reviewer.toml', '40d58d11818cde624baad91316a637e553f09f67'],
    ['reference/degraded/finish-reviewer.md', 'b2cc1cceaa3f0692541ea2ac51d4d8a0107a8fac'],
    ['reference/overdrive.md', '4ac7f17fc7d3a96a08e12d6e915e2108b8fedda5'],
    ['scripts/VERSION', 'db7a480479e8c5b6b8dfd95a485a19a005a5cb67'],
    ['scripts/engine-checksums.txt', '7502a231eb37ef27444f75d962014d7bcdf1322f'],
    ['scripts/impeccable', '16086b9047568fba26d45f02c123494b4c9a845e'],
    ['scripts/impeccable.cmd', '622a52217e32f42d5ac79fb39ee15d054b1a357a'],
    ['scripts/live-browser.js', '4ab37e343e4f330106f101a2143f4f8d219110e1'],
    ['scripts/command-metadata.json', '4686bb6deea643493198bff1369bc2958b3909a7'],
  ]);
  for (const [relative, sha] of expected) {
    const path = 'skills/design-with-ai/internal/impeccable/' + relative;
    assert.equal(git('hash-object', path), sha, path + ' must match pinned-release provenance');
  }
  assert.match(git('ls-tree', 'HEAD', 'skills/design-with-ai/internal/impeccable/scripts/impeccable'), /^100755 blob /);
});


test('secondary DWA source monitor records nine exact GitHub snapshots without owner authority', () => {
  const registry = JSON.parse(read('upstream-sources.json'));
  const refs = registry.referenceSources;
  assert.ok(Array.isArray(refs));
  assert.equal(registry.sources.length, 5, 'canonical five-source registry remains unchanged');
  assert.equal(refs.length, 9);
  const expected = new Map([
    ['anthropic-design-handoff', ['anthropics/knowledge-work-plugins', '5e504ae11498f2b8daa30d86b7dab97b2ecd8092']],
    ['mengto-design', ['MengTo/skills', '3a8517e09e9a258a8b8a1dfdb71579abe75f1c22']],
    ['ui-ux-pro-max', ['nextlevelbuilder/ui-ux-pro-max-skill', '72e5fc76a4f3eb37747dc472cb3091bd46e7752a']],
    ['penpot-mcp', ['penpot/penpot', '28f63af16e14ae26c51c2e18225180de432af1fb']],
    ['ibelick-ui-skills', ['ibelick/ui-skills', '1a2f2bf91b18365abc102b67400f48ab1046b449']],
    ['make-interfaces-feel-better', ['jakubkrehel/make-interfaces-feel-better', '6d9f2f1df10e8ce2ae1708598a73b0506fb98794']],
    ['vibecoded-design-tells', ['JCarterJohnson/vibecoded-design-tells', 'f7c4aefc2c797a66e55b49354a93917ab60d33ac']],
    ['signs-of-ai-design', ['febbhav/signs-of-ai-design', '854b46f18dee5cc174d45cec8cd4f3142fe46984']],
    ['no-slop-ui', ['LeoStehlik/no-slop-ui', 'c5f80190f0a6cbd906b81d54e79e2756931077fb']],
  ]);
  const allIds = new Set(registry.sources.map(source => source.id));
  for (const ref of refs) {
    assert.deepEqual([ref.repository, ref.reviewedCommit], expected.get(ref.id), ref.id);
    assert.equal(ref.decision, 'current');
    assert.equal(ref.reviewedAt, '2026-11-27');
    assert.match(ref.reviewedCommit, /^[0-9a-f]{40}$/);
    assert.ok(ref.scope.length > 0);
    assert.equal(Object.hasOwn(ref, 'localPin'), false, ref.id + ' must not claim an implementation pin');
    assert.equal(Object.hasOwn(ref, 'integrationOwner'), false, ref.id + ' must not claim skill ownership');
    assert.equal(allIds.has(ref.id), false, 'reference source ID collision');
    allIds.add(ref.id);
  }
  const monitor = read('scripts/check-upstream-sources.mjs');
  assert.match(monitor, /referenceSources/);
  assert.match(monitor, /REFERENCE_RECORDED/);
  assert.match(monitor, /REFERENCE_\$\{status\}/);
  assert.match(monitor, /needsUpstreamAction\(status\)/);
});
