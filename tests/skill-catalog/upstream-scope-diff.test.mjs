import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directoryScopeFor, hasScopedChanges } from '../../scripts/lib/upstream-scope-diff.mjs';

const git = (dir, ...args) => execFileSync('git', args, {
  cwd: dir, encoding: 'utf8', windowsHide: true,
}).trim();

test('directory scope classification is explicit and rejects prose scopes', () => {
  assert.equal(directoryScopeFor({ scope: 'pstack/' }), 'pstack/');
  assert.equal(directoryScopeFor({ scope: '.agents/skills/impeccable/' }),
    '.agents/skills/impeccable/');
  assert.equal(directoryScopeFor({ scope: 'adapted skills' }), null);
  assert.equal(directoryScopeFor({ scope: '../escape/' }), null);
});

test('unrelated parent repository commits do not imply a scoped update', () => {
  const root = mkdtempSync(join(tmpdir(), 'upstream-scope-fixture-'));
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'scope-test@example.invalid');
    git(root, 'config', 'user.name', 'Scope Test');
    mkdirSync(join(root, 'pstack'));
    writeFileSync(join(root, 'pstack', 'skill.md'), 'original\n');
    writeFileSync(join(root, 'README.md'), 'old\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'baseline');
    const base = git(root, 'rev-parse', 'HEAD');
    writeFileSync(join(root, 'README.md'), 'unrelated update\n');
    git(root, 'commit', '-qam', 'outside scope');
    const unrelated = git(root, 'rev-parse', 'HEAD');
    assert.equal(hasScopedChanges({
      remote: root, reviewedCommit: base, head: unrelated, scope: 'pstack/',
    }), false);
    writeFileSync(join(root, 'pstack', 'skill.md'), 'relevant update\n');
    git(root, 'commit', '-qam', 'inside scope');
    const relevant = git(root, 'rev-parse', 'HEAD');
    assert.equal(hasScopedChanges({
      remote: root, reviewedCommit: base, head: relevant, scope: 'pstack/',
    }), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gesture upgrade remains within the existing direct-manipulation owner', async () => {
  const { readFileSync } = await import('node:fs');
  const guide = readFileSync(new URL('../../skills/design-with-ai/references/direct-manipulation.md', import.meta.url), 'utf8');
  assert.match(guide, /React state update on each move/);
  assert.match(guide, /same drag progress value/);
  assert.match(guide, /linear progress/);
  assert.match(guide, /velocity/);
});
