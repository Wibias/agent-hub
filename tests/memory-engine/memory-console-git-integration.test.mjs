import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { memoryUiGraph } from '../../memory-engine/memory-ui-model.mjs';
import {
  createReadOnlyGitGraphView,
  resolveMemoryConsoleGitScope,
} from '../../memory-engine/memory-console-git-context.mjs';
import { createMemoryUiServer, parseMemoryUiArgs } from '../../scripts/memory-ui.mjs';

const PROJECT = 'github.com/example/d5-git-context';
const BRANCH = 'main';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000,
  }).trim();
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-d5-'));
  const repoRoot = join(root, 'checkout');
  await mkdir(join(repoRoot, 'docs'), { recursive: true });
  git(repoRoot, 'init', '-b', BRANCH);
  git(repoRoot, 'config', 'user.email', 'd5@example.invalid');
  git(repoRoot, 'config', 'user.name', 'D5 Test');
  git(repoRoot, 'remote', 'add', 'origin', `https://${PROJECT}.git`);
  const path = join(repoRoot, 'docs', 'guide.md');
  await writeFile(path, 'Repository evidence at revision one.\n', 'utf8');
  git(repoRoot, 'add', 'docs/guide.md');
  git(repoRoot, 'commit', '-m', 'initial');
  const revision = git(repoRoot, 'rev-parse', 'HEAD');
  const oid = git(repoRoot, 'rev-parse', `${revision}:docs/guide.md`);

  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  t.after(async () => {
    memory.close();
    await rm(root, { recursive: true, force: true });
  });
  memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
  const now = new Date(Date.now() - 60_000).toISOString();
  const insert = ({ id, sourceKind, authority, path: evidencePath, blobOid }) => {
    memory.ingest({
      evidence: {
        id: `e-${id}`, projectId: PROJECT, harness: 'codex', sessionId: 'd5',
        sourceKind, sourceRef: evidencePath ?? `session:${id}`,
        capturedAt: now, branch: BRANCH, commitSha: evidencePath ? revision : null,
        path: evidencePath, blobOid,
        content: `Evidence for ${id}.`, authorityClass: authority,
        metadata: {},
      },
      claim: { id, kind: 'code_observation', subject: 'd5', predicate: 'documents',
        value: `D5 ${id} claim`, state: 'active', branchScope: BRANCH, createdAt: now },
    });
  };
  insert({ id: 'repo-claim', sourceKind: 'repository', authority: 'repo_trusted',
    path: 'docs/guide.md', blobOid: oid });
  insert({ id: 'session-claim', sourceKind: 'session', authority: 'user_direct',
    path: null, blobOid: null });
  memory.proposeTypedRelation({ projectId: PROJECT, branch: BRANCH,
    sourceClaimId: 'repo-claim', targetClaimId: 'session-claim', relation: 'supports',
    confidence: 'high', reason: 'Relevant scoped evidence supports D5.' },
  { evaluatorId: 'd5-integration', policyVersion: 'semantic-relation-v1', at: now });
  return { root, repoRoot, memory, dbPath, revision, path };
}

test('D5 real Git checkout verifies canonical Evidence blobs and detects changed HEAD without writes', async (t) => {
  const { repoRoot, memory, path, revision } = await fixture(t);
  const canonicalBefore = memory.exportCanonical();
  const resolveScope = () => resolveMemoryConsoleGitScope({
    memory, projectId: PROJECT, branch: BRANCH, repositoryRoots: [repoRoot],
  });
  let scope = resolveScope();
  assert.equal(scope.status, 'verified');
  assert.equal(scope.revisionSha, revision);
  let graph = memoryUiGraph(createReadOnlyGitGraphView(memory, {
    projectId: PROJECT, branch: BRANCH, scope,
  }), { projectId: PROJECT, branch: BRANCH, revisionSha: scope.revisionSha });
  assert.equal(graph.nodes.find((n) => n.id === 'repo-claim').freshness.status, 'fresh');
  assert.equal(graph.edges.filter((e) => e.source === 'typed_relation').length, 1);

  await writeFile(path, 'Changed repository content, second revision.\n', 'utf8');
  git(repoRoot, 'add', 'docs/guide.md');
  git(repoRoot, 'commit', '-m', 'change');
  scope = resolveScope();
  assert.equal(scope.status, 'verified');
  assert.notEqual(scope.revisionSha, revision);
  graph = memoryUiGraph(createReadOnlyGitGraphView(memory, {
    projectId: PROJECT, branch: BRANCH, scope,
  }), { projectId: PROJECT, branch: BRANCH, revisionSha: scope.revisionSha });
  assert.equal(graph.nodes.find((n) => n.id === 'repo-claim').freshness.status, 'stale');
  assert.equal(graph.edges.filter((e) => e.source === 'typed_relation').length, 0);
  assert.deepEqual(memory.exportCanonical(), canonicalBefore);

  git(repoRoot, 'checkout', '-b', 'feature/wrong-branch');
  assert.equal(resolveScope().status, 'branch_mismatch');
});

test('D5 HTTP graph ignores browser-supplied Git revision and does not expose checkout paths', async (t) => {
  const { repoRoot, memory, dbPath, revision } = await fixture(t);
  const runtime = createMemoryUiServer({
    dbPath, memory, includeRuntimeHealth: false, repositoryRoots: [repoRoot],
  });
  t.after(() => new Promise((done) => runtime.server.close(done)));
  await new Promise((done, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(0, runtime.host, done);
  });
  const port = runtime.server.address().port;
  const url = `http://127.0.0.1:${port}/api/graph?projectId=${encodeURIComponent(PROJECT)}&branch=main`;
  const response = await fetch(url + '&revisionSha=' + 'f'.repeat(40) + '&repoRoot=/not/allowed');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.gitContext.status, 'verified');
  assert.equal(data.gitContext.revisionSha, revision);
  assert.equal(data.nodes.find((n) => n.id === 'repo-claim').freshness.status, 'fresh');
  assert.doesNotMatch(JSON.stringify(data), /agent-hub-d5-/);
  assert.equal(data.edges.filter((e) => e.source === 'typed_relation').length, 1);
});

test('D5 explicit CLI roots are opt-in; unexpected options fail closed', () => {
  const options = parseMemoryUiArgs(['--repo-root', '/example/one', '--repo-root', '/example/two']);
  assert.equal(options.repositoryRoots.length, 2);
  assert.throws(() => parseMemoryUiArgs(['--repo-root']), /requires/);
  assert.throws(() => parseMemoryUiArgs(['--revisionSha', 'f'.repeat(40)]), /unknown argument/);
});
