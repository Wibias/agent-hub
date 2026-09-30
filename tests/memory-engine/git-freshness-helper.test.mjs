import test from 'node:test';
import assert from 'node:assert/strict';

import {
  gitBlobOid,
  refreshRepositoryFreshness,
  resolveGitContext,
} from '../../memory-engine/git-freshness.mjs';

test('resolveGitContext derives repository root, current branch, and immutable HEAD from cwd', () => {
  const calls = [];
  const revision = 'a'.repeat(40);
  const execFile = (command, args) => {
    calls.push([command, args]);
    assert.equal(command, 'git');
    if (args.at(-1) === '--show-toplevel') return '/repo/root\n';
    if (args.at(-1) === 'HEAD') return `${revision}\n`;
    if (args.at(-1) === '--show-current') return 'main\n';
    throw new Error(`unexpected git args: ${args.join(' ')}`);
  };

  assert.deepEqual(resolveGitContext({
    cwd: '/repo/root/packages/app',
    execFile,
  }), {
    repoPath: '/repo/root',
    branch: 'main',
    revisionSha: revision,
  });

  assert.deepEqual(calls, [
    ['git', ['-C', '/repo/root/packages/app', 'rev-parse', '--show-toplevel']],
    ['git', ['-C', '/repo/root', 'branch', '--show-current']],
    ['git', ['-C', '/repo/root', 'rev-parse', 'HEAD']],
  ]);
});

test('resolveGitContext fails closed for detached HEAD without a branch', () => {
  const execFile = (_command, args) => {
    if (args.at(-1) === '--show-toplevel') return '/repo/root\n';
    if (args.at(-1) === '--show-current') return '\n';
    throw new Error('HEAD should not be read after missing branch');
  };

  assert.throws(
    () => resolveGitContext({ cwd: '/repo/root', execFile }),
    /branch|detached/i,
  );
});

test('gitBlobOid returns exact blob identity and null for a deleted path', () => {
  const revision = 'b'.repeat(40);
  const oid = 'c'.repeat(40);
  const execFile = (_command, args) => {
    const path = args.at(-1);
    if (path === 'docs/runtime.md') {
      return `100644 blob ${oid}\tdocs/runtime.md\0`;
    }
    if (path === 'docs/deleted.md') return '';
    throw new Error('unexpected path');
  };

  assert.equal(gitBlobOid({
    repoPath: '/repo/root',
    revisionSha: revision,
    path: 'docs/runtime.md',
    execFile,
  }), oid);
  assert.equal(gitBlobOid({
    repoPath: '/repo/root',
    revisionSha: revision,
    path: 'docs/deleted.md',
    execFile,
  }), null);
});

test('refreshRepositoryFreshness records current blob state for every claimed repository path', () => {
  const revision = 'd'.repeat(40);
  const oid = 'e'.repeat(40);
  const recorded = [];
  const memory = {
    repositoryPaths({ projectId, branch }) {
      assert.equal(projectId, 'project-a');
      assert.equal(branch, 'main');
      return ['docs/deleted.md', 'docs/runtime.md'];
    },
    recordRepositoryPathState(value) {
      recorded.push(value);
    },
  };
  const execFile = (_command, args) => {
    const path = args.at(-1);
    return path === 'docs/runtime.md'
      ? `100644 blob ${oid}\tdocs/runtime.md\0`
      : '';
  };

  const count = refreshRepositoryFreshness({
    memory,
    projectId: 'project-a',
    branch: 'main',
    revisionSha: revision,
    repoPath: '/repo/root',
    execFile,
  });

  assert.equal(count, 2);
  assert.deepEqual(recorded, [
    {
      projectId: 'project-a',
      branch: 'main',
      path: 'docs/deleted.md',
      commitSha: revision,
      blobOid: null,
    },
    {
      projectId: 'project-a',
      branch: 'main',
      path: 'docs/runtime.md',
      commitSha: revision,
      blobOid: oid,
    },
  ]);
});
