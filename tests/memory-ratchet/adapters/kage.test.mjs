import test from 'node:test';
import assert from 'node:assert/strict';

import { createKageAdapter, parsePacketId } from './kage.mjs';

function fakeExecutor(outputs = []) {
  const calls = [];
  let index = 0;
  return {
    calls,
    execute(args) {
      calls.push([...args]);
      return outputs[index++] ?? '';
    },
  };
}

function fixture() {
  return {
    case_id: 'M01',
    current: {
      project_id: 'mr-project-a',
      branch: 'main',
      revision_sha: 'a'.repeat(40),
      repo_path: '/tmp/project-a',
    },
    events: [
      { project_id: 'mr-project-a', repo_path: '/tmp/project-a' },
      { project_id: 'mr-project-b', repo_path: '/tmp/project-b' },
    ],
  };
}

test('Kage adapter pins the reviewed source revision and target runtime metadata', () => {
  const adapter = createKageAdapter({ execute: () => '' });
  assert.deepEqual(adapter.metadata.candidate, {
    name: 'Kage',
    version: '5.0.0',
    source_revision: 'e7cc087666fd3d01a5727f8a67e7b9e745fca904',
  });
  assert.equal(adapter.metadata.network_required, false);
});

test('setup initialises every fixture repo through memory-only init', async () => {
  const fake = fakeExecutor();
  const adapter = createKageAdapter({ execute: fake.execute });
  await adapter.setup(fixture());

  assert.equal(fake.calls.length, 2);
  assert.deepEqual(fake.calls[0], ['init', '--project', '/tmp/project-a']);
  assert.deepEqual(fake.calls[1], ['init', '--project', '/tmp/project-b']);
});

test('learn maps decisions to Kage decision packets without passing benchmark trust labels', async () => {
  const packet = 'repo:test:decision:use-postgres-123';
  const fake = fakeExecutor([
    `Captured session learning: /tmp/project-a/.agent_memory/packets/decision-use-postgres.md\npacket_id=${packet}`,
  ]);
  const adapter = createKageAdapter({ execute: fake.execute, packetIdFromOutput: () => packet });

  await adapter.ingest({
    id: 'EV-DECISION',
    project_id: 'mr-project-a',
    repo_path: '/tmp/project-a',
    trust: 'external_untrusted',
    type: 'decision',
    content: 'Use Postgres.',
    source: 'session:S1',
  });

  const args = fake.calls[0];
  assert.deepEqual(args.slice(0, 2), ['learn', '--project']);
  assert.equal(args[2], '/tmp/project-a');
  assert.equal(args[args.indexOf('--type') + 1], 'decision');
  assert.equal(args[args.indexOf('--learning') + 1], 'Use Postgres.');
  assert.ok(!args.some((arg) => arg.includes('external_untrusted')));
});

test('repository-backed learning is grounded with --paths but trust class remains hidden', async () => {
  const packet = 'repo:test:reference:vendor-guide-123';
  const fake = fakeExecutor(['captured']);
  const adapter = createKageAdapter({ execute: fake.execute, packetIdFromOutput: () => packet });

  await adapter.ingest({
    id: 'EV-DOC',
    project_id: 'mr-project-a',
    repo_path: '/tmp/project-a',
    trust: 'external_untrusted',
    type: 'document_read',
    content: 'Vendor deployment guidance.',
    source: 'docs/vendor-deploy-guide.md',
  });

  const args = fake.calls[0];
  assert.equal(args[args.indexOf('--paths') + 1], 'docs/vendor-deploy-guide.md');
  assert.ok(!args.some((arg) => arg.includes('external_untrusted')));
});

test('supersession first creates replacement then links old packet to replacement', async () => {
  const oldId = 'repo:test:decision:sqlite-1';
  const newId = 'repo:test:decision:postgres-2';
  const fake = fakeExecutor(['old', 'new', JSON.stringify({ ok: true })]);
  const ids = [oldId, newId];
  const adapter = createKageAdapter({
    execute: fake.execute,
    packetIdFromOutput: () => ids.shift(),
  });

  await adapter.ingest({
    id: 'EV-OLD',
    project_id: 'mr-project-a',
    repo_path: '/tmp/project-a',
    type: 'decision',
    content: 'Use SQLite.',
    source: 'session:S1',
  });
  await adapter.ingest({
    id: 'EV-NEW',
    project_id: 'mr-project-a',
    repo_path: '/tmp/project-a',
    type: 'decision',
    content: 'Use Postgres.',
    source: 'session:S2',
    relations: { supersedes: ['EV-OLD'] },
  });

  assert.deepEqual(fake.calls[1].slice(0, 3), ['learn', '--project', '/tmp/project-a']);
  assert.deepEqual(fake.calls[2].slice(0, 2), ['supersede', '--project']);
  assert.equal(fake.calls[2][fake.calls[2].indexOf('--packet') + 1], oldId);
  assert.equal(fake.calls[2][fake.calls[2].indexOf('--replacement') + 1], newId);
  assert.ok(fake.calls[2].includes('--json'));
});

test('M14 noise remains normal searchable repo memory', async () => {
  const fake = fakeExecutor(['captured']);
  const adapter = createKageAdapter({
    execute: fake.execute,
    packetIdFromOutput: () => 'repo:test:reference:noise-1',
  });

  await adapter.ingest({
    id: 'EV-NOISE',
    project_id: 'mr-project-a',
    repo_path: '/tmp/project-a',
    trust: 'agent_inference',
    type: 'noise_memory',
    content: 'Unrelated component marker.',
    source: 'noise:2014:1',
  });

  const args = fake.calls[0];
  assert.equal(args[args.indexOf('--type') + 1], 'reference');
  assert.ok(!args.includes('--personal'));
});

test('recall uses candidate JSON output and benchmark limit without extra reranking', async () => {
  const payload = {
    query: 'Postgres SQLite',
    memories: [
      { id: 'repo:test:decision:postgres', title: 'Use Postgres', score: 12.3 },
    ],
    stale_withheld: 1,
    context_block: 'Use Postgres',
  };
  const fake = fakeExecutor([JSON.stringify(payload)]);
  const adapter = createKageAdapter({ execute: fake.execute });

  const result = await adapter.recall({
    query: 'Postgres SQLite',
    repo_path: '/tmp/project-a',
    limit: 10,
  });

  const args = fake.calls[0];
  assert.deepEqual(args.slice(0, 2), ['recall', 'Postgres SQLite']);
  assert.equal(args[args.indexOf('--project') + 1], '/tmp/project-a');
  assert.equal(args[args.indexOf('--limit') + 1], '10');
  assert.ok(args.includes('--json'));
  assert.deepEqual(result.items, payload.memories);
  assert.equal(result.stale_withheld, 1);
});

test('parsePacketId reads the canonical x-kage-id from a packet document', () => {
  assert.equal(
    parsePacketId('---\nx-kage-id: "repo:test:decision:hello-123"\ntitle: "Hello"\n---\n'),
    'repo:test:decision:hello-123',
  );
});
