import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  inspectCodexCandidateQueue,
  runCodexAgentPipelineHook,
} from '../../scripts/codex-agent-memory-pipeline-hook.mjs';

function fixture({ pending = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'codex-stop-backlog-'));
  const cwd = join(root, 'repo');
  const dbPath = join(root, 'memory.sqlite3');
  const projectId = 'github.com/example/stop-backlog';
  mkdirSync(cwd);
  execFileSync('git', ['init', '-b', 'main', cwd], { stdio: 'ignore' });
  execFileSync('git', ['-C', cwd, 'config', 'user.name', 'Backlog Test']);
  execFileSync('git', ['-C', cwd, 'config', 'user.email', 'test@example.test']);
  execFileSync('git', ['-C', cwd, 'remote', 'add', 'origin', 'https://github.com/example/stop-backlog.git']);
  writeFileSync(join(cwd, 'README.md'), 'fixture\n');
  execFileSync('git', ['-C', cwd, 'add', 'README.md']);
  execFileSync('git', ['-C', cwd, 'commit', '-m', 'initial'], { stdio: 'ignore' });

  const memory = new MemoryEngine({ dbPath });
  try {
    memory.registerProject({ projectId, repoIdentity: projectId, canonicalRemote: projectId });
    if (pending) {
      memory.recordEvidence({
        id: 'e-direct', projectId, harness: 'codex', sessionId: 'session-1',
        sourceKind: 'session', sourceRef: 'session:session-1',
        capturedAt: '2026-11-12T05:00:00.000Z', branch: 'main',
        content: 'We decided to use PostgreSQL for transactions.',
        authorityClass: 'user_direct',
        metadata: { event_type: 'user_prompt', candidate_capture: true },
      });
      memory.recordCandidate({
        id: 'candidate-direct', evidenceId: 'e-direct', type: 'decision',
        proposedValue: 'We decided to use PostgreSQL for transactions.',
        decisionReason: 'rule:decision:definitive',
        policyVersion: 'capture-test',
        fingerprint: createHash('sha256').update('pending-postgres').digest('hex'),
        createdAt: '2026-11-12T05:00:00.000Z',
      });
    }
  } finally {
    memory.close();
  }
  return {
    root, cwd, dbPath, projectId,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    event: (extra = {}) => ({
      hook_event_name: 'Stop', session_id: 'session-1',
      cwd, turn_id: 'turn-1', last_assistant_message: null,
      stop_hook_active: false, ...extra,
    }),
  };
}

test('Windows Stop processes already captured user backlog with null assistant message', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const calls = [];
  const results = [];
  const outcome = await runCodexAgentPipelineHook({
    event: f.event(),
    env: { AGENT_HUB_MEMORY_DB: f.dbPath },
    captureDecision: () => {
      calls.push('capture');
      throw new Error('no assistant message may be fabricated');
    },
    async runWorker(input) {
      calls.push('worker');
      assert.equal(input.projectId, f.projectId);
      assert.equal(input.branch, 'main');
      assert.equal(input.dbPath, f.dbPath);
      assert.equal(input.trigger, 'Stop');
      assert.ok(/^[a-f0-9]{40}$/.test(input.revisionSha));
      input.log('no untrusted text');
      return { status: 'drained', promotedClaims: 0 };
    },
    createLog: () => (value) => results.push(value),
  });

  assert.equal(outcome.status, 'completed');
  assert.deepEqual(calls, ['worker']);
  assert.deepEqual(results, ['no untrusted text', JSON.stringify({ status: 'drained', promotedClaims: 0 })]);

  const memory = new MemoryEngine({ dbPath: f.dbPath, readOnly: true });
  try {
    assert.equal(memory.getClaim('candidate-direct'), null);
    assert.equal(memory.listUnevaluatedCandidates({ projectId: f.projectId, branch: 'main' }).length, 1);
  } finally { memory.close(); }
});

test('Stop skips with no actionable candidates without invoking a judge', async (t) => {
  const f = fixture({ pending: false });
  t.after(f.cleanup);
  let calls = 0;
  const outcome = await runCodexAgentPipelineHook({
    event: f.event(),
    env: { AGENT_HUB_MEMORY_DB: f.dbPath },
    captureDecision() { calls++; throw new Error('must not capture null assistant'); },
    runWorker() { calls++; throw new Error('must not judge empty queue'); },
  });
  assert.deepEqual(outcome, { status: 'skipped', reason: 'no_actionable_candidates' });
  assert.equal(calls, 0);
});

test('pending candidates from main are not evaluated on another Git branch', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  execFileSync('git', ['-C', f.cwd, 'checkout', '-b', 'feature/other'], { stdio: 'ignore' });
  const outcome = await runCodexAgentPipelineHook({
    event: f.event(),
    env: { AGENT_HUB_MEMORY_DB: f.dbPath },
    runWorker() { throw new Error('cross-branch judge must never run'); },
  });
  assert.deepEqual(outcome, { status: 'skipped', reason: 'no_actionable_candidates' });
  assert.equal(inspectCodexCandidateQueue({
    dbPath: f.dbPath, projectId: f.projectId, branch: 'main',
  }), 'ready');
});

test('recursive Stop and malformed events never launch background evaluation', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  let launches = 0;
  for (const event of [
    f.event({ stop_hook_active: true }),
    f.event({ session_id: '' }),
    f.event({ hook_event_name: 'Unknown' }),
  ]) {
    const result = await runCodexAgentPipelineHook({
      event, env: { AGENT_HUB_MEMORY_DB: f.dbPath },
      runWorker() { launches++; },
    });
    assert.deepEqual(result, { status: 'skipped', reason: 'invalid_or_recursive_event' });
  }
  assert.equal(launches, 0);
});

test('agent capture failure does not suppress a previously captured user candidate', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  let workerCalls = 0;
  const outcome = await runCodexAgentPipelineHook({
    event: f.event({ last_assistant_message: 'Agent text.' }),
    env: { AGENT_HUB_MEMORY_DB: f.dbPath },
    async captureDecision() { throw new Error('agent capture failed'); },
    async runWorker() {
      workerCalls++;
      return { status: 'drained' };
    },
    createLog: () => () => {},
  });
  assert.equal(outcome.status, 'completed');
  assert.equal(workerCalls, 1);
});

test('unavailable canonical database fails closed without starting worker', async (t) => {
  const f = fixture({ pending: false });
  t.after(f.cleanup);
  const outcome = await runCodexAgentPipelineHook({
    event: f.event(),
    env: { AGENT_HUB_MEMORY_DB: join(f.root, 'does-not-exist.sqlite3') },
    runWorker() { throw new Error('missing DB should not run worker'); },
  });
  assert.deepEqual(outcome, { status: 'skipped', reason: 'queue_unavailable' });
});
