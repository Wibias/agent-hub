import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  createCodexMemoryHookAdapter,
  parseExplicitMemoryPrompt,
} from '../../memory-engine/adapters/codex-hooks.mjs';

function userPromptEvent(overrides = {}) {
  return {
    session_id: 'thr-list',
    transcript_path: null,
    cwd: '/repo/project',
    hook_event_name: 'UserPromptSubmit',
    model: 'gpt-5.6-sol',
    permission_mode: 'default',
    turn_id: 'turn-list',
    prompt: 'memory list',
    ...overrides,
  };
}

function fakeGit(branch = 'main') {
  return {
    resolveContext() {
      return {
        repoPath: '/repo/project',
        branch,
        revisionSha: 'a'.repeat(40),
      };
    },
    refreshFreshness() {},
  };
}

function exportedMemory() {
  return {
    evidence: [
      {
        id: 'e-main-a',
        project_id: 'project-a',
        branch: 'main',
        authority_class: 'user_direct',
      },
      {
        id: 'e-main-b',
        project_id: 'project-a',
        branch: 'main',
        authority_class: 'user_direct',
      },
      {
        id: 'e-other-branch',
        project_id: 'project-a',
        branch: 'feature/other',
        authority_class: 'user_direct',
      },
      {
        id: 'e-other-project',
        project_id: 'project-b',
        branch: 'main',
        authority_class: 'user_direct',
      },
      {
        id: 'e-inference',
        project_id: 'project-a',
        branch: 'main',
        authority_class: 'agent_inference',
      },
    ],
    claims: [
      {
        id: 'c-main-a',
        project_id: 'project-a',
        kind: 'user_direct',
        subject: 'user memory',
        predicate: 'states',
        value_text: 'memory: database is Postgres',
        state: 'active',
        branch_scope: 'main',
        created_from_evidence_id: 'e-main-a',
        created_at: '2026-09-30T09:00:00.000Z',
      },
      {
        id: 'c-main-b',
        project_id: 'project-a',
        kind: 'user_direct',
        subject: 'user memory',
        predicate: 'states',
        value_text: 'memory: camera quality is 720p HIGH',
        state: 'active',
        branch_scope: 'main',
        created_from_evidence_id: 'e-main-b',
        created_at: '2026-09-30T09:01:00.000Z',
      },
      {
        id: 'c-superseded',
        project_id: 'project-a',
        kind: 'user_direct',
        subject: 'user memory',
        predicate: 'states',
        value_text: 'memory: database is SQLite',
        state: 'superseded',
        branch_scope: 'main',
        created_from_evidence_id: 'e-main-a',
        created_at: '2026-09-30T08:00:00.000Z',
      },
      {
        id: 'c-other-branch',
        project_id: 'project-a',
        kind: 'user_direct',
        subject: 'user memory',
        predicate: 'states',
        value_text: 'memory: feature branch only',
        state: 'active',
        branch_scope: 'feature/other',
        created_from_evidence_id: 'e-other-branch',
        created_at: '2026-09-30T09:02:00.000Z',
      },
      {
        id: 'c-other-project',
        project_id: 'project-b',
        kind: 'user_direct',
        subject: 'user memory',
        predicate: 'states',
        value_text: 'memory: other project only',
        state: 'active',
        branch_scope: 'main',
        created_from_evidence_id: 'e-other-project',
        created_at: '2026-09-30T09:03:00.000Z',
      },
      {
        id: 'c-inference',
        project_id: 'project-a',
        kind: 'agent_inference',
        subject: 'guess',
        predicate: 'is',
        value_text: 'not direct user memory',
        state: 'active',
        branch_scope: 'main',
        created_from_evidence_id: 'e-inference',
        created_at: '2026-09-30T09:04:00.000Z',
      },
    ],
  };
}

test('memory list parser is strict and read-only', () => {
  assert.deepEqual(parseExplicitMemoryPrompt('memory list'), {
    mode: 'list',
  });
  assert.deepEqual(parseExplicitMemoryPrompt('  MEMORY LIST  '), {
    mode: 'list',
  });

  assert.equal(parseExplicitMemoryPrompt('memory list everything'), null);
  assert.equal(parseExplicitMemoryPrompt('please memory list'), null);
});

test('memory list returns only active direct-user memories in current project and branch', async () => {
  let protocolCalled = false;
  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle() {
        protocolCalled = true;
        throw new Error('memory list must not use protocol mutation/recall');
      },
    },
    memory: {
      exportCanonical() {
        return exportedMemory();
      },
    },
    projectId: 'project-a',
    explicitMemoryRequests: true,
    git: fakeGit('main'),
  });

  const output = await adapter.handle(userPromptEvent());

  assert.equal(protocolCalled, false);
  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /active durable user memories/i);
  assert.match(context, /memory: database is Postgres/);
  assert.match(context, /memory: camera quality is 720p HIGH/);
  assert.doesNotMatch(context, /database is SQLite/);
  assert.doesNotMatch(context, /feature branch only/);
  assert.doesNotMatch(context, /other project only/);
  assert.doesNotMatch(context, /not direct user memory/);
});

