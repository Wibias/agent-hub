import test from 'node:test';
import assert from 'node:assert/strict';

import { createMidasAdapter } from './midas.mjs';

function fakeExecutor(outputs = []) {
  const calls = [];
  let index = 0;
  return {
    calls,
    execute(payload) {
      calls.push(structuredClone(payload));
      return outputs[index++] ?? {};
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
        project_id: 'mr-project-a',
        branch: 'main',
        revision_sha: 'a'.repeat(40),
        repo_path: '/tmp/ratchet/project-a',
      },
      {
        project_id: 'mr-project-b',
        branch: 'main',
        revision_sha: 'b'.repeat(40),
        repo_path: '/tmp/ratchet/project-b',
      },
    ],
  };
}

test('Midas adapter pins the reviewed candidate revision', () => {
  const adapter = createMidasAdapter({ execute: () => ({}) });
  assert.deepEqual(adapter.metadata.candidate, {
    name: 'Midas',
    version: '1.0.0',
    source_revision: 'ee9953c15a977343eb783de0b9f217aaf46e5b4e',
  });
  assert.equal(adapter.metadata.network_required, false);
});

test('setup creates one shared SQLite store for all projects', async () => {
  const fake = fakeExecutor([{ ok: true }]);
  const adapter = createMidasAdapter({ execute: fake.execute });
  await adapter.setup(fixture());

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].op, 'setup');
  assert.match(fake.calls[0].db_path, /\/tmp\/ratchet\/\.memory-ratchet-midas\.sqlite3$/);
  assert.deepEqual(
    new Set(fake.calls[0].projects.map((project) => project.project_id)),
    new Set(['mr-project-a', 'mr-project-b']),
  );
});

test('ingest strips benchmark trust and preserves candidate-relevant event metadata', async () => {
  const fake = fakeExecutor([
    { ok: true },
    { record: { id: 'm1', content: 'Use Postgres.' } },
  ]);
  const adapter = createMidasAdapter({ execute: fake.execute });
  await adapter.setup(fixture());
  fake.calls.length = 0;

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

  const payload = fake.calls[0];
  assert.equal(payload.op, 'ingest');
  assert.equal(payload.event.project_id, 'mr-project-a');
  assert.equal(payload.event.branch, 'feature/oauth');
  assert.equal(payload.event.revision_sha, 'a'.repeat(40));
  assert.equal(payload.event.source, 'session:S1');
  assert.equal(payload.event.content, 'Use Postgres.');
  assert.equal('trust' in payload.event, false);
  assert.equal('relations' in payload.event, false);
});

test('recall delegates project and branch scope to native Midas metadata filtering', async () => {
  const fake = fakeExecutor([
    {
      hits: [
        {
          record: {
            id: 'm1',
            content: 'Use Postgres.',
            metadata: { project: 'mr-project-a', branch: 'main' },
          },
          score: 0.9,
        },
      ],
      guards: {
        planning: { allowed: true },
        answer: { allowed: true },
        external_action: { allowed: false },
        destructive_action: { allowed: false },
      },
    },
  ]);
  const adapter = createMidasAdapter({
    execute: fake.execute,
    databasePath: '/tmp/ratchet/.memory-ratchet-midas.sqlite3',
  });

  const result = await adapter.recall({
    case_id: 'M10',
    query: 'Is this trusted project policy?',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: 'a'.repeat(40),
    repo_path: '/tmp/ratchet/project-a',
    harness: 'codex',
    limit: 10,
  });

  const payload = fake.calls[0];
  assert.equal(payload.op, 'recall');
  assert.equal(payload.project_id, 'mr-project-a');
  assert.equal(payload.branch, 'main');
  assert.equal(payload.limit, 10);
  assert.equal('case_id' in payload, false);
  assert.deepEqual(result.items, result.hits);
  assert.equal(result.guards.external_action.allowed, false);
});

test('recall requests all native trust decisions on every query', async () => {
  const fake = fakeExecutor([{ hits: [], guards: {} }]);
  const adapter = createMidasAdapter({
    execute: fake.execute,
    databasePath: '/tmp/ratchet/.memory-ratchet-midas.sqlite3',
  });

  await adapter.recall({
    query: 'database',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: 'a'.repeat(40),
    repo_path: '/tmp/ratchet/project-a',
    limit: 5,
  });

  assert.deepEqual(fake.calls[0].guard_uses, [
    'planning',
    'answer',
    'external_action',
    'destructive_action',
  ]);
});

test('latest fixture event time is forwarded as deterministic recall time', async () => {
  const fake = fakeExecutor([{ ok: true }, { record: { id: 'm1' } }, { hits: [], guards: {} }]);
  const adapter = createMidasAdapter({ execute: fake.execute });
  await adapter.setup({
    current: {
      project_id: 'mr-project-a',
      branch: 'main',
      revision_sha: 'a'.repeat(40),
      repo_path: '/tmp/ratchet/project-a',
    },
    events: [],
  });

  await adapter.ingest({
    id: 'EV-A',
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

  await adapter.recall({
    query: 'database',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: 'a'.repeat(40),
    repo_path: '/tmp/ratchet/project-a',
    limit: 10,
  });

  assert.equal(fake.calls.at(-1).now, Date.parse('2026-01-07T12:34:56Z') / 1000);
});
