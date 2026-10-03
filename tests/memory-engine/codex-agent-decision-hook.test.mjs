import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  runCodexAgentDecisionHook,
} from '../../memory-engine/adapters/codex-agent-decision-hook-cli.mjs';

function rootEvent(overrides = {}) {
  return {
    hook_event_name: 'Stop',
    session_id: 'session-1',
    cwd: '/fixture/repo',
    turn_id: 'turn-1',
    stop_hook_active: false,
    last_assistant_message: 'Decision: use Postgres for concurrent writers.',
    ...overrides,
  };
}

function runtimeDeps(dbPath, {
  launch = () => {},
  pipelineReady = () => false,
  createMemory = null,
} = {}) {
  return {
    env: {},
    configOptions: {
      ignoreMemoryEnv: true,
      autoPipeline: true,
    },
    createMemory: createMemory
      ?? (() => new MemoryEngine({ dbPath })),
    resolveProjectScope() {
      return {
        projectId: 'github.com/example/project',
        repoIdentity: 'github.com/example/project',
        canonicalRemote: 'github.com/example/project',
      };
    },
    resolveGit() {
      return {
        repoPath: '/fixture/repo',
        branch: 'main',
        revisionSha: 'a'.repeat(40),
      };
    },
    ensureDbDirectory() {},
    restoreLocked() {
      return false;
    },
    pipelineReady,
    launchPipeline: launch,
  };
}

test('Stop captures explicit root-agent decision as agent_inference candidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-decision-stop-'));
  const dbPath = join(root, 'memory.sqlite3');

  const output = await runCodexAgentDecisionHook({
    event: rootEvent(),
    clock: () => '2026-10-03T03:00:00.000Z',
    ...runtimeDeps(dbPath),
  });

  assert.deepEqual(output, { continue: true });

  const memory = new MemoryEngine({ dbPath });
  const candidates = memory.listScopedCandidates({
    projectId: 'github.com/example/project',
    branch: 'main',
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source_authority, 'agent_inference');
  assert.equal(candidates[0].proposed_type, 'decision');
  assert.equal(
    candidates[0].proposed_value,
    'Decision: use Postgres for concurrent writers.',
  );

  const evidence = memory.getEvidence(candidates[0].source_evidence_id);
  assert.equal(evidence.authority_class, 'agent_inference');
  assert.equal(evidence.source_kind, 'assistant');
  assert.equal(evidence.metadata.event_type, 'assistant_stop');
  assert.equal(evidence.metadata.agent_type, 'root');
  assert.equal(evidence.metadata.decision_capture, true);
  memory.close();
});

test('SubagentStop preserves agent id/type provenance and namespaces candidate fingerprint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-decision-subagent-'));
  const dbPath = join(root, 'memory.sqlite3');

  await runCodexAgentDecisionHook({
    event: rootEvent({
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-7',
      agent_type: 'reviewer',
      last_assistant_message: 'Decision: keep the API boundary read-only.',
    }),
    ...runtimeDeps(dbPath),
  });

  const memory = new MemoryEngine({ dbPath });
  const candidate = memory.listScopedCandidates({
    projectId: 'github.com/example/project',
    branch: 'main',
  })[0];
  const evidence = memory.getEvidence(candidate.source_evidence_id);
  assert.equal(evidence.source_kind, 'subagent');
  assert.equal(evidence.metadata.agent_id, 'agent-7');
  assert.equal(evidence.metadata.agent_type, 'reviewer');
  assert.equal(evidence.metadata.event_type, 'subagent_stop');
  memory.close();
});

test('duplicate Stop event does not create duplicate evidence or candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-decision-duplicate-'));
  const dbPath = join(root, 'memory.sqlite3');
  const deps = runtimeDeps(dbPath);

  await runCodexAgentDecisionHook({ event: rootEvent(), ...deps });
  await runCodexAgentDecisionHook({ event: rootEvent(), ...deps });

  const memory = new MemoryEngine({ dbPath });
  assert.equal(memory.listScopedCandidates({
    projectId: 'github.com/example/project',
    branch: 'main',
  }).length, 1);
  assert.equal(memory.exportCanonical().evidence.length, 1);
  memory.close();
});

test('hook skips active stop recursion, tentative text, and secret-shaped decisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-decision-skip-'));
  const dbPath = join(root, 'memory.sqlite3');

  for (const event of [
    rootEvent({ stop_hook_active: true }),
    rootEvent({
      turn_id: 'turn-2',
      last_assistant_message: 'Maybe we should use Redis.',
    }),
    rootEvent({
      turn_id: 'turn-3',
      last_assistant_message:
        'Decision: use token=ghp_abcdefghijklmnopqrstuvwxyz1234567890.',
    }),
  ]) {
    await runCodexAgentDecisionHook({
      event,
      ...runtimeDeps(dbPath),
    });
  }

  const memory = new MemoryEngine({ dbPath });
  const project = memory.getProject('github.com/example/project');
  if (project !== null) {
    assert.deepEqual(memory.listScopedCandidates({
      projectId: 'github.com/example/project',
      branch: 'main',
    }), []);
    assert.equal(memory.exportCanonical().evidence.length, 0);
  }
  memory.close();
});

test('detached candidate pipeline launch happens only after memory DB is closed with frozen scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-decision-pipeline-'));
  const dbPath = join(root, 'memory.sqlite3');
  let closed = false;
  let launched = null;

  class TrackingMemory extends MemoryEngine {
    close() {
      super.close();
      closed = true;
    }
  }

  await runCodexAgentDecisionHook({
    event: rootEvent(),
    ...runtimeDeps(dbPath, {
      createMemory: () => new TrackingMemory({ dbPath }),
      pipelineReady: () => true,
      launch(args) {
        assert.equal(closed, true);
        launched = args;
      },
    }),
  });

  assert.deepEqual(launched, {
    cwd: '/fixture/repo',
    dbPath,
    projectId: 'github.com/example/project',
    branch: 'main',
    revisionSha: 'a'.repeat(40),
  });
});

test('invalid Stop payload fails open without touching memory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-decision-invalid-'));
  const dbPath = join(root, 'memory.sqlite3');
  let created = false;

  const output = await runCodexAgentDecisionHook({
    event: {
      hook_event_name: 'Stop',
      session_id: 'session-1',
    },
    ...runtimeDeps(dbPath, {
      createMemory() {
        created = true;
        throw new Error('must not run');
      },
    }),
  });

  assert.deepEqual(output, { continue: true });
  assert.equal(created, false);
});
