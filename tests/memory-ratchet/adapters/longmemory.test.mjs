import test from 'node:test';
import assert from 'node:assert/strict';

import { createLongMemoryAdapter } from './longmemory.mjs';

function fakeExecutor(outputs = []) {
  const calls = [];
  let index = 0;
  return {
    calls,
    execute(args) {
      calls.push([...args]);
      return outputs[index++] ?? '{}';
    },
  };
}

function fixture() {
  return {
    case_id: 'M03',
    current: { project_id: 'mr-project-b', branch: 'main', repo_path: '/tmp/ratchet/project-b' },
    events: [
      { project_id: 'mr-project-a', repo_path: '/tmp/ratchet/project-a' },
      { project_id: 'mr-project-b', repo_path: '/tmp/ratchet/project-b' },
    ],
  };
}

test('LongMemory adapter pins the reviewed candidate revision', () => {
  const adapter = createLongMemoryAdapter({ execute: () => '{}' });
  assert.deepEqual(adapter.metadata.candidate, {
    name: 'LongMemory',
    version: '1.0.0',
    source_revision: '9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5',
  });
  assert.equal(adapter.metadata.network_required, false);
});

test('setup uses one shared database and distinct native project identities', async () => {
  const fake = fakeExecutor(['{}', '{}']);
  const adapter = createLongMemoryAdapter({ execute: fake.execute });
  await adapter.setup(fixture());

  assert.equal(fake.calls.length, 2);
  const dbA = fake.calls[0][fake.calls[0].indexOf('--db') + 1];
  const dbB = fake.calls[1][fake.calls[1].indexOf('--db') + 1];
  assert.equal(dbA, dbB);
  assert.match(dbA, /\/tmp\/ratchet\/\.memory-ratchet-longmemory\.db$/);
  assert.deepEqual(
    new Set(fake.calls.map((call) => call[call.indexOf('--project') + 1])),
    new Set(['mr-project-a', 'mr-project-b']),
  );
});

test('ingest preserves event source and branch metadata without exposing benchmark trust', async () => {
  const fake = fakeExecutor(['{}']);
  const adapter = createLongMemoryAdapter({ execute: fake.execute });
  await adapter.setup({ current: { project_id: 'mr-project-a', repo_path: '/tmp/ratchet/project-a' }, events: [] });
  fake.calls.length = 0;

  await adapter.ingest({
    id: 'EV-A',
    at: '2026-01-02T09:00:00Z',
    harness: 'codex',
    session_id: 'A-S1',
    project_id: 'mr-project-a',
    branch: 'feature/oauth',
    revision_sha: 'a'.repeat(40),
    repo_path: '/tmp/ratchet/project-a',
    trust: 'external_untrusted',
    type: 'decision',
    content: 'Use Postgres.',
    source: 'session:A-S1',
  });

  const args = fake.calls[0];
  assert.equal(args[0], 'ingest');
  assert.equal(args[args.indexOf('--source') + 1], 'session:A-S1');
  const metadata = JSON.parse(args[args.indexOf('--metadata-json') + 1]);
  assert.equal(metadata.branch, 'feature/oauth');
  assert.equal(metadata.revision_sha, 'a'.repeat(40));
  assert.ok(!JSON.stringify(args).includes('external_untrusted'));
});

test('project isolation is delegated to LongMemory, not separate adapter databases', async () => {
  const fake = fakeExecutor(['{}', '{}', '{}']);
  const adapter = createLongMemoryAdapter({ execute: fake.execute });
  await adapter.setup(fixture());
  fake.calls.length = 0;

  await adapter.recall({
    query: 'MySQL Postgres SQLite',
    project_id: 'mr-project-b',
    repo_path: '/tmp/ratchet/project-b',
    limit: 10,
  });

  const args = fake.calls[0];
  assert.equal(args[0], 'recall');
  assert.equal(args[args.indexOf('--project') + 1], 'mr-project-b');
  assert.ok(args.includes('--mode'));
  assert.equal(args[args.indexOf('--mode') + 1], 'strict');
});

test('recall returns native hits and items without adapter reranking', async () => {
  const payload = {
    ok: true,
    mode: 'strict',
    hits: [{ id: 'n1', text: 'Use Postgres', score: 0.91, citation: 'session:A-S1' }],
    items: [{ node: { id: 'n1', content: { raw: 'Use Postgres' } }, score: 0.91 }],
  };
  const fake = fakeExecutor([JSON.stringify(payload)]);
  const adapter = createLongMemoryAdapter({
    execute: fake.execute,
    databasePath: '/tmp/ratchet/.memory-ratchet-longmemory.db',
  });

  const result = await adapter.recall({
    query: 'SQLite Postgres',
    project_id: 'mr-project-a',
    repo_path: '/tmp/ratchet/project-a',
    limit: 10,
  });

  assert.deepEqual(result.items, payload.items);
  assert.deepEqual(result.hits, payload.hits);
  const args = fake.calls[0];
  assert.equal(args[args.indexOf('--k') + 1], '10');
  assert.equal(args[args.indexOf('--user') + 1], 'memory-ratchet');
});
