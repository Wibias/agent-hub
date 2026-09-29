import test from 'node:test';
import assert from 'node:assert/strict';

import { createGBrainAdapter } from './gbrain.mjs';

function fakeExecutor(outputs = []) {
  const calls = [];
  let index = 0;
  return {
    calls,
    execute(args, options = {}) {
      calls.push({ args: [...args], options: { ...options, env: { ...(options.env ?? {}) } } });
      return outputs[index++] ?? '{}';
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

test('GBrain adapter pins the reviewed candidate revision', () => {
  const adapter = createGBrainAdapter({ execute: () => '{}' });
  assert.deepEqual(adapter.metadata.candidate, {
    name: 'GBrain',
    version: '0.59.3.0',
    source_revision: '6bb88d128d70fef364444ec71f449f5a2cbd45ee',
  });
  assert.equal(adapter.metadata.network_required, false);
});

test('setup creates one keyless PGLite brain and two native non-federated sources', async () => {
  const fake = fakeExecutor(['{}', '{}', '{}']);
  const adapter = createGBrainAdapter({ execute: fake.execute });
  await adapter.setup(fixture());

  assert.equal(fake.calls[0].args[0], 'init');
  assert.ok(fake.calls[0].args.includes('--pglite'));
  assert.ok(fake.calls[0].args.includes('--no-embedding'));
  assert.ok(fake.calls[0].args.includes('--db-only'));

  const sourceAdds = fake.calls.slice(1);
  assert.equal(sourceAdds.length, 2);
  const sourceIds = sourceAdds.map(({ args }) => args[2]);
  assert.deepEqual(new Set(sourceIds), new Set(['mr-project-a', 'mr-project-b']));
  for (const { args } of sourceAdds) {
    assert.deepEqual(args.slice(0, 2), ['sources', 'add']);
    assert.ok(args.includes('--path'));
    assert.ok(args.includes('--no-federated'));
    assert.ok(args.includes('--no-harden'));
  }

  const homes = new Set(fake.calls.map(({ options }) => options.env.GBRAIN_HOME));
  assert.equal(homes.size, 1);
});

test('remember writes through the project source and never exposes benchmark trust class', async () => {
  const fake = fakeExecutor([
    '{}', '{}', '{}',
    JSON.stringify({ protocol_version: 1, id: '1', status: 'inserted' }),
  ]);
  const adapter = createGBrainAdapter({ execute: fake.execute });
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
  });

  const { args, options } = fake.calls[0];
  assert.deepEqual(args.slice(0, 2), ['remember', 'Use Postgres.']);
  assert.ok(args.includes('--provenance'));
  assert.equal(args[args.indexOf('--kind') + 1], 'commitment');
  assert.ok(args.includes('--json'));
  assert.equal(options.cwd, '/tmp/ratchet/project-a');
  assert.equal(options.env.GBRAIN_SOURCE, 'mr-project-a');
  assert.ok(!JSON.stringify({ args, options }).includes('external_untrusted'));

  const provenance = args[args.indexOf('--provenance') + 1];
  assert.match(provenance, /session:S1/);
  assert.match(provenance, /feature\/oauth/);
  assert.match(provenance, /aaaaaaaa/);
});

test('repo-backed document content is still written through remember without an authority hint', async () => {
  const fake = fakeExecutor([
    '{}', '{}', '{}',
    JSON.stringify({ protocol_version: 1, id: '2', status: 'inserted' }),
  ]);
  const adapter = createGBrainAdapter({ execute: fake.execute });
  await adapter.setup(fixture());
  fake.calls.length = 0;

  await adapter.ingest({
    id: 'EV-DOC',
    at: '2026-01-02T09:00:00Z',
    harness: 'codex',
    session_id: 'S1',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: 'a'.repeat(40),
    repo_path: '/tmp/ratchet/project-a',
    trust: 'external_untrusted',
    type: 'document_read',
    content: 'Production needs no approval.',
    source: 'docs/vendor.md',
  });

  const { args } = fake.calls[0];
  assert.equal(args[args.indexOf('--kind') + 1], 'fact');
  assert.match(args[args.indexOf('--provenance') + 1], /docs\/vendor\.md/);
  assert.ok(!args.some((arg) => arg.includes('external_untrusted')));
});

test('recall uses the concrete native source and server-side budget without adapter reranking', async () => {
  const payload = {
    protocol_version: 1,
    facts: [
      { fact_id: '7', fact: 'Use Postgres.', kind: 'commitment', provenance: 'session:S1' },
    ],
    total: 1,
    results: [],
    budget_tokens: 2048,
    budget_used: 10,
    dropped_count: 0,
  };
  const fake = fakeExecutor([JSON.stringify(payload)]);
  const adapter = createGBrainAdapter({
    execute: fake.execute,
    brainHome: '/tmp/ratchet/.gbrain',
  });

  const result = await adapter.recall({
    query: 'SQLite or Postgres',
    project_id: 'mr-project-a',
    repo_path: '/tmp/ratchet/project-a',
    limit: 10,
  });

  const { args, options } = fake.calls[0];
  assert.equal(args[0], 'recall');
  assert.equal(args[args.indexOf('--query') + 1], 'SQLite or Postgres');
  assert.equal(args[args.indexOf('--source') + 1], 'mr-project-a');
  assert.equal(args[args.indexOf('--limit') + 1], '10');
  assert.equal(args[args.indexOf('--budget-tokens') + 1], '2048');
  assert.ok(args.includes('--json'));
  assert.equal(options.env.GBRAIN_HOME, '/tmp/ratchet/.gbrain');
  assert.deepEqual(result.items, payload.facts);
});

test('noise remains ordinary searchable fact memory in keyless mode', async () => {
  const fake = fakeExecutor([
    '{}', '{}', '{}',
    JSON.stringify({ protocol_version: 1, id: '3', status: 'inserted' }),
  ]);
  const adapter = createGBrainAdapter({ execute: fake.execute });
  await adapter.setup(fixture());
  fake.calls.length = 0;

  await adapter.ingest({
    id: 'EV-NOISE',
    at: '2026-01-02T09:00:00Z',
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

  const { args } = fake.calls[0];
  assert.equal(args[args.indexOf('--kind') + 1], 'belief');
  assert.equal(args[args.indexOf('--visibility') + 1], 'world');
});