test('memory list reports an empty current scope without persisting anything', async () => {
  let protocolCalled = false;
  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle() {
        protocolCalled = true;
        throw new Error('memory list must stay read-only');
      },
    },
    memory: {
      exportCanonical() {
        return { evidence: [], claims: [] };
      },
    },
    projectId: 'project-a',
    explicitMemoryRequests: true,
    git: fakeGit('main'),
  });

  const output = await adapter.handle(userPromptEvent());

  assert.equal(protocolCalled, false);
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /no active durable user memories/i,
  );
});

test('memory list output stays bounded', async () => {
  const state = exportedMemory();
  state.evidence = [];
  state.claims = [];

  for (let index = 0; index < 100; index += 1) {
    const evidenceId = `e-${index}`;
    state.evidence.push({
      id: evidenceId,
      project_id: 'project-a',
      branch: 'main',
      authority_class: 'user_direct',
    });
    state.claims.push({
      id: `c-${index}`,
      project_id: 'project-a',
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value_text: `memory: ${'x'.repeat(150)}-${index}`,
      state: 'active',
      branch_scope: 'main',
      created_from_evidence_id: evidenceId,
      created_at: `2026-09-30T09:${String(index % 60).padStart(2, '0')}:00.000Z`,
    });
  }

  const adapter = createCodexMemoryHookAdapter({
    protocol: { async handle() { throw new Error('must not be called'); } },
    memory: {
      exportCanonical() {
        return state;
      },
    },
    projectId: 'project-a',
    explicitMemoryRequests: true,
    git: fakeGit('main'),
    maxContextBytes: 1_024,
  });

  const output = await adapter.handle(userPromptEvent());
  const context = output.hookSpecificOutput.additionalContext;
  assert.ok(Buffer.byteLength(context, 'utf8') <= 1_024);
  assert.match(context, /active durable user memories/i);
});

test('real Codex CLI memory list reads the production store without writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-hub-codex-memory-list-'));
  const repoDir = join(root, 'repo');
  const stateHome = join(root, 'state');
  const dbPath = join(stateHome, 'agent-hub', 'memory.sqlite3');
  const cliPath = fileURLToPath(
    new URL('../../memory-engine/adapters/codex-hook-cli.mjs', import.meta.url),
  );

  try {
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(join(stateHome, 'agent-hub'), { recursive: true });
    execFileSync('git', ['init', '-b', 'main', repoDir], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Memory Test']);
    execFileSync('git', [
      '-C',
      repoDir,
      'remote',
      'add',
      'origin',
      'git@github.com:example/memory-list.git',
    ]);
    writeFileSync(join(repoDir, 'README.md'), '# smoke\n');
    execFileSync('git', ['-C', repoDir, 'add', 'README.md']);
    execFileSync('git', ['-C', repoDir, 'commit', '-m', 'smoke'], { stdio: 'ignore' });

    const memory = new MemoryEngine({ dbPath });
    try {
      const projectId = 'github.com/example/memory-list';
      memory.registerProject({
        projectId,
        repoIdentity: projectId,
        canonicalRemote: projectId,
      });
      memory.ingest({
        evidence: {
          id: 'e-current',
          projectId,
          harness: 'codex',
          sessionId: 'seed',
          sourceKind: 'session',
          sourceRef: 'session:seed',
          capturedAt: '2026-09-30T09:00:00.000Z',
          branch: 'main',
          commitSha: null,
          path: null,
          blobOid: null,
          content: 'memory: current value',
          authorityClass: 'user_direct',
          metadata: { event_type: 'user_prompt', explicit_memory: true },
        },
        claim: {
          id: 'c-current',
          kind: 'user_direct',
          subject: 'user memory',
          predicate: 'states',
          value: 'memory: current value',
          branchScope: 'main',
          createdAt: '2026-09-30T09:00:00.000Z',
        },
      });
    } finally {
      memory.close();
    }

    const before = new MemoryEngine({ dbPath });
    let beforeExport;
    try {
      beforeExport = before.exportCanonical();
    } finally {
      before.close();
    }

    const event = JSON.stringify({
      session_id: 'thr-list',
      transcript_path: null,
      cwd: repoDir,
      hook_event_name: 'UserPromptSubmit',
      model: 'gpt-5.6-sol',
      permission_mode: 'default',
      turn_id: 'turn-list',
      prompt: 'memory list',
    });

    const result = spawnSync(process.execPath, [
      cliPath,
      '--ignore-memory-env',
      '--explicit-memory-requests',
    ], {
      input: event,
      encoding: 'utf8',
      env: {
        ...process.env,
        XDG_STATE_HOME: stateHome,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.match(
      output.hookSpecificOutput.additionalContext,
      /active durable user memories/i,
    );
    assert.match(
      output.hookSpecificOutput.additionalContext,
      /memory: current value/,
    );

    const after = new MemoryEngine({ dbPath });
    try {
      assert.deepEqual(after.exportCanonical(), beforeExport);
    } finally {
      after.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
