import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalizeGitRemote,
  canonicalizeLocalGitProjectId,
  resolveGitRepositoryIdentity,
} from '../../memory-engine/repository-identity.mjs';

function fakeExec({
  remote = null,
  localProjectId = null,
  roots = ['a'.repeat(40)],
} = {}) {
  return (command, args) => {
    assert.equal(command, 'git');
    const tail = args.slice(2).join(' ');

    if (tail === 'config --local --get agent-hub.project-id') {
      if (localProjectId === null) throw new Error('unset');
      return localProjectId + '\n';
    }
    if (tail === 'remote get-url origin') {
      if (remote === null) throw new Error('missing origin');
      return remote + '\n';
    }
    if (tail === 'rev-list --max-parents=0 HEAD') {
      return roots.join('\n') + '\n';
    }
    throw new Error('unexpected git call: ' + args.join(' '));
  };
}

test('remote repository identity remains canonical and preferred', () => {
  const result = resolveGitRepositoryIdentity({
    repoPath: '/work/project',
    execFile: fakeExec({
      remote: 'git@github.com:Wibias/project.git',
    }),
  });

  assert.deepEqual(result, {
    projectId: 'github.com/Wibias/project',
    repoIdentity: 'github.com/Wibias/project',
    canonicalRemote: 'github.com/Wibias/project',
    identitySource: 'origin',
  });
  assert.equal(
    canonicalizeGitRemote('https://github.com/Wibias/project.git'),
    'github.com/Wibias/project',
  );
});

test('local Git repository without origin gets stable root-commit identity', () => {
  const root = '1'.repeat(40);
  const first = resolveGitRepositoryIdentity({
    repoPath: '/old/location/taste-compiler',
    execFile: fakeExec({ roots: [root] }),
  });
  const moved = resolveGitRepositoryIdentity({
    repoPath: '/new/location/taste-compiler',
    execFile: fakeExec({ roots: [root] }),
  });

  assert.deepEqual(first, moved);
  assert.match(
    first.projectId,
    /^local\.git\/taste-compiler@[0-9a-f]{12}$/,
  );
  assert.equal(first.canonicalRemote, null);
  assert.equal(first.identitySource, 'root_commit');
});

test('local Git repository identity changes for different repository history', () => {
  const first = resolveGitRepositoryIdentity({
    repoPath: '/work/taste-compiler',
    execFile: fakeExec({ roots: ['1'.repeat(40)] }),
  });
  const other = resolveGitRepositoryIdentity({
    repoPath: '/work/taste-compiler',
    execFile: fakeExec({ roots: ['2'.repeat(40)] }),
  });

  assert.notEqual(first.projectId, other.projectId);
});

test('explicit local Git project id is stable and takes precedence over a later remote', () => {
  const result = resolveGitRepositoryIdentity({
    repoPath: '/work/taste-compiler',
    execFile: fakeExec({
      localProjectId: 'taste-compiler',
      remote: 'https://github.com/example/taste-compiler.git',
    }),
  });

  assert.deepEqual(result, {
    projectId: 'local.git/taste-compiler',
    repoIdentity: 'local.git/taste-compiler',
    canonicalRemote: null,
    identitySource: 'local_config',
  });
  assert.equal(
    canonicalizeLocalGitProjectId('taste-compiler'),
    'local.git/taste-compiler',
  );
});

test('empty local repository fails with an actionable identity override', () => {
  assert.throws(
    () => resolveGitRepositoryIdentity({
      repoPath: '/work/empty',
      execFile: fakeExec({ roots: [] }),
    }),
    /at least one commit|agent-hub\.project-id/i,
  );
});

test('unsafe explicit local project ids are rejected', () => {
  assert.equal(canonicalizeLocalGitProjectId('../other'), null);
  assert.equal(canonicalizeLocalGitProjectId('bad value'), null);
});
