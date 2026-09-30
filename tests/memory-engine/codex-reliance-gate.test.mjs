import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCodexMemoryHookAdapter,
} from '../../memory-engine/adapters/codex-hooks.mjs';

function event(prompt = 'Which database do we use?') {
  return {
    session_id: 'thr-reliance',
    transcript_path: null,
    cwd: '/repo/project',
    hook_event_name: 'UserPromptSubmit',
    model: 'gpt-5.6-sol',
    permission_mode: 'default',
    turn_id: 'turn-reliance',
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

function item(id, authority, value) {
  return {
    claim: {
      id,
      kind: 'decision',
      subject: 'database',
      predicate: 'uses',
      value,
      state: 'active',
    },
    evidence: {
      id: `e-${id}`,
      authority_class: authority,
      source_ref: `source:${id}`,
      content_redacted: `Evidence says ${value}.`,
    },
    freshness: null,
    rank: 0,
  };
}

function adapterFor(result) {
  return createCodexMemoryHookAdapter({
    protocol: {
      async handle(request) {
        assert.equal(request.operation, 'recall');
        return {
          protocol: 'memory.protocol.v1',
          request_id: request.request_id,
          ok: true,
          result,
        };
      },
    },
    memory: {},
    projectId: 'project-a',
    git: fakeGit(),
  });
}

test('Codex answer context excludes authorities not allowed for answer reliance', async () => {
  const output = await adapterFor({
    items: [
      item('c-user', 'user_direct', 'Postgres'),
      item('c-agent', 'agent_inference', 'SQLite'),
      item('c-external', 'external_untrusted', 'MySQL'),
      item('c-unknown', 'unclassified', 'Oracle'),
    ],
    conflicts: [],
  }).handle(event());

  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /Postgres/);
  assert.doesNotMatch(context, /SQLite/);
  assert.doesNotMatch(context, /MySQL/);
  assert.doesNotMatch(context, /Oracle/);
});

test('Codex answer context keeps all authorities allowed for answer reliance', async () => {
  const output = await adapterFor({
    items: [
      item('c-user', 'user_direct', 'Postgres'),
      item('c-repo', 'repo_trusted', 'Redis'),
      item('c-tool', 'tool_observation', 'NATS'),
    ],
    conflicts: [],
  }).handle(event());

  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /Postgres/);
  assert.match(context, /Redis/);
  assert.match(context, /NATS/);
});

test('unresolved allowed conflict produces no injectable answer context', async () => {
  const output = await adapterFor({
    items: [
      item('c-a', 'user_direct', 'Postgres'),
      item('c-b', 'repo_trusted', 'SQLite'),
    ],
    conflicts: [{
      claim_a: 'c-a',
      claim_b: 'c-b',
      state: 'open',
      created_by_evidence_id: 'e-conflict',
      created_at: '2026-09-30T20:00:00.000Z',
      resolved_by_evidence_id: null,
      resolved_at: null,
    }],
  }).handle(event());

  assert.equal(output, null);
});

test('authority-resolved conflict injects only the allowed winner without unresolved warning', async () => {
  const output = await adapterFor({
    items: [
      item('c-user', 'user_direct', 'Postgres'),
      item('c-external', 'external_untrusted', 'SQLite'),
    ],
    conflicts: [{
      claim_a: 'c-user',
      claim_b: 'c-external',
      state: 'open',
      created_by_evidence_id: 'e-conflict',
      created_at: '2026-09-30T20:00:00.000Z',
      resolved_by_evidence_id: null,
      resolved_at: null,
    }],
  }).handle(event());

  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /Postgres/);
  assert.doesNotMatch(context, /SQLite/);
  assert.doesNotMatch(context, /Unresolved conflict edges/);
});
