import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCodexMemoryHookAdapter,
} from '../../memory-engine/adapters/codex-hooks.mjs';

function event(prompt) {
  return {
    session_id: 'thr-command',
    transcript_path: null,
    cwd: '/repo/project',
    hook_event_name: 'UserPromptSubmit',
    model: 'gpt-5.6-sol',
    permission_mode: 'default',
    turn_id: 'turn-command',
    prompt,
  };
}

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

test('memory list is consumed as a terminal UserPromptSubmit command', async () => {
  const adapter = createCodexMemoryHookAdapter({
    protocol: {
      async handle() {
        throw new Error('memory list must not call protocol');
      },
    },
    memory: {
      exportCanonical() {
        return { evidence: [], claims: [] };
      },
    },
    projectId: 'project-a',
    explicitMemoryRequests: true,
    git: fakeGit(),
  });

  const output = await adapter.handle(event('memory list'));

  assert.deepEqual(output, {
    decision: 'block',
    reason: 'No active durable user memories for the current project and branch.',
  });
});

test('memory remember is consumed after a successful write and does not fall through to recall', async () => {
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

      if (request.operation === 'assert_claim') {
        return {
          protocol: 'memory.protocol.v1',
          request_id: request.request_id,
          ok: true,
          result: {
            claim: {
              id: request.payload.claim.id,
              state: 'active',
            },
          },
        };
      }

      throw new Error('terminal memory command must not recall');
    },
  };

  const adapter = createCodexMemoryHookAdapter({
    protocol,
    memory: {
      getEvidence() { return null; },
      getClaim() { return null; },
    },
    projectId: 'project-a',
    explicitMemoryRequests: true,
    clock: () => '2026-09-30T12:00:00.000Z',
    git: fakeGit(),
  });

  const output = await adapter.handle(event('memory: database is Postgres'));

  assert.deepEqual(operations, ['capture_evidence', 'assert_claim']);
  assert.deepEqual(output, {
    decision: 'block',
    reason: 'Memory stored for the current project and branch.',
  });
});

test('unknown memory lifecycle target is consumed without mutation or recall', async () => {
  for (const prompt of [
    'memory forget: @0000000000',
    'memory replace: @0000000000 => memory: database is Postgres',
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

        throw new Error('unknown target must not assert or recall');
      },
    };

    const adapter = createCodexMemoryHookAdapter({
      protocol,
      memory: {
        getEvidence() { return null; },
        getClaim() { return null; },
        exportCanonical() {
          return { evidence: [], claims: [] };
        },
      },
      projectId: 'project-a',
      explicitMemoryRequests: true,
      git: fakeGit(),
    });

    const output = await adapter.handle(event(prompt));

    assert.deepEqual(operations, ['capture_evidence']);
    assert.deepEqual(output, {
      decision: 'block',
      reason: 'Memory not changed: target was not found or was not unique in the current project and branch.',
    });
  }
});

test('ordinary prompts still continue with recalled additionalContext', async () => {
  const operations = [];
  const protocol = {
    async handle(request) {
      operations.push(request.operation);
      return {
        protocol: 'memory.protocol.v1',
        request_id: request.request_id,
        ok: true,
        result: {
          items: [{
            claim: {
              id: 'c-postgres',
              kind: 'decision',
              subject: 'database',
              predicate: 'uses',
              value: 'Postgres',
              state: 'active',
            },
            evidence: {
              id: 'e-postgres',
              authority_class: 'user_direct',
              source_ref: 'session:decision',
              content_redacted: 'Use Postgres.',
            },
          }],
          conflicts: [],
        },
      };
    },
  };

  const adapter = createCodexMemoryHookAdapter({
    protocol,
    memory: {},
    projectId: 'project-a',
    explicitMemoryRequests: true,
    git: fakeGit(),
  });

  const output = await adapter.handle(event('Which database do we use?'));

  assert.deepEqual(operations, ['recall']);
  assert.equal(output.decision, undefined);
  assert.match(output.hookSpecificOutput.additionalContext, /Postgres/);
});
