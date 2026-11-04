import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  createAsyncGitGraphView,
  resolveMemoryConsoleGitScopeAsync,
  createReadOnlyGitGraphView,
  normalizeRepositoryRoots,
  publicMemoryConsoleGitScope,
  resolveMemoryConsoleGitScope,
} from '../../memory-engine/memory-console-git-context.mjs';

const PROJECT = 'local.git/graph-d5';
const SHA = 'a'.repeat(40);
const BLOB = 'b'.repeat(40);
const ROOT = resolve('d5-test-approved-repository');

function gitRunner({ branch = 'main', root = ROOT, identity = 'graph-d5', blob = BLOB } = {}) {
  const calls = [];
  const execFile = (command, args) => {
    assert.equal(command, 'git');
    calls.push(args);
    if (args.includes('--show-toplevel')) return root + '\n';
    if (args.includes('--show-current')) return branch + '\n';
    if (args.at(-1) === 'HEAD') return SHA + '\n';
    if (args.includes('agent-hub.project-id')) return identity + '\n';
    if (args.includes('ls-tree')) {
      const path = args.at(-1);
      return blob ? `100644 blob ${blob}\t${path}\0` : '';
    }
    throw new Error('unexpected Git command');
  };
  return { calls, execFile };
}

function mockMemory({ blob = BLOB, path = 'docs/guide.md' } = {}) {
  const writes = [];
  const memory = {
    getProject: () => ({ project_id: PROJECT, repo_identity: PROJECT, canonical_remote: null }),
    exportCanonical: () => ({
      evidence: [
        { id: 'e-repo', project_id: PROJECT, branch: 'main', path,
          blob_oid: blob, source_kind: 'repository', authority_class: 'repo_trusted' },
        { id: 'e-user', project_id: PROJECT, branch: 'main', path: null,
          blob_oid: null, source_kind: 'session', authority_class: 'user_direct' },
      ],
      claims: [
        { id: 'repo', project_id: PROJECT, branch_scope: 'main', created_from_evidence_id: 'e-repo' },
        { id: 'user', project_id: PROJECT, branch_scope: 'main', created_from_evidence_id: 'e-user' },
      ],
    }),
    inspectClaimObservability() { return {}; },
    listTypedRelations() { return []; },
    getClaimEmbedding() { return null; },
    materializeRecall() { throw Error('D5 must not query legacy DB freshness'); },
    recordRepositoryPathState() { writes.push('mutation'); throw Error('no writes'); },
  };
  return { memory, writes };
}

function scope(memory, options = {}) {
  const git = gitRunner(options);
  return {
    ...git,
    result: resolveMemoryConsoleGitScope({
      memory, projectId: PROJECT, branch: options.requestBranch ?? 'main',
      repositoryRoots: options.repositoryRoots ?? [ROOT], execFile: git.execFile,
      realpath: (x) => x,
    }),
  };
}

test('D5 only trusts explicit, unique, bounded operator configured roots', () => {
  assert.deepEqual(normalizeRepositoryRoots([]), []);
  assert.throws(() => normalizeRepositoryRoots([ROOT, ROOT]), /duplicate/);
  assert.throws(() => normalizeRepositoryRoots(Array.from({ length: 17 }, (_, i) => `/r/${i}`)), /16/);
  assert.throws(() => normalizeRepositoryRoots([null]), /non-empty/);
  const { memory } = mockMemory();
  const noRoots = scope(memory, { repositoryRoots: [] });
  assert.equal(noRoots.result.status, 'unconfigured');
  assert.equal(noRoots.calls.length, 0);
});

