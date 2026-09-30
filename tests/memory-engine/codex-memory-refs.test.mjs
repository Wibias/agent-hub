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
  memoryClaimRef,
  parseExplicitMemoryPrompt,
} from '../../memory-engine/adapters/codex-hooks.mjs';

function fakeGit() {
  return {
    resolveContext() {
      return {
        repoPath: '/repo/project',
        branch: 'main',
        revisionSha: 'a'.repeat(40),
      };
    },
    refreshFreshness() {},
  };
}

function event(prompt) {
  return {
    session_id: 'thr-ref',
    transcript_path: null,
    cwd: '/repo/project',
    hook_event_name: 'UserPromptSubmit',
    model: 'gpt-5.6-sol',
    permission_mode: 'default',
    turn_id: 'turn-ref',
    prompt,
  };
}

function activeState() {
  return {
    evidence: [
      {
        id: 'e-db',
        project_id: 'project-a',
        branch: 'main',
        authority_class: 'user_direct',
      },
      {
        id: 'e-camera',
        project_id: 'project-a',
        branch: 'main',
        authority_class: 'user_direct',
      },
    ],
    claims: [
      {
        id: 'claim-database',
        project_id: 'project-a',
        kind: 'user_direct',
        subject: 'user memory',
        predicate: 'states',
        value_text: 'memory: database is Postgres',
        value: 'memory: database is Postgres',
        state: 'active',
        branch_scope: 'main',
        created_from_evidence_id: 'e-db',
        created_at: '2026-09-30T10:00:00.000Z',
      },
      {
        id: 'claim-camera',
        project_id: 'project-a',
        kind: 'user_direct',
        subject: 'user memory',
        predicate: 'states',
        value_text: 'memory: camera quality is 720p HIGH',
        value: 'memory: camera quality is 720p HIGH',
        state: 'active',
        branch_scope: 'main',
        created_from_evidence_id: 'e-camera',
        created_at: '2026-09-30T10:01:00.000Z',
      },
    ],
  };
}

test('memory Claim refs are stable opaque short handles', () => {
  const first = memoryClaimRef('claim-database');
  const again = memoryClaimRef('claim-database');
  const other = memoryClaimRef('claim-camera');

  assert.equal(first, again);
  assert.match(first, /^@[0-9a-f]{10}$/);
  assert.notEqual(first, other);
  assert.doesNotMatch(first, /claim|database/i);
});

test('memory parser accepts refs while preserving exact-value management syntax', () => {
  assert.deepEqual(
    parseExplicitMemoryPrompt('memory forget: @0123456789'),
    { mode: 'forget', ref: '@0123456789' },
  );

  assert.deepEqual(
    parseExplicitMemoryPrompt(
      'memory replace: @ABCDEF0123 => memory: database is CockroachDB',
    ),
    {
      mode: 'replace',
      oldRef: '@abcdef0123',
      newValue: 'memory: database is CockroachDB',
    },
  );

  assert.deepEqual(
    parseExplicitMemoryPrompt('memory forget: memory: database is Postgres'),
    { mode: 'forget', value: 'memory: database is Postgres' },
  );

  assert.equal(parseExplicitMemoryPrompt('memory forget: @short'), null);
  assert.equal(
    parseExplicitMemoryPrompt(
      'memory replace: @0123456789 => database is CockroachDB',
    ),
    null,
  );
});

test('memory list includes stable refs and hides raw Claim IDs', async () => {
  const state = activeState();
  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle() {
        throw new Error('memory list must stay read-only');
      },
    },
    memory: {
      exportCanonical() {
        return state;
      },
    },
    projectId: 'project-a',
    explicitMemoryRequests: true,
    git: fakeGit(),
  });

  const output = await adapter.handle(event('memory list'));
  const context = output.hookSpecificOutput.additionalContext;

  for (const claim of state.claims) {
    assert.equal(context.includes(memoryClaimRef(claim.id)), true);
    assert.equal(context.includes(claim.value_text), true);
    assert.equal(context.includes(claim.id), false);
  }
});

test('unknown memory ref fails closed without lifecycle mutation', async () => {
  const calls = [];
  const state = activeState();
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
              source_kind: 'session',
              branch: request.payload.branch,
              captured_at: request.payload.captured_at,
              content_redacted: request.payload.content,
              authority_class: 'user_direct',
              metadata: request.payload.metadata,
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
      exportCanonical() { return state; },
    },
    projectId: 'project-a',
    explicitMemoryRequests: true,
    git: fakeGit(),
  });

  await adapter.handle(event('memory forget: @0000000000'));

  assert.deepEqual(
    calls.map((call) => call.operation),
    ['capture_evidence', 'recall'],
  );
});

