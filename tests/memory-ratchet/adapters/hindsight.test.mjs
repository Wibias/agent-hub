import test from 'node:test';
import assert from 'node:assert/strict';

import { createHindsightAdapter } from './hindsight.mjs';

function fakeRuntime(responses = []) {
  const calls = [];
  let index = 0;
  return {
    calls,
    async start(prepared) {
      calls.push(['start', prepared.case_id ?? null]);
      return { base_url: 'http://127.0.0.1:8888' };
    },
    async request(method, path, body) {
      calls.push(['request', method, path, structuredClone(body)]);
      return responses[index++] ?? {};
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
      {
        at: '2026-01-01T09:00:00Z',
        project_id: 'mr-project-a',
        branch: 'main',
        repo_path: '/tmp/ratchet/project-a',
      },
      {
        at: '2026-01-02T09:00:00Z',
        project_id: 'mr-project-b',
        branch: 'main',
        repo_path: '/tmp/ratchet/project-b',
      },
    ],
  };
}

test('Hindsight adapter pins the 0.10.1 release commit', () => {
  const adapter = createHindsightAdapter({ runtime: fakeRuntime() });
  assert.deepEqual(adapter.metadata.candidate, {
    name: 'Hindsight',
    version: '0.10.1',
    source_revision: 'f8950b0c07d9e34c76493dba802bb309f0ce60fd',
  });
  assert.equal(adapter.metadata.network_required, false);
});

test('setup starts the local server and resets each project bank through native APIs', async () => {
  const runtime = fakeRuntime([
    {},
    {},
    {},
    {},
  ]);
  const adapter = createHindsightAdapter({ runtime });
  await adapter.setup(fixture());

  assert.deepEqual(runtime.calls[0], ['start', 'M03']);

  const requests = runtime.calls.filter((call) => call[0] === 'request');
  assert.deepEqual(requests.map((call) => [call[1], call[2]]), [
    ['DELETE', '/v1/default/banks/mr-project-a'],
    ['PUT', '/v1/default/banks/mr-project-a'],
    ['DELETE', '/v1/default/banks/mr-project-b'],
    ['PUT', '/v1/default/banks/mr-project-b'],
  ]);
  assert.deepEqual(requests[1][3], {});
  assert.deepEqual(requests[3][3], {});
});

test('ingest strips benchmark trust and maps branch to a strict native tag', async () => {
  const runtime = fakeRuntime([
    {},
    {},
    { success: true },
  ]);
  const adapter = createHindsightAdapter({ runtime });
  await adapter.setup({
    case_id: 'M01',
    current: {
      project_id: 'mr-project-a',
      branch: 'main',
      revision_sha: 'a'.repeat(40),
      repo_path: '/tmp/ratchet/project-a',
    },
    events: [],
  });
  runtime.calls.length = 0;

  await adapter.ingest({
    id: 'EV-A',
    at: '2026-01-02T09:00:00Z',
    harness: 'codex',
    session_id: 'S1',
    project_id: 'mr-project-a',
    branch: 'feature/oauth',
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
  assert.equal(path, '/v1/default/banks/mr-project-a/memories');
  assert.equal(body.async, false);
  assert.equal(body.items.length, 1);

  const item = body.items[0];
  assert.equal(item.content, 'Use Postgres.');
  assert.equal(item.timestamp, '2026-01-02T09:00:00Z');
  assert.equal(item.document_id, 'EV-A');
  assert.deepEqual(item.tags, ['branch:feature/oauth']);
  assert.deepEqual(item.metadata, {
    event_id: 'EV-A',
    harness: 'codex',
    session_id: 'S1',
    project_id: 'mr-project-a',
    branch: 'feature/oauth',
    revision_sha: 'a'.repeat(40),
    repo_path: '/tmp/ratchet/project-a',
    event_type: 'decision',
    source: 'session:S1',
  });
  assert.equal('trust' in item.metadata, false);
  assert.equal('relations' in item.metadata, false);
});

test('recall uses bank isolation plus strict branch tags and deterministic fixture time', async () => {
  const payload = {
    results: [
      {
        id: 'm1',
        text: 'Use Postgres.',
        tags: ['branch:main'],
        metadata: { revision_sha: 'a'.repeat(40) },
      },
    ],
  };
  const runtime = fakeRuntime([{}, payload]);
  const adapter = createHindsightAdapter({ runtime });
  await adapter.reset();
  await adapter.ingest({
    id: 'EV-TIME',
    at: '2026-01-07T12:34:56Z',
    harness: 'codex',
    session_id: 'S1',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: 'a'.repeat(40),
    repo_path: '/tmp/ratchet/project-a',
    type: 'decision',
    content: 'Use Postgres.',
    source: 'session:S1',
  });

  runtime.calls.length = 0;
  const result = await adapter.recall({
    case_id: 'M04',
    query: 'What auth mechanism is active?',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: 'a'.repeat(40),
    repo_path: '/tmp/ratchet/project-a',
    limit: 10,
  });

  const [, method, path, body] = runtime.calls[0];
  assert.equal(method, 'POST');
  assert.equal(path, '/v1/default/banks/mr-project-a/memories/recall');
  assert.equal(body.query, 'What auth mechanism is active?');
  assert.deepEqual(body.tags, ['branch:main']);
  assert.equal(body.tags_match, 'all_strict');
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.budget, 'mid');
  assert.equal(body.query_timestamp, '2026-01-07T12:34:56Z');
  assert.equal('case_id' in body, false);
  assert.deepEqual(result.items, payload.results);
});

test('teardown delegates lifecycle without rewriting recalled output', async () => {
  const runtime = fakeRuntime();
  const adapter = createHindsightAdapter({ runtime });
  await adapter.teardown();
  assert.deepEqual(runtime.calls, [['stop']]);
});
