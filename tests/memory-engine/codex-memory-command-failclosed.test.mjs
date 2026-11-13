import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  createCodexMemoryHookAdapter,
  explicitMemoryCommandFailure,
  isExplicitMemoryCommandAttempt,
  memoryCandidateRef,
  parseExplicitMemoryPrompt,
} from '../../memory-engine/adapters/codex-hooks.mjs';
import { runCodexMemoryHook } from '../../memory-engine/adapters/codex-hook-cli.mjs';
import { planCodexMemoryHooks } from '../../scripts/install-codex-memory-hooks.mjs';

const hub = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = join(hub, 'memory-engine/adapters/codex-hook-cli.mjs');
const projectId = 'github.com/example/memory-command-fixture';

function event(cwd, prompt) {
  return {
    session_id: 'command-fixture-session',
    turn_id: 'command-fixture-turn',
    hook_event_name: 'UserPromptSubmit',
    cwd,
    prompt,
  };
}

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'agenthub-memory-command-'));
  const cwd = join(root, 'repo');
  const localAppData = join(root, 'local');
  const dbPath = join(localAppData, 'agent-hub', 'memory.sqlite3');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(dirname(dbPath), { recursive: true });
  try {
    execFileSync('git', ['init', '-b', 'main', cwd], { stdio: 'ignore' });
    execFileSync('git', ['-C', cwd, 'config', 'user.name', 'Memory Fixture']);
    execFileSync('git', ['-C', cwd, 'config', 'user.email', 'fixture@example.test']);
    execFileSync('git', ['-C', cwd, 'remote', 'add', 'origin',
      'https://github.com/example/memory-command-fixture.git']);
    writeFileSync(join(cwd, 'README.md'), '# disposable fixture\n');
    execFileSync('git', ['-C', cwd, 'add', 'README.md']);
    execFileSync('git', ['-C', cwd, 'commit', '-m', 'fixture'], { stdio: 'ignore' });

    const memory = new MemoryEngine({ dbPath });
    try {
      memory.registerProject({ projectId, repoIdentity: projectId });
      const evidence = memory.recordEvidence({
        id: 'memory-command-seed-evidence',
        projectId,
        harness: 'codex',
        sessionId: 'fixture',
        sourceKind: 'session',
        sourceRef: 'session:fixture',
        capturedAt: '2026-10-03T00:00:00.000Z',
        branch: 'main',
        content: 'Decision: keep audit artifacts until the release is completed.',
        authorityClass: 'user_direct',
        metadata: { event_type: 'user_prompt', candidate_capture: true },
      });
      const candidate = memory.recordCandidate({
        id: 'memory-command-seed-candidate',
        evidenceId: evidence.id,
        type: 'decision',
        proposedValue: evidence.content_redacted,
        decisionReason: 'rule:decision:definitive',
        policyVersion: 'capture-v1',
        fingerprint: 'memory-command-fingerprint',
        createdAt: '2026-10-03T00:00:00.000Z',
      });
      memory.evaluateCandidate({
        candidateId: candidate.id,
        evaluatorId: 'codex:test:importance-v2',
        evaluatedAt: '2026-10-03T00:01:00.000Z',
        evaluation: {
          decision: 'keep_candidate',
          suggested_type: 'decision',
          durability: 'medium',
          future_utility: 'high',
          specificity: 'high',
          confidence: 'high',
          meaning_preserved: true,
          canonical_fact: null,
          reason: 'Review after the next release.',
          risk_flags: [],
        },
      });
    } finally {
      memory.close();
    }

    run({ root, cwd, dbPath, localAppData,
      ref: memoryCandidateRef('memory-command-seed-candidate') });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function execHook({ cwd, localAppData, dbPath, prompt, overrideDbPath, useWindowsHook = false }) {
  const env = {
    ...process.env,
    LOCALAPPDATA: localAppData,
    AGENT_HUB_MEMORY_DB: overrideDbPath ?? dbPath,
    AGENT_HUB_MEMORY_PROJECT_ID: projectId,
    AGENT_HUB_MEMORY_REPO_IDENTITY: projectId,
    AGENT_HUB_MEMORY_GRAPH_RECALL_SHADOW: 'false',
  };
  let command = process.execPath;
  let args = [cli, '--explicit-memory-requests'];
  if (useWindowsHook) {
    const plan = planCodexMemoryHooks({
      existing: { hooks: {} },
      hubRoot: hub,
      nodePath: process.execPath,
    });
    const installed = plan.config.hooks.UserPromptSubmit
      .flatMap((entry) => entry.hooks)
      .find((hook) => String(hook?.command).includes('codex-hook-cli.mjs'));
    const winCommand = installed?.commandWindows;
    const match = /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(winCommand ?? '');
    assert.ok(match, 'installer must provide an encoded Windows hook');
    command = 'powershell.exe';
    args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', match[1]];
    // The installed hook intentionally ignores environment DB overrides.
    // LOCALAPPDATA points to this disposable fixture, never the real user DB.
  }
  const child = spawnSync(command, args, {
    input: JSON.stringify(event(cwd, prompt)),
    cwd,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  return String(child.stdout).trim();
}

test('candidate rejection syntax is recognized without depending on markdown escaping', () => {
  const exact = 'memory candidate reject: ~48120d4e40';
  assert.deepEqual(parseExplicitMemoryPrompt(exact), {
    mode: 'candidate_reject', candidateRef: '~48120d4e40',
  });
  assert.equal(isExplicitMemoryCommandAttempt(exact), true);
  assert.equal(isExplicitMemoryCommandAttempt('memory candidate reject: wrong'), true);
  assert.equal(isExplicitMemoryCommandAttempt('memory candidate reject'), true);
  assert.equal(isExplicitMemoryCommandAttempt('Explain JavaScript memory leaks'), false);
  assert.equal(isExplicitMemoryCommandAttempt('What are memory candidates?'), false);
  assert.equal(explicitMemoryCommandFailure(event('/repo', exact), { enabled: false }), null);
});

test('adapter catches runtime exceptions and blocks an explicit command but not an ordinary prompt', async () => {
  const adapter = createCodexMemoryHookAdapter({
    protocol: { async handle() { throw new Error('unreachable'); } },
    memory: {},
    projectId: 'project',
    explicitMemoryRequests: true,
    git: {
      resolveContext() { throw new Error('internal path or secret that must not leak'); },
      refreshFreshness() { return 0; },
    },
  });
  const commandResult = await adapter.handle(event('/repo', 'memory candidate reject: ~48120d4e40'));
  assert.equal(commandResult.decision, 'block');
  assert.match(commandResult.reason, /could not be completed/);
  assert.doesNotMatch(commandResult.reason, /internal path|secret/);
  assert.equal(await adapter.handle(event('/repo', 'Please explain memory leaks')), null);
  const invalid = await adapter.handle(event('/repo', 'memory candidate reject: invalid-ref'));
  assert.equal(invalid.decision, 'block');
  assert.match(invalid.reason, /Invalid AgentHub Memory command/);
});

test('CLI runtime failures block an explicit memory command but keep ordinary prompts fail-soft', () => {
  fixture(({ cwd, localAppData, dbPath, root }) => {
    const blockedParent = join(root, 'not-a-directory');
    writeFileSync(blockedParent, 'file, not a directory');
    const badDb = join(blockedParent, 'memory.sqlite3');
    const blocked = execHook({ cwd, localAppData, dbPath,
      overrideDbPath: badDb, prompt: 'memory candidate reject: ~48120d4e40' });
    const parsed = JSON.parse(blocked);
    assert.equal(parsed.decision, 'block');
    assert.match(parsed.reason, /could not be completed/);
    assert.equal(execHook({ cwd, localAppData, dbPath,
      overrideDbPath: badDb, prompt: 'Explain memory leaks in Node.js' }), '');
  });
});

test('real Codex CLI stdio rejects one review candidate without an agent run', () => {
  fixture(({ cwd, localAppData, dbPath, ref }) => {
    const answer = JSON.parse(execHook({
      cwd, localAppData, dbPath,
      prompt: 'memory candidate reject: ' + ref,
    }));
    assert.equal(answer.decision, 'block');
    assert.match(answer.reason, /Memory candidate rejected/);
    const memory = new MemoryEngine({ dbPath, readOnly: true });
    try {
      const candidate = memory.getCandidate('memory-command-seed-candidate');
      assert.equal(candidate.status, 'ignored');
      assert.ok(memory.getCandidateRejection(candidate.id));
      assert.equal(memory.exportCanonical().claims.length, 0);
    } finally {
      memory.close();
    }
  });
});

test('malformed candidate rejection is blocked and makes no claim or candidate state change', () => {
  fixture(({ cwd, localAppData, dbPath }) => {
    const answer = JSON.parse(execHook({
      cwd, localAppData, dbPath,
      prompt: 'memory candidate reject: not-a-ref',
    }));
    assert.equal(answer.decision, 'block');
    assert.match(answer.reason, /Invalid AgentHub Memory command/);
    const memory = new MemoryEngine({ dbPath, readOnly: true });
    try {
      assert.equal(memory.getCandidate('memory-command-seed-candidate').status, 'pending');
      assert.equal(memory.exportCanonical().claims.length, 0);
    } finally {
      memory.close();
    }
  });
});

test('installed Windows commandWindows intercepts rejection in a disposable scope', {
  skip: process.platform !== 'win32',
}, () => {
  fixture(({ cwd, localAppData, dbPath, ref }) => {
    const answer = JSON.parse(execHook({
      cwd, localAppData, dbPath,
      prompt: 'memory candidate reject: ' + ref,
      useWindowsHook: true,
    }));
    assert.equal(answer.decision, 'block');
    assert.match(answer.reason, /Memory candidate rejected/);
    const memory = new MemoryEngine({ dbPath, readOnly: true });
    try {
      const candidate = memory.getCandidate('memory-command-seed-candidate');
      assert.equal(candidate.status, 'ignored');
      assert.ok(memory.getCandidateRejection(candidate.id));
      assert.equal(memory.exportCanonical().claims.length, 0);
    } finally {
      memory.close();
    }
  });
});
