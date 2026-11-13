import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { manageGlobalMemoryProject, readGlobalCodexMemory } from '../../memory-engine/adapters/codex-global-memory-scope.mjs';
import {
  changeProjectMemoryPublication, inspectProjectMemoryPublication,
} from '../../memory-engine/adapters/project-wide-user-memory.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'project-wide-user-memory-'));
  const cwd = join(root, 'repo');
  mkdirSync(cwd);
  execFileSync('git', ['init', '-b', 'main', cwd], { stdio: 'ignore' });
  execFileSync('git', ['-C', cwd, '-c', 'user.name=CI', '-c', 'user.email=ci@example.invalid',
    'commit', '--allow-empty', '-m', 'initial'], { stdio: 'ignore' });
  execFileSync('git', ['-C', cwd, 'remote', 'add', 'origin',
    'https://github.com/example/agent-hub.git']);
  const dbPath = join(root, 'memory.sqlite3');
  const scopePath = join(root, 'approved.json');
  const projectId = 'github.com/example/agent-hub';
  const origin = 'codex-memory-write-local';
  const memory = new MemoryEngine({ dbPath });
  memory.registerProject({ projectId, repoIdentity: projectId });
  const ingest = ({ id, value, authority = 'user_direct', kind = authority,
    branch = origin, sourceKind = authority === 'user_direct' ? 'session' : 'agent',
    sourceRef = 'session:human', metadata = { event_type: 'user_prompt' } }) => {
    memory.ingest({
      evidence: {
        id: 'evidence:' + id, projectId, harness: 'codex', sessionId: 'real',
        sourceKind, sourceRef, capturedAt: '2026-11-12T00:00:00Z',
        branch, commitSha: null, path: null, blobOid: null,
        content: value, authorityClass: authority, metadata,
      },
      claim: {
        id, kind, subject: kind === 'user_direct' ? 'user memory' : 'agent decision',
        predicate: 'states', value, branchScope: branch,
        createdAt: '2026-11-12T00:00:00Z',
      },
    });
  };
  ingest({ id: 'claim:codex:windows-platform', value: 'AgentHub permanently uses Windows x64 as its only target platform.' });
  ingest({ id: 'claim:codex:branch-only', value: 'Only this feature branch uses Sqlite memory.' });
  ingest({ id: 'claim:codex:agent-guess', value: 'Agent thinks Windows x64 is right.',
    kind: 'agent_inference', authority: 'agent_inference', sourceRef: 'agent:root',
    metadata: { event_type: 'agent_decision' } });
  ingest({ id: 'claim:runtime-e2e-seed:windows', value: 'Test fixture Windows x64',
    sourceRef: 'runtime-e2e-seed:synthetic' });
  memory.close();
  manageGlobalMemoryProject({ operation: 'add', cwd, dbPath, scopePath, apply: true });
  return {
    root, cwd, dbPath, scopePath, projectId, origin,
    read(query = 'Windows x64') {
      return readGlobalCodexMemory({ cwd, query, scopePath });
    },
    change(claimId, operation, at) {
      return changeProjectMemoryPublication({ dbPath, projectId, claimId, operation,
        confirmed: true, now: () => at });
    },
    close() { rmSync(root, { recursive: true, force: true }); },
  };
}

test('project-wide release needs explicit consent and retains original claim and provenance', (t) => {
  const f = fixture(); t.after(() => f.close());
  assert.equal(f.read().status, 'no_current_authorized_match');
  const claimId = 'claim:codex:windows-platform';
  assert.throws(() => changeProjectMemoryPublication({
    dbPath: f.dbPath, projectId: f.projectId, claimId, operation: 'publish',
  }), /explicit_operator_confirmation_required/);
  const before = inspectProjectMemoryPublication({
    dbPath: f.dbPath, projectId: f.projectId, claimId,
  });
  assert.equal(before.published, false);
  assert.equal(before.origin_branch, f.origin);
  assert.equal(f.change(claimId, 'publish', '2026-11-13T00:00:01Z').status, 'published');
  assert.equal(f.change(claimId, 'publish', '2026-11-13T00:00:02Z').status, 'already_published');
  const found = f.read();
  assert.equal(found.status, 'found');
  assert.equal(found.branch, 'main');
  assert.equal(found.read_only, true);
  assert.equal(found.project_wide_matches, 1);
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].claim.id, claimId);
  assert.equal(found.items[0].scope, 'project');
  assert.equal(found.items[0].origin_branch, f.origin);
  const m = new MemoryEngine({ dbPath: f.dbPath, readOnly: true });
  try {
    assert.equal(m.getClaim(claimId).branch_scope, f.origin);
    assert.equal(m.getEvidence('evidence:' + claimId).source_kind, 'session');
    const canonical = m.exportCanonical();
    assert.equal(canonical.claims.length, 4);
    assert.equal(canonical.evidence.filter(x => x.source_kind === 'operator_explicit').length, 1);
  } finally { m.close(); }
  assert.equal(f.change(claimId, 'revoke', '2026-11-13T00:00:03Z').status, 'revoked');
  assert.equal(f.read().status, 'no_current_authorized_match');
  assert.equal(f.change(claimId, 'revoke', '2026-11-13T00:00:04Z').status, 'already_revoked');
  assert.equal(f.change(claimId, 'publish', '2026-11-13T00:00:05Z').status, 'published');
  assert.equal(f.read().status, 'found');
});

test('no implicit publication, and untrusted or synthetic memories cannot publish', (t) => {
  const f = fixture(); t.after(() => f.close());
  assert.equal(f.read('Sqlite').status, 'no_current_authorized_match');
  for (const claimId of ['claim:codex:agent-guess','claim:runtime-e2e-seed:windows']) {
    assert.throws(() => f.change(claimId, 'publish', '2026-11-13T00:00:01Z'),
      /project_scope_(claim|provenance)_not_eligible/);
  }
  assert.equal(f.read().status, 'no_current_authorized_match');
});

test('scope publication stays within the exact approved project and cannot bypass revocation', (t) => {
  const f = fixture(); t.after(() => f.close());
  f.change('claim:codex:windows-platform', 'publish', '2026-11-13T00:00:01Z');
  assert.equal(f.read().items.length, 1);
  execFileSync('git', ['-C', f.cwd, 'remote', 'set-url', 'origin',
    'https://github.com/example/outsider.git']);
  assert.equal(f.read().status, 'project_identity_changed');
  execFileSync('git', ['-C', f.cwd, 'remote', 'set-url', 'origin',
    'https://github.com/example/agent-hub.git']);
  assert.equal(f.read().status, 'found');
  f.change('claim:codex:windows-platform', 'revoke', '2026-11-13T00:00:02Z');
  assert.equal(f.read().items.length, 0);
});

test('read-only MCP cannot publish Claims and returns only explicitly published items', (t) => {
  const f = fixture(); t.after(() => f.close());
  f.change('claim:codex:windows-platform', 'publish', '2026-11-13T00:00:01Z');
  const read = f.read('Windows x64');
  assert.deepEqual(read.items.map(x => x.claim.id), ['claim:codex:windows-platform']);
  assert.equal(read.items[0].evidence.authority_class, 'user_direct');
  assert.equal(f.read('Sqlite').items.length, 0);
});
