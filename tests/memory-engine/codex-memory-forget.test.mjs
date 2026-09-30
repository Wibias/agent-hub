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
import {
  runCodexMemoryHook,
} from '../../memory-engine/adapters/codex-hook-cli.mjs';

function userPromptEvent(overrides = {}) {
  return {
    session_id: 'thr-forget',
    transcript_path: null,
    cwd: '/repo/project',
    hook_event_name: 'UserPromptSubmit',
    model: 'gpt-5.6-sol',
    permission_mode: 'default',
    turn_id: 'turn-forget',
    prompt: 'memory forget: memory: database is Postgres',
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

function activeClaim(overrides = {}) {
  return {
    id: 'claim-old',
    project_id: 'project-a',
    kind: 'user_direct',
    subject: 'user memory',
    predicate: 'states',
    value_text: 'memory: database is Postgres',
    value: 'memory: database is Postgres',
    state: 'active',
    branch_scope: 'main',
    created_from_evidence_id: 'e-old',
    created_at: '2026-09-30T09:00:00.000Z',
    ...overrides,
  };
}

test('memory forget parser requires one exact durable memory value', () => {
  assert.deepEqual(
    parseExplicitMemoryPrompt(
      'memory forget: memory: database is Postgres',
    ),
    {
      mode: 'forget',
      value: 'memory: database is Postgres',
    },
  );

  assert.equal(
    parseExplicitMemoryPrompt('memory forget: database is Postgres'),
    null,
  );
  assert.equal(
    parseExplicitMemoryPrompt('memory forget: memory:'),
    null,
  );
  assert.equal(
    parseExplicitMemoryPrompt('forget memory: database is Postgres'),
    null,
  );
});

test('memory forget rejects exactly one active same-scope durable Claim', async () => {
  const calls = [];
  const target = activeClaim();
  const protocol = {
    async handle(request) {
      calls.push(request);
      if (request.operation === 'capture_evidence') {
        return {
          protocol: 'memory.protocol.v1',
          request_id: request.request_id,
          ok: true,
          result: {
            evidence: {
              id: request.payload.id,
              project_id: request.payload.project_id,
              harness: 'codex',
              session_id: request.payload.session_id,
              source_kind: 'session',
              source_ref: request.payload.source_ref,
              captured_at: request.payload.captured_at,
              branch: request.payload.branch,
              commit_sha: request.payload.commit_sha,
              path: null,
              blob_oid: null,
              content_redacted: request.payload.content,
              sensitivity: 'normal',
              authority_class: 'user_direct',
              metadata: request.payload.metadata,
            },
          },
        };
      }
      if (request.operation === 'assert_claim') {
        return {
          protocol: 'memory.protocol.v1',
          request_id: request.request_id,
          ok: true,
          result: {
            claim: {
              id: request.payload.claim.id,
              state: 'expired',
            },
          },
        };
      }
      return {
        protocol: 'memory.protocol.v1',
        request_id: request.request_id,
        ok: true,
        result: { items: [], conflicts: [] },
      };
    },
  };

  const adapter = createCodexMemoryHookAdapter({
    protocol,
    memory: {
      getEvidence() { return null; },
      getClaim() { return null; },
      exportCanonical() {
        return {
          evidence: [{
            id: 'e-old',
            project_id: 'project-a',
            branch: 'main',
            authority_class: 'user_direct',
          }],
          claims: [target],
        };
      },
    },
    projectId: 'project-a',
    explicitMemoryRequests: true,
    clock: () => '2026-09-30T09:30:00.000Z',
    git: fakeGit(),
  });

  const output = await adapter.handle(userPromptEvent());

  assert.deepEqual(calls.map((call) => call.operation), [
    'capture_evidence',
    'assert_claim',
  ]);
  assert.deepEqual(output, {
    decision: 'block',
    reason: 'Memory forgotten for the current project and branch.',
  });
  assert.deepEqual(calls[0].payload.metadata, {
    event_type: 'user_prompt',
    hook_event_name: 'UserPromptSubmit',
    turn_id: 'turn-forget',
    explicit_memory: true,
    explicit_memory_mode: 'forget',
  });

  assert.deepEqual(calls[1].payload.claim, {
    id: 'claim:codex:thr-forget:turn-forget:prompt',
    kind: 'memory_control',
    subject: 'user memory',
    predicate: 'forgets',
    value: 'memory: database is Postgres',
    state: 'expired',
    branch_scope: 'main',
    created_at: '2026-09-30T09:30:00.000Z',
  });
  assert.deepEqual(calls[1].payload.lifecycle, {
    supersedes: [],
    rejects: ['claim-old'],
    conflicts_with: [],
  });
});

test('memory forget refuses zero or ambiguous exact active targets', async () => {
  for (const claims of [
    [],
    [activeClaim({ id: 'claim-a' }), activeClaim({ id: 'claim-b' })],
  ]) {
    const operations = [];
    const protocol = {
      async handle(request) {
        operations.push(request.operation);
        if (request.operation === 'capture_evidence') {
          return {
            protocol: 'memory.protocol.v1',
            request_id: request.request_id,
            ok: true,
            result: {
              evidence: {
                id: request.payload.id,
                content_redacted: request.payload.content,
                captured_at: request.payload.captured_at,
              },
            },
          };
        }
        return {
          protocol: 'memory.protocol.v1',
          request_id: request.request_id,
          ok: true,
          result: { items: [], conflicts: [] },
        };
      },
    };

    const adapter = createCodexMemoryHookAdapter({
      protocol,
      memory: {
        getEvidence() { return null; },
        getClaim() { return null; },
        exportCanonical() {
          return {
            evidence: claims.map((claim, index) => ({
              id: `e-${index}`,
              project_id: claim.project_id,
              branch: claim.branch_scope,
              authority_class: 'user_direct',
            })),
            claims,
          };
        },
      },
      projectId: 'project-a',
      explicitMemoryRequests: true,
      git: fakeGit(),
    });

    const output = await adapter.handle(userPromptEvent());
    assert.deepEqual(operations, ['capture_evidence']);
    assert.equal(output.decision, 'block');
    assert.match(output.reason, /not found|not unique/i);
  }
});

test('forget authorization binds exact control Claim and exact active target', async () => {
  let protocolOptions = null;
  const target = activeClaim();

  await runCodexMemoryHook({
    event: userPromptEvent(),
    env: {
      AGENT_HUB_MEMORY_DB: '/shared/memory.sqlite3',
      AGENT_HUB_MEMORY_PROJECT_ID: 'project-a',
    },
    configOptions: {
      explicitMemoryRequests: true,
    },
    createEngine() {
      return {
        getProject() {
          return { project_id: 'project-a' };
        },
        getClaim(id) {
          return id === target.id ? target : null;
        },
        close() {},
      };
    },
    createProtocol(options) {
      protocolOptions = options;
      return { handle() {} };
    },
    createAdapter() {
      return { async handle() { return null; } };
    },
  });

  const evidence = {
    project_id: 'project-a',
    harness: 'codex',
    source_kind: 'session',
    branch: 'main',
    content_redacted: 'memory forget: memory: database is Postgres',
    authority_class: 'user_direct',
    metadata: {
      event_type: 'user_prompt',
      explicit_memory: true,
      explicit_memory_mode: 'forget',
    },
  };

  const valid = {
    evidence,
    claim: {
      kind: 'memory_control',
      subject: 'user memory',
      predicate: 'forgets',
      value: 'memory: database is Postgres',
      state: 'expired',
      branchScope: 'main',
    },
    lifecycle: {
      supersedes: [],
      rejects: ['claim-old'],
      conflictsWith: [],
    },
  };

  assert.equal(await protocolOptions.authorizeClaim(valid), true);

  assert.equal(await protocolOptions.authorizeClaim({
    ...valid,
    claim: {
      ...valid.claim,
      value: 'memory: database is MySQL',
    },
  }), false);

  assert.equal(await protocolOptions.authorizeClaim({
    ...valid,
    lifecycle: {
      supersedes: [],
      rejects: ['claim-other'],
      conflictsWith: [],
    },
  }), false);

  assert.equal(await protocolOptions.authorizeClaim({
    ...valid,
    claim: {
      ...valid.claim,
      state: 'active',
    },
  }), false);
});

test('real Codex forget marks old memory rejected and leaves no new current memory', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-hub-codex-memory-forget-'));
  const repoDir = join(root, 'repo');
  const stateHome = join(root, 'state');
  const dbPath = join(stateHome, 'agent-hub', 'memory.sqlite3');
  const cliPath = fileURLToPath(
    new URL('../../memory-engine/adapters/codex-hook-cli.mjs', import.meta.url),
  );

  try {
    mkdirSync(repoDir, { recursive: true });
    execFileSync('git', ['init', '-b', 'main', repoDir], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Memory Test']);
    execFileSync('git', [
      '-C',
      repoDir,
      'remote',
      'add',
      'origin',
      'git@github.com:example/memory-forget.git',
    ]);
    writeFileSync(join(repoDir, 'README.md'), '# smoke\n');
    execFileSync('git', ['-C', repoDir, 'add', 'README.md']);
    execFileSync('git', ['-C', repoDir, 'commit', '-m', 'smoke'], { stdio: 'ignore' });

    const prompts = [
      {
        turn_id: 'turn-remember',
        prompt: 'memory: database is Postgres',
      },
      {
        turn_id: 'turn-forget',
        prompt: 'memory forget: memory: database is Postgres',
      },
    ];

    for (const item of prompts) {
      const event = JSON.stringify({
        session_id: 'thr-forget',
        transcript_path: null,
        cwd: repoDir,
        hook_event_name: 'UserPromptSubmit',
        model: 'gpt-5.6-sol',
        permission_mode: 'default',
        turn_id: item.turn_id,
        prompt: item.prompt,
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
    }

    const memory = new MemoryEngine({ dbPath });
    try {
      const state = memory.exportCanonical();
      const remembered = state.claims.find(
        (claim) => claim.value_text === 'memory: database is Postgres'
          && claim.kind === 'user_direct',
      );
      const control = state.claims.find(
        (claim) => claim.kind === 'memory_control',
      );

      assert.ok(remembered);
      assert.equal(remembered.state, 'rejected');
      assert.match(remembered.rejected_by_evidence_id, /turn-forget/);

      assert.ok(control);
      assert.equal(control.state, 'expired');
      assert.equal(control.predicate, 'forgets');
      assert.equal(control.value_text, 'memory: database is Postgres');

      const projectId = 'github.com/example/memory-forget';
      const current = memory.recall({
        projectId,
        branch: 'main',
        query: 'database Postgres',
        mode: 'current',
      });
      assert.equal(current.items.length, 0);

      const historical = memory.recall({
        projectId,
        branch: 'main',
        query: 'database Postgres',
        mode: 'historical',
      });
      assert.equal(
        historical.items.some(
          (item) =>
            item.claim.id === remembered.id
            && item.claim.state === 'rejected',
        ),
        true,
      );
    } finally {
      memory.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
