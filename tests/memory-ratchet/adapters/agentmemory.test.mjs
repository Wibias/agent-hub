import test from 'node:test';
import assert from 'node:assert/strict';

import { createAgentmemoryAdapter } from './agentmemory.mjs';

function fakeRuntime(responses = []) {
  const calls = [];
  let index = 0;
  return {
    calls,
    async start(prepared) {
      calls.push(['start', prepared.case_id ?? null]);
      return { base_url: 'http://127.0.0.1:3111' };
    },
    async request(method, path, body) {
      calls.push(['request', method, path, structuredClone(body)]);
      return responses[index++] ?? { success: true };
    },
    async stop() {
      calls.push(['stop']);
    },
  };
}

function fixture() {
  return {
    case_id: 'M03',
    current: {
      project_id: 'mr-project-b',
      branch: 'main',
      revision_sha: 'b'.repeat(40),
      repo_path: '/tmp/ratchet/project-b',
    },
    events: [
      { project_id: 'mr-project-a', repo_path: '/tmp/ratchet/project-a' },
      { project_id: 'mr-project-b', repo_path: '/tmp/ratchet/project-b' },
    ],
  };
}

test('agentmemory adapter pins the reviewed candidate revision', () => {
  const adapter = createAgentmemoryAdapter({ runtime: fakeRuntime() });
  assert.deepEqual(adapter.metadata.candidate, {
    name: 'agentmemory',
    version: '0.9.27',
    source_revision: 'a76224f0987ed8f3ea0e4961f3928736ded23f54',
  });
  assert.equal(adapter.metadata.network_required, false);
});

test('setup and teardown delegate candidate lifecycle to the full-server runtime', async () => {
  const runtime = fakeRuntime();
  const adapter = createAgentmemoryAdapter({ runtime });
  await adapter.setup(fixture());
  await adapter.teardown();

  assert.deepEqual(runtime.calls, [['start', 'M03'], ['stop']]);
});

test('session decision is saved through native project-scoped long-term memory without benchmark trust', async () => {
  const runtime = fakeRuntime([
    { success: true, memory: { id: 'mem-1', content: 'Use Postgres.' } },
  ]);
  const adapter = createAgentmemoryAdapter({ runtime });
  await adapter.setup(fixture());
  runtime.calls.length = 0;

  await adapter.ingest({
    id: 'EV-DECISION',
    at: '2026-01-02T09:00:00Z',
    harness: 'codex',
    session_id: 'S1',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: 'a'.repeat(40),
    repo_path: '/tmp/ratchet/project-a',
    trust: 'external_untrusted',
    type: 'decision',
    content: 'Use Postgres.',
    source: 'session:S1',
    relations: { supersedes: ['EV-OLD'] },
  });

  const [, method, path, body] = runtime.calls[0];
  assert.equal(method, 'POST');
  assert.equal(path, '/agentmemory/remember');
  assert.equal(body.content, 'Use Postgres.');
  assert.equal(body.type, 'architecture');
  assert.equal(body.project, 'mr-project-a');
  assert.equal('trust' in body, false);
  assert.equal('relations' in body, false);
  assert.equal('branch' in body, false);
});

test('tool/code/document events use the real observe privacy path and native commit linkage', async () => {
  const runtime = fakeRuntime([
    { observationId: 'obs-1' },
    { commit: { sha: 'c'.repeat(40) } },
  ]);
  const adapter = createAgentmemoryAdapter({ runtime });
  await adapter.setup(fixture());
  runtime.calls.length = 0;

  await adapter.ingest({
    id: 'EV-CODE',
    at: '2026-01-03T10:00:00Z',
    harness: 'codex',
    session_id: 'S2',
    project_id: 'mr-project-a',
    branch: 'feature/oauth',
    revision_sha: 'c'.repeat(40),
    repo_path: '/tmp/ratchet/project-a',
    trust: 'tool_observation',
    type: 'code_observation',
    content: 'src/auth.ts uses OAuth.',
    source: 'src/auth.ts',
  });

  assert.equal(runtime.calls.length, 2);
  const observe = runtime.calls[0];
  assert.equal(observe[2], '/agentmemory/observe');
  assert.equal(observe[3].hookType, 'post_tool_use');
  assert.equal(observe[3].sessionId, 'S2');
  assert.equal(observe[3].project, 'mr-project-a');
  assert.equal(observe[3].cwd, '/tmp/ratchet/project-a');
  assert.equal(observe[3].timestamp, '2026-01-03T10:00:00Z');
  assert.equal(observe[3].data.tool_name, 'src/auth.ts');
  assert.equal(observe[3].data.tool_output, 'src/auth.ts uses OAuth.');
  assert.ok(!JSON.stringify(observe[3]).includes('tool_observation'));

  const commit = runtime.calls[1];
  assert.equal(commit[2], '/agentmemory/session/commit');
  assert.equal(commit[3].sessionId, 'S2');
  assert.equal(commit[3].sha, 'c'.repeat(40));
  assert.equal(commit[3].branch, 'feature/oauth');
  assert.deepEqual(commit[3].files, ['src/auth.ts']);
});

test('noise remains ordinary project memory so scale tests cannot bypass it', async () => {
  const runtime = fakeRuntime([
    { success: true, memory: { id: 'noise-1' } },
  ]);
  const adapter = createAgentmemoryAdapter({ runtime });
  await adapter.setup(fixture());
  runtime.calls.length = 0;

  await adapter.ingest({
    id: 'EV-NOISE',
    at: '2026-01-14T00:00:00Z',
    harness: 'codex',
    session_id: 'N1',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: 'a'.repeat(40),
    repo_path: '/tmp/ratchet/project-a',
    trust: 'agent_inference',
    type: 'noise_memory',
    content: 'Unrelated component marker.',
    source: 'noise:2014:1',
  });

  const body = runtime.calls[0][3];
  assert.equal(runtime.calls[0][2], '/agentmemory/remember');
  assert.equal(body.project, 'mr-project-a');
  assert.equal(body.type, 'fact');
});

test('recall uses native project/cwd scope and returns full candidate results unchanged', async () => {
  const payload = {
    format: 'full',
    results: [
      {
        observation: {
          id: 'mem-1',
          facts: ['Use Postgres.'],
          narrative: 'Use Postgres.',
          sessionId: 'memory',
        },
        score: 0.9,
        sessionId: 'memory',
      },
    ],
    tokens_used: 100,
    truncated: false,
  };
  const runtime = fakeRuntime([payload]);
  const adapter = createAgentmemoryAdapter({ runtime });
  await adapter.setup(fixture());
  runtime.calls.length = 0;

  const result = await adapter.recall({
    query: 'SQLite or Postgres',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: 'a'.repeat(40),
    repo_path: '/tmp/ratchet/project-a',
    limit: 10,
  });

  const call = runtime.calls[0];
  assert.equal(call[2], '/agentmemory/search');
  assert.equal(call[3].query, 'SQLite or Postgres');
  assert.equal(call[3].project, 'mr-project-a');
  assert.equal(call[3].cwd, '/tmp/ratchet/project-a');
  assert.equal(call[3].limit, 10);
  assert.equal(call[3].format, 'full');
  assert.equal(call[3].token_budget, 4096);
  assert.equal('branch' in call[3], false);
  assert.deepEqual(result.items, payload.results);
});
