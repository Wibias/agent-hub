import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  prepareApprovedMemoryWrite, commitApprovedMemoryWrite,
} from '../../memory-engine/adapters/codex-approved-memory-write.mjs';
import { createApprovedMemoryWriteDispatcher } from '../../memory-engine/adapters/codex-approved-memory-write-mcp.mjs';
import { readGlobalCodexMemory, describeGlobalMemoryProject, samePath } from '../../memory-engine/adapters/codex-global-memory-scope.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'approved-write-mcp-'));
  const cwd = join(root, 'repo');
  const dbPath = join(root, 'memory.sqlite3');
  const scopeDir = join(root, 'agent-hub');
  const scopePath = join(scopeDir, 'codex-memory-scopes.json');
  mkdirSync(cwd);
  mkdirSync(scopeDir);
  execFileSync('git', ['init', '-b', 'main', cwd], { stdio: 'ignore' });
  execFileSync('git', ['-C', cwd, 'config', 'user.name', 'Memory Test']);
  execFileSync('git', ['-C', cwd, 'config', 'user.email', 'memory@example.test']);
  execFileSync('git', ['-C', cwd, 'remote', 'add', 'origin', 'https://github.com/example/approved.git']);
  writeFileSync(join(cwd, 'README.md'), 'fixture\n');
  execFileSync('git', ['-C', cwd, 'add', 'README.md']);
  execFileSync('git', ['-C', cwd, 'commit', '-m', 'fixture'], { stdio: 'ignore' });
  const projectId = 'github.com/example/approved';
  const engine = new MemoryEngine({ dbPath });
  engine.registerProject({ projectId, repoIdentity: projectId, canonicalRemote: projectId });
  engine.close();
  writeFileSync(scopePath, JSON.stringify({
    schema: 1, memory_db: dbPath,
    projects: [{ root: cwd, project_id: projectId, repo_identity: projectId }],
  }));
  return {
    root, cwd, dbPath, scopePath, projectId,
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}
const call = (id, evidenceId, extra = {}) => ({
  jsonrpc: '2.0', id, method: 'tools/call', params: {
    name: 'memory_commit_approved',
    arguments: { evidence_id: evidenceId, ...extra },
  },
});

test('real stdio MCP commits one approved Claim, denies replay, and normal Recall returns it', (t) => {
  const f = fixture(); t.after(() => f.cleanup());
  if (process.platform === 'win32') {
    const observed = describeGlobalMemoryProject({ cwd: f.cwd });
    console.error('WIN32_SCOPE_DIAGNOSTIC ' + JSON.stringify({ supplied: f.cwd, observed: observed.root, samePath: samePath(f.cwd, observed.root) }));
  }
  const prepared = prepareApprovedMemoryWrite({
    cwd: f.cwd, scopePath: f.scopePath,
    text: 'The approved deployment region is eu-central-1.', confirmed: true,
  });
  const server = fileURLToPath(new URL('../../scripts/run-codex-approved-memory-write-mcp.mjs', import.meta.url));
  const reqs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    call(3, prepared.evidence_id, { db_path: 'spoofed' }),
    call(4, prepared.evidence_id),
    call(5, prepared.evidence_id),
  ];
  const run = spawnSync(process.execPath, [server, '--cwd', f.cwd], {
    input: reqs.map((item) => JSON.stringify(item)).join('\n') + '\n',
    encoding: 'utf8',
    env: { ...process.env, AGENT_HUB_MEMORY_DB: join(f.root, 'spoof.sqlite3'),
      LOCALAPPDATA: f.root, XDG_STATE_HOME: f.root },
  });
  assert.equal(run.status, 0, run.stderr);
  const responses = run.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.deepEqual(responses.map((x) => x.id), [1, 2, 3, 4, 5]);
  assert.equal(responses[1].result.tools[0].name, 'memory_commit_approved');
  assert.equal(JSON.parse(responses[2].result.content[0].text).status, 'forbidden_argument');
  const committed = JSON.parse(responses[3].result.content[0].text);
  assert.equal(committed.status, 'committed');
  assert.equal(committed.project_id, f.projectId);
  assert.equal(JSON.parse(responses[4].result.content[0].text).status, 'approval_denied');
  const memory = new MemoryEngine({ dbPath: f.dbPath });
  try {
    assert.equal(memory.getClaim(committed.claim_id).value, 'The approved deployment region is eu-central-1.');
    assert.equal(memory.getApproval(prepared.approval_id).uses, 1);
  } finally { memory.close(); }
  const recall = readGlobalCodexMemory({
    cwd: f.cwd, query: 'approved deployment region', scopePath: f.scopePath,
  });
  assert.equal(recall.status, 'found');
  assert.ok(recall.items.some((x) => x.claim.id === committed.claim_id));
});