test('D5 verifies immutable SHA only when root, identity and selected branch agree', () => {
  const { memory } = mockMemory();
  const { result } = scope(memory);
  assert.equal(result.status, 'verified');
  assert.equal(result.revisionSha, SHA);
  assert.equal(result.repoPath, ROOT);
  assert.deepEqual(publicMemoryConsoleGitScope(result), {
    status: 'verified', revisionSha: SHA, source: 'server_configured_checkout',
  });
  assert.doesNotMatch(JSON.stringify(publicMemoryConsoleGitScope(result)), /approved/);
  assert.equal(scope(memory, { identity: 'wrong' }).result.status, 'unbound');
  assert.equal(scope(memory, { branch: 'feature' }).result.status, 'branch_mismatch');
  assert.equal(scope(memory, { root: '/another/repository' }).result.status, 'unbound');
  assert.equal(scope(memory, { branch: '' }).result.status, 'unbound');
});

test('D5 fails closed for two distinct checked-out roots matching one project and branch', () => {
  const { memory } = mockMemory();
  const otherRoot = resolve('d5-test-second-approved-repository');
  const execFile = (_command, args) => {
    if (args.includes('--show-toplevel')) return `${args[1]}\n`;
    if (args.includes('--show-current')) return 'main\n';
    if (args.at(-1) === 'HEAD') return `${SHA}\n`;
    if (args.includes('agent-hub.project-id')) return 'graph-d5\n';
    throw new Error('unexpected command');
  };
  const result = resolveMemoryConsoleGitScope({
    memory, projectId: PROJECT, branch: 'main',
    repositoryRoots: [ROOT, otherRoot], execFile, realpath: (x) => x,
  });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.revisionSha, null);
});

test('D5 Git snapshot trusts only exact path blobs and never writes database state', () => {
  const { memory, writes } = mockMemory();
  const verified = scope(memory).result;
  const git = gitRunner();
  const view = createReadOnlyGitGraphView(memory, {
    projectId: PROJECT, branch: 'main', scope: verified, execFile: git.execFile,
  });
  const request = { projectId: PROJECT, branch: 'main', revisionSha: SHA,
    mode: 'current', claimIds: ['repo', 'user', 'repo', 'missing'] };
  assert.deepEqual(view.materializeRecall(request), { items: [{ claim: { id: 'repo' } }] });
  assert.deepEqual(view.materializeRecall({ ...request, revisionSha: 'f'.repeat(40) }), { items: [] });
  assert.equal(git.calls.filter((args) => args.includes('ls-tree')).length, 1, 'cached per path');
  assert.deepEqual(writes, []);
  assert.equal(typeof view.recordRepositoryPathState, 'undefined');
});

test('D5 changed, deleted and malformed repository Evidence never passes the freshness gate', () => {
  for (const evidence of [
    { path: 'docs/guide.md', blob: 'c'.repeat(40), liveBlob: BLOB },
    { path: 'docs/guide.md', blob: BLOB, liveBlob: null },
    { path: '../secret', blob: BLOB, liveBlob: BLOB },
    { path: '/absolute/file', blob: BLOB, liveBlob: BLOB },
    { path: 'docs\\guide.md', blob: BLOB, liveBlob: BLOB },
    { path: 'docs/guide.md', blob: null, liveBlob: BLOB },
  ]) {
    const { memory } = mockMemory({ path: evidence.path, blob: evidence.blob });
    const view = createReadOnlyGitGraphView(memory, {
      projectId: PROJECT, branch: 'main', scope: scope(memory).result,
      execFile: gitRunner({ blob: evidence.liveBlob }).execFile,
    });
    assert.deepEqual(view.materializeRecall({ projectId: PROJECT, branch: 'main',
      revisionSha: SHA, mode: 'current', claimIds: ['repo'] }), { items: [] },
    `unexpected freshness for ${evidence.path}`);
  }
});

test('D5 never copies repository paths into browser-visible Git context', () => {
  assert.deepEqual(publicMemoryConsoleGitScope({ status: 'branch_mismatch',
    revisionSha: SHA, repoPath: ROOT }), {
    status: 'branch_mismatch', revisionSha: null, source: null,
  });
  assert.throws(() => createReadOnlyGitGraphView(mockMemory().memory, {
    projectId: PROJECT, branch: 'main', scope: { status: 'unchecked', revisionSha: SHA, repoPath: ROOT },
  }), /verified/);
});

