import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { manageGlobalMemoryProject } from '../../memory-engine/adapters/codex-global-memory-scope.mjs';
import { diagnoseCodexMemoryPipeline } from '../../scripts/diagnose-codex-memory-pipeline.mjs';

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'agenthub-memory-diagnostic-'));
  const first = join(base, 'alpha');
  const second = join(base, 'beta');
  const codexHome = join(base, 'codex-home');
  mkdirSync(first); mkdirSync(second); mkdirSync(codexHome);
  const repo = (path, name) => {
    execFileSync('git', ['init', '-b', 'main', path], { stdio: 'ignore' });
    execFileSync('git', ['-C', path, '-c', 'user.name=Test',
      '-c', 'user.email=test@example.invalid',
      'commit', '--allow-empty', '-m', 'initial'], { stdio: 'ignore' });
    execFileSync('git', ['-C', path, 'remote', 'add', 'origin',
      'https://github.com/example/' + name + '.git']);
  };
  repo(first, 'alpha');
  repo(second, 'beta');
  const memoryDb = join(base, 'memory.sqlite3');
  const scopePath = join(base, 'scopes.json');
  const memory = new MemoryEngine({ dbPath: memoryDb });
  memory.registerProject({
    projectId: 'github.com/example/alpha',
    repoIdentity: 'github.com/example/alpha',
  });
  memory.registerProject({
    projectId: 'github.com/example/beta',
    repoIdentity: 'github.com/example/beta',
  });
  memory.ingest({
    evidence: {
      id: 'e-real', projectId: 'github.com/example/alpha', harness: 'codex',
      sessionId: 'real-session', sourceKind: 'session',
      sourceRef: 'session:real-session',
      capturedAt: '2026-11-12T00:00:00Z', branch: 'main',
      commitSha: null, path: null, blobOid: null,
      content: 'Choose SQLite for the application',
      authorityClass: 'user_direct',
      metadata: { event_type: 'user_prompt' },
    },
    claim: {
      id: 'c-real', kind: 'decision', subject: 'storage', predicate: 'uses',
      value: 'SQLite', branchScope: 'main',
      createdAt: '2026-11-12T00:00:00Z',
    },
  });
  memory.recordEvidence({
    id: 'e-pending', projectId: 'github.com/example/beta', harness: 'codex',
    sessionId: 'real-beta', sourceKind: 'session',
    sourceRef: 'session:real-beta',
    capturedAt: '2026-11-12T00:00:00Z', branch: 'main',
    commitSha: null, path: null, blobOid: null,
    content: 'We decided to use SQLite',
    authorityClass: 'user_direct',
    metadata: { event_type: 'user_prompt' },
  });
  memory.recordCandidate({
    id: 'candidate-pending', evidenceId: 'e-pending', type: 'decision',
    proposedValue: 'We decided to use SQLite',
    decisionReason: 'rule:decision:definitive', policyVersion: 'capture-v1',
    fingerprint: 'a'.repeat(64), createdAt: '2026-11-12T00:00:00Z',
  });
  memory.close();
  for (const path of [first, second]) {
    manageGlobalMemoryProject({
      operation: 'add', cwd: path, dbPath: memoryDb, scopePath, apply: true,
    });
  }
  return {
    base, first, second, codexHome, memoryDb, scopePath,
    close() { rmSync(base, { recursive: true, force: true }); },
  };
}

test('no memory values escape and original SQLite remains byte-for-byte unchanged', () => {
  const f = fixture();
  try {
    const hash = () => createHash('sha256').update(readFileSync(f.memoryDb)).digest('hex');
    const before = hash();
    const report = diagnoseCodexMemoryPipeline({
      scopePath: f.scopePath, codexHome: f.codexHome,
    });
    assert.equal(report.status, 'inspected');
    assert.equal(report.read_only, true);
    assert.equal(report.approved_project_count, 2);
    assert.equal(report.hooks.status, 'missing');
    assert.equal(report.hooks.runtime_execution_observed, false);
    assert.equal(hash(), before);
    assert.equal(JSON.stringify(report).includes('Choose SQLite'), false);
    assert.equal(JSON.stringify(report).includes('We decided'), false);
    assert.equal(JSON.stringify(report).includes('real-session'), false);

    const alpha = report.projects.find(x => x.project_id.endsWith('/alpha'));
    assert.equal(alpha.status, 'inspected');
    assert.equal(alpha.branch, 'main');
    assert.equal(alpha.counts.user_prompt_evidence, 1);
    assert.equal(alpha.counts.claims_current_branch_by_state.active, 1);
    assert.equal(alpha.counts.eligible_claims_upper_bound, 1);
    assert.ok(alpha.findings.includes('some_potentially_retrievable_claims_check_query_matching'));

    const beta = report.projects.find(x => x.project_id.endsWith('/beta'));
    assert.equal(beta.status, 'inspected');
    assert.equal(beta.counts.pending_user_candidates, 1);
    assert.equal(beta.counts.eligible_claims_upper_bound, 0);
    assert.ok(beta.findings.includes('pending_user_candidates_without_pipeline_runs'));
  } finally { f.close(); }
});

test('missing scope and missing SQLite are reported without generating files', () => {
  const f = fixture();
  try {
    const absent = join(f.base, 'absent.json');
    const report = diagnoseCodexMemoryPipeline({
      scopePath: absent, codexHome: f.codexHome,
    });
    assert.equal(report.status, 'scope_not_configured');
    assert.equal(existsSync(absent), false);
    assert.deepEqual(report.projects, []);
  } finally { f.close(); }
});

test('hook configuration is inspected without claiming actual host execution', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.codexHome, 'hooks.json'), JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command',
            command: 'node scripts/memory-engine/adapters/codex-hook-cli.mjs --ignore-memory-env --candidate-capture --auto-pipeline' }],
        }],
      },
    }));
    const r = diagnoseCodexMemoryPipeline({
      scopePath: f.scopePath, codexHome: f.codexHome,
    });
    assert.equal(r.hooks.status, 'parsed');
    assert.equal(r.hooks.configured, true);
    assert.equal(r.hooks.flags.candidate_capture, true);
    assert.equal(r.hooks.flags.auto_pipeline_configured, true);
    assert.equal(r.hooks.runtime_execution_observed, false);
  } finally { f.close(); }
});
