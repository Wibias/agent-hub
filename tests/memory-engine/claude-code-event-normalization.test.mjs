import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  normalizeClaudePromptEvent,
  normalizeClaudeStopEvent,
} from '../../memory-engine/adapters/claude-code-events.mjs';
import {
  runCodexAgentDecisionHook,
} from '../../memory-engine/adapters/codex-agent-decision-hook-cli.mjs';
import {
  runClaudeCodeHook,
} from '../../memory-engine/adapters/claude-code-full-hook-cli.mjs';

test('Claude prompt events gain a stable turn id', () => {
  const event = {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'session-1',
    cwd: '/fixture/repo',
    prompt: 'Decision: use one queue.',
  };

  const first = normalizeClaudePromptEvent(event);
  const second = normalizeClaudePromptEvent({ ...event });
  assert.match(first.turn_id, /^prompt:[0-9a-f]{24}$/);
  assert.equal(first.turn_id, second.turn_id);
  assert.equal(
    normalizeClaudePromptEvent({ ...event, prompt_id: 'uuid-1' }).turn_id,
    'prompt:uuid-1',
  );
});

test('Claude stop events reuse the prompt id and tolerate an empty agent type', () => {
  const promptId = normalizeClaudeStopEvent({
    hook_event_name: 'Stop',
    session_id: 'session-1',
    prompt_id: 'uuid-1',
    last_assistant_message: 'done',
  });
  assert.equal(promptId.turn_id, 'prompt:uuid-1');
  assert.equal(promptId.agent_type, 'root');

  const subagent = normalizeClaudeStopEvent({
    hook_event_name: 'SubagentStop',
    session_id: 'session-1',
    agent_id: 'agent-7',
    agent_type: '',
    last_assistant_message: 'Decision: keep it read-only.',
  });
  assert.match(subagent.turn_id, /^stop:[0-9a-f]{24}$/);
  assert.equal(subagent.agent_type, 'subagent');
});

test('Claude decision capture records claude-code provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-decision-'));
  const dbPath = join(root, 'memory.sqlite3');
  const event = normalizeClaudeStopEvent({
    hook_event_name: 'SubagentStop',
    session_id: 'session-1',
    cwd: '/fixture/repo',
    agent_id: 'agent-7',
    agent_type: '',
    stop_hook_active: false,
    last_assistant_message: 'Decision: keep the API boundary read-only.',
  });

  await runCodexAgentDecisionHook({
    event,
    harness: 'claude-code',
    env: { AGENT_HUB_MEMORY_DB: dbPath },
    configOptions: { ignoreMemoryEnv: false, autoPipeline: false },
    createMemory: ({ dbPath: resolved }) => new MemoryEngine({ dbPath: resolved }),
    resolveProjectScope: () => ({
      projectId: 'github.com/example/project',
      repoIdentity: 'github.com/example/project',
      canonicalRemote: 'github.com/example/project',
    }),
    resolveGit: () => ({
      repoPath: '/fixture/repo',
      branch: 'main',
      revisionSha: 'a'.repeat(40),
    }),
    ensureDbDirectory() {},
    restoreLocked: () => false,
    pipelineReady: () => false,
    launchPipeline() {},
  });

  const memory = new MemoryEngine({ dbPath });
  const candidate = memory.listScopedCandidates({
    projectId: 'github.com/example/project',
    branch: 'main',
  })[0];
  const evidence = memory.getEvidence(candidate.source_evidence_id);
  assert.equal(evidence.harness, 'claude-code');
  assert.equal(evidence.source_kind, 'subagent');
  assert.equal(evidence.source_ref, 'claude-code:subagent:agent-7');
  assert.equal(evidence.metadata.agent_type, 'subagent');
  memory.close();
});

test('Claude explicit memory commands pass the claude-code authority gate', async (t) => {
  // PR checkouts are detached HEADs. The memory runtime correctly denies
  // unscoped checkouts, so the fixture must create its own branch-scoped repo.
  const root = await mkdtemp(join(tmpdir(), 'claude-memory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dbPath = join(root, 'memory.sqlite3');
  const hubRoot = join(root, 'repo');
  await mkdir(hubRoot);
  execFileSync('git', ['init', '-b', 'main', hubRoot], { stdio: 'ignore' });
  execFileSync('git', ['-C', hubRoot, '-c', 'user.name=Memory Test',
    '-c', 'user.email=memory@example.test',
    'commit', '--allow-empty', '-m', 'initial'], { stdio: 'ignore' });
  execFileSync('git', ['-C', hubRoot, 'remote', 'add', 'origin',
    'https://github.com/example/claude-authority-fixture.git']);
  const value = 'Claude explicit memory command stores a user claim.';

  const result = await runClaudeCodeHook({
    event: {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session-memory',
      cwd: hubRoot,
      prompt_id: 'prompt-memory',
      prompt: 'memory: ' + value,
    },
    env: { AGENT_HUB_MEMORY_DB: dbPath },
    configOptions: {
      ignoreMemoryEnv: false,
      explicitMemoryRequests: true,
    },
  });

  assert.equal(result.decision, 'block');
  assert.match(result.reason, /Memory stored/);

  const memory = new MemoryEngine({ dbPath });
  const exported = memory.exportCanonical();
  const claim = exported.claims.find((entry) => entry.value_text === value);
  assert.equal(claim.kind, 'user_direct');
  const evidence = memory.getEvidence(claim.created_from_evidence_id);
  assert.equal(evidence.harness, 'claude-code');
  memory.close();
});