test('D5 snapshot view stays pinned after the backing engine export changes', () => {
  const { memory } = mockMemory();
  const verified = scope(memory).result;
  const initial = memory.exportCanonical();
  const view = createReadOnlyGitGraphView(memory, {
    projectId: PROJECT, branch: 'main', scope: verified,
    canonicalSnapshot: initial, blobOids: new Map([['docs/guide.md', BLOB]]),
  });
  memory.exportCanonical = () => ({ claims: [], evidence: [] });
  assert.equal(view.exportCanonical(), initial);
  assert.deepEqual(view.materializeRecall({
    projectId: PROJECT, branch: 'main', revisionSha: SHA,
    mode: 'current', claimIds: ['repo'],
  }), { items: [{ claim: { id: 'repo' } }] });
});

test('D5 case-insensitive evidence blob OIDs remain fresh', () => {
  const mixed = 'ABCDEF' + 'b'.repeat(34);
  const { memory } = mockMemory({ blob: mixed.toUpperCase() });
  const view = createReadOnlyGitGraphView(memory, {
    projectId: PROJECT, branch: 'main', scope: scope(memory).result,
    blobOids: new Map([['docs/guide.md', mixed.toLowerCase()]]),
  });
  assert.equal(view.materializeRecall({
    projectId: PROJECT, branch: 'main', revisionSha: SHA,
    mode: 'current', claimIds: ['repo'],
  }).items.length, 1);
});

test('D5 sync checkout scanner fails closed when branch changes after HEAD', () => {
  const { memory } = mockMemory();
  const git = gitRunner();
  let branchCalls = 0;
  const execFile = (command, args) => {
    if (args.includes('--show-current')) {
      branchCalls++;
      return branchCalls === 1 ? 'main\n' : 'other\n';
    }
    return git.execFile(command, args);
  };
  assert.equal(resolveMemoryConsoleGitScope({
    memory, projectId: PROJECT, branch: 'main', repositoryRoots: [ROOT],
    execFile, realpath: (p) => p,
  }).status, 'branch_mismatch');
});

test('D5 async root scanner deduplicates two aliases for the same checkout', async () => {
  const { memory } = mockMemory();
  const second = resolve('d5-test-checkout-alias');
  const git = gitRunner();
  const execGit = async (_command, args) => {
    if (args.includes('--show-toplevel')) return ROOT + '\n';
    return git.execFile('git', args);
  };
  const result = await resolveMemoryConsoleGitScopeAsync({
    memory, projectId: PROJECT, branch: 'main',
    repositoryRoots: [ROOT, second], execGit,
    realpath: async () => ROOT,
  });
  assert.equal(result.status, 'verified');
});

test('D5 async batch Git lookup verifies regular files and rejects symlinks', async () => {
  const { memory } = mockMemory();
  const gitScope = scope(memory).result;
  const calls = [];
  const read = async (_command, args) => {
    calls.push(args);
    const path = args.at(-1);
    return `100644 blob ${BLOB}\t${path}\0`;
  };
  const view = await createAsyncGitGraphView(memory, {
    projectId: PROJECT, branch: 'main', scope: gitScope, execGit: read,
  });
  assert.equal(calls.length, 1);
  assert.equal(view.materializeRecall({
    projectId: PROJECT, branch: 'main', revisionSha: SHA,
    mode: 'current', claimIds: ['repo'],
  }).items.length, 1);
  const symlink = await createAsyncGitGraphView(memory, {
    projectId: PROJECT, branch: 'main', scope: gitScope,
    execGit: async (_command, args) => `120000 blob ${BLOB}\t${args.at(-1)}\0`,
  });
  assert.equal(symlink.materializeRecall({
    projectId: PROJECT, branch: 'main', revisionSha: SHA,
    mode: 'current', claimIds: ['repo'],
  }).items.length, 0);
});