test('branch change denies without consuming approval', async (t) => {
  const f = fixture(); t.after(() => f.cleanup());
  const prepared = prepareApprovedMemoryWrite({
    cwd: f.cwd, scopePath: f.scopePath, text: 'Only on main.', confirmed: true,
  });
  execFileSync('git', ['-C', f.cwd, 'checkout', '-b', 'feature/other'], { stdio: 'ignore' });
  const result = await commitApprovedMemoryWrite({
    cwd: f.cwd, scopePath: f.scopePath, evidenceId: prepared.evidence_id,
  });
  assert.equal(result.status, 'evidence_denied');
  const memory = new MemoryEngine({ dbPath: f.dbPath });
  try { assert.equal(memory.getApproval(prepared.approval_id).uses, 0); }
  finally { memory.close(); }
});

test('identity change and expired approval both fail closed', async (t) => {
  const f = fixture(); t.after(() => f.cleanup());
  const prepared = prepareApprovedMemoryWrite({
    cwd: f.cwd, scopePath: f.scopePath, text: 'Do not reassign.', confirmed: true,
  });
  execFileSync('git', ['-C', f.cwd, 'remote', 'set-url', 'origin', 'https://github.com/example/other.git']);
  assert.equal((await commitApprovedMemoryWrite({
    cwd: f.cwd, scopePath: f.scopePath, evidenceId: prepared.evidence_id,
  })).status, 'scope_denied');
  execFileSync('git', ['-C', f.cwd, 'remote', 'set-url', 'origin', 'https://github.com/example/approved.git']);
  const expiry = prepareApprovedMemoryWrite({
    cwd: f.cwd, scopePath: f.scopePath, text: 'Expired only.', confirmed: true,
    now: () => new Date(Date.now() - 30 * 60_000),
  });
  assert.equal((await commitApprovedMemoryWrite({
    cwd: f.cwd, scopePath: f.scopePath, evidenceId: expiry.evidence_id,
  })).status, 'approval_denied');
});

test('agent inference cannot masquerade as operator-approved evidence', async (t) => {
  const f = fixture(); t.after(() => f.cleanup());
  const id = 'evidence:codex-approved:00000000-0000-4000-8000-000000000123';
  const memory = new MemoryEngine({ dbPath: f.dbPath });
  try {
    memory.recordEvidence({
      id, projectId: f.projectId,
      sourceKind: 'agent', sourceRef: 'agent:session', branch: 'main',
      capturedAt: new Date().toISOString(), authorityClass: 'agent_inference',
      content: 'Untrusted agent suggestion.',
    });
  } finally { memory.close(); }
  assert.equal((await commitApprovedMemoryWrite({
    cwd: f.cwd, scopePath: f.scopePath, evidenceId: id,
  })).status, 'evidence_denied');
});

test('an explicit operator confirmation is required before any preparation write', (t) => {
  const f = fixture(); t.after(() => f.cleanup());
  assert.throws(() => prepareApprovedMemoryWrite({
    cwd: f.cwd, scopePath: f.scopePath, text: 'Not confirmed.',
  }), /explicit_operator_confirmation_required/);
  const m = createApprovedMemoryWriteDispatcher({ cwd: f.cwd, scopePath: f.scopePath });
  assert.equal(typeof m, 'function');
});