test('real Codex CLI supports list, replace, and forget by stable ref', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-hub-codex-memory-refs-'));
  const repoDir = join(root, 'repo');
  const stateHome = join(root, 'state');
  const dbPath = join(stateHome, 'agent-hub', 'memory.sqlite3');
  const cliPath = fileURLToPath(
    new URL('../../memory-engine/adapters/codex-hook-cli.mjs', import.meta.url),
  );
  const projectId = 'github.com/example/memory-refs';

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
      'git@github.com:example/memory-refs.git',
    ]);
    writeFileSync(join(repoDir, 'README.md'), '# smoke\n');
    execFileSync('git', ['-C', repoDir, 'add', 'README.md']);
    execFileSync('git', ['-C', repoDir, 'commit', '-m', 'smoke'], { stdio: 'ignore' });

    const memory = new MemoryEngine({ dbPath });
    try {
      memory.registerProject({
        projectId,
        repoIdentity: projectId,
        canonicalRemote: projectId,
      });

      const seeds = [
        ['e-db', 'c-db', 'memory: database is Postgres', '2026-09-30T10:00:00.000Z'],
        ['e-camera', 'c-camera', 'memory: camera quality is 720p HIGH', '2026-09-30T10:01:00.000Z'],
      ];

      for (const [evidenceId, claimId, value, capturedAt] of seeds) {
        memory.ingest({
          evidence: {
            id: evidenceId,
            projectId,
            harness: 'codex',
            sessionId: 'seed',
            sourceKind: 'session',
            sourceRef: 'session:seed',
            capturedAt,
            branch: 'main',
            commitSha: null,
            path: null,
            blobOid: null,
            content: value,
            authorityClass: 'user_direct',
            metadata: { event_type: 'user_prompt', explicit_memory: true },
          },
          claim: {
            id: claimId,
            kind: 'user_direct',
            subject: 'user memory',
            predicate: 'states',
            value,
            branchScope: 'main',
            createdAt: capturedAt,
          },
        });
      }
    } finally {
      memory.close();
    }

    const run = (prompt, turnId) => {
      const input = JSON.stringify({
        session_id: 'thr-refs',
        transcript_path: null,
        cwd: repoDir,
        hook_event_name: 'UserPromptSubmit',
        model: 'gpt-5.6-sol',
        permission_mode: 'default',
        turn_id: turnId,
        prompt,
      });

      return spawnSync(process.execPath, [
        cliPath,
        '--ignore-memory-env',
        '--explicit-memory-requests',
      ], {
        input,
        encoding: 'utf8',
        env: { ...process.env, XDG_STATE_HOME: stateHome },
      });
    };

    const dbRef = memoryClaimRef('c-db');
    const cameraRef = memoryClaimRef('c-camera');

    const listed = run('memory list', 'turn-list');
    assert.equal(listed.status, 0, listed.stderr);
    const listContext = JSON.parse(
      listed.stdout,
    ).hookSpecificOutput.additionalContext;
    assert.equal(listContext.includes(dbRef), true);
    assert.equal(listContext.includes(cameraRef), true);

    const replaced = run(
      'memory replace: ' + dbRef + ' => memory: database is CockroachDB',
      'turn-replace',
    );
    assert.equal(replaced.status, 0, replaced.stderr);

    const forgotten = run(
      'memory forget: ' + cameraRef,
      'turn-forget',
    );
    assert.equal(forgotten.status, 0, forgotten.stderr);

    const verify = new MemoryEngine({ dbPath });
    try {
      const state = verify.exportCanonical();
      const oldDb = state.claims.find((claim) => claim.id === 'c-db');
      const oldCamera = state.claims.find((claim) => claim.id === 'c-camera');
      const newDb = state.claims.find(
        (claim) => claim.value_text === 'memory: database is CockroachDB',
      );

      assert.equal(oldDb.state, 'superseded');
      assert.ok(newDb);
      assert.equal(newDb.state, 'active');
      assert.equal(oldDb.superseded_by_claim_id, newDb.id);
      assert.equal(oldCamera.state, 'rejected');

      const current = verify.recall({
        projectId,
        branch: 'main',
        query: 'database camera',
        mode: 'current',
      });

      assert.equal(current.items.some((item) => item.claim.id === 'c-db'), false);
      assert.equal(current.items.some((item) => item.claim.id === 'c-camera'), false);
      assert.equal(current.items.some((item) => item.claim.id === newDb.id), true);
    } finally {
      verify.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
