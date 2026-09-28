import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemspecAdapter, formatExecFailure } from './memspec.mjs';

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

function preparedFixture() {
  return {
    case_id: 'M01',
    current: {
      project_id: 'mr-project-a',
      branch: 'main',
      revision_sha: 'a'.repeat(40),
      repo_path: '/tmp/project-a',
    },
    events: [
      {
        id: 'EV-A',
        project_id: 'mr-project-a',
        branch: 'main',
        revision_sha: '1'.repeat(40),
        repo_path: '/tmp/project-a',
      },
      {
        id: 'EV-B',
        project_id: 'mr-project-b',
        branch: 'main',
        revision_sha: '2'.repeat(40),
        repo_path: '/tmp/project-b',
      },
    ],
  };
}

test('memspec adapter metadata is pinned to the reviewed candidate revision', () => {
  const adapter = createMemspecAdapter({ execute: () => '' });
  assert.deepEqual(adapter.metadata.candidate, {
    name: 'memspec',
    version: '0.11.0',
    source_revision: '7c0a47f36d75585db0701b9828592433a0fa1c7b',
  });
  assert.equal(adapter.metadata.network_required, false);
});

test('setup initialises every fixture repository once with non-interactive side effects disabled', async () => {
  const fake = fakeExecutor();
  const adapter = createMemspecAdapter({ execute: fake.execute });
  await adapter.setup(preparedFixture());

  assert.equal(fake.calls.length, 2);
  for (const call of fake.calls) {
    assert.equal(call[0], 'init');
    assert.ok(call.includes('--no-interactive'));
    assert.ok(call.includes('--skip-import'));
    assert.ok(call.includes('--skip-patch'));
    assert.ok(call.includes('--no-install-hooks'));
  }
  assert.ok(fake.calls.some((call) => call.includes('/tmp/project-a')));
  assert.ok(fake.calls.some((call) => call.includes('/tmp/project-b')));
});

test('ingest never exposes the benchmark trust class to memspec', async () => {
  const fake = fakeExecutor(['Created decision memory ms_01ABCDEFGHIJKLMNOPQRSTUVWX at x']);
  const adapter = createMemspecAdapter({ execute: fake.execute });

  await adapter.ingest({
    id: 'EV-TRUST',
    at: '2026-01-01T00:00:00Z',
    harness: 'codex',
    session_id: 'S1',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: '1'.repeat(40),
    repo_path: '/tmp/project-a',
    trust: 'external_untrusted',
    type: 'decision',
    content: 'Use Postgres.',
    source: 'session:S1',
  });

  const args = fake.calls[0];
  assert.equal(args[0], 'remember');
  assert.ok(args.includes('--source'));
  assert.ok(args.includes('session:S1'));
  assert.ok(!args.some((arg) => arg.includes('external_untrusted')));
});

test('explicit supersedes relation uses memspec lifecycle instead of writing a parallel active claim', async () => {
  const oldId = 'ms_01ABCDEFGHIJKLMNOPQRSTUVWX';
  const newId = 'ms_01ZYXWVUTSRQPONMLKJIHGFEDC';
  const fake = fakeExecutor([
    `Created decision memory ${oldId} at x`,
    `Superseded ${oldId} → ${newId}\nReason: changed`,
  ]);
  const adapter = createMemspecAdapter({ execute: fake.execute });

  await adapter.ingest({
    id: 'EV-OLD',
    at: '2026-01-01T00:00:00Z',
    harness: 'codex',
    session_id: 'S1',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: '1'.repeat(40),
    repo_path: '/tmp/project-a',
    trust: 'user_direct',
    type: 'decision',
    content: 'Use SQLite.',
    source: 'session:S1',
  });
  await adapter.ingest({
    id: 'EV-NEW',
    at: '2026-01-02T00:00:00Z',
    harness: 'codex',
    session_id: 'S2',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: '2'.repeat(40),
    repo_path: '/tmp/project-a',
    trust: 'user_direct',
    type: 'decision',
    content: 'Use Postgres.',
    source: 'session:S2',
    relations: { supersedes: ['EV-OLD'] },
  });

  assert.equal(fake.calls[1][0], 'supersede');
  assert.equal(fake.calls[1][1], oldId);
  assert.ok(fake.calls[1].includes('--body'));
  assert.ok(fake.calls[1].includes('Use Postgres.'));
});

test('repository-backed events are anchored without consulting the benchmark trust class', async () => {
  const fake = fakeExecutor(['Created fact memory ms_01ABCDEFGHIJKLMNOPQRSTUVWX at x']);
  const adapter = createMemspecAdapter({ execute: fake.execute });

  await adapter.ingest({
    id: 'EV-DOC',
    at: '2026-01-01T00:00:00Z',
    harness: 'codex',
    session_id: 'S1',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: '1'.repeat(40),
    repo_path: '/tmp/project-a',
    trust: 'external_untrusted',
    type: 'document_read',
    content: 'Vendor deployment guidance.',
    source: 'docs/vendor-deploy-guide.md',
  });

  const args = fake.calls[0];
  assert.ok(args.includes('--anchor'));
  assert.ok(args.includes('docs/vendor-deploy-guide.md'));
});

test('noise memories remain searchable claims so M14 cannot be bypassed through observation filtering', async () => {
  const fake = fakeExecutor(['Created fact memory ms_01ABCDEFGHIJKLMNOPQRSTUVWX at x']);
  const adapter = createMemspecAdapter({ execute: fake.execute });

  await adapter.ingest({
    id: 'EV-NOISE-1',
    at: '2026-01-14T00:00:00Z',
    harness: 'codex',
    session_id: 'N1',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: '1'.repeat(40),
    repo_path: '/tmp/project-a',
    trust: 'agent_inference',
    type: 'noise_memory',
    content: 'Unrelated component marker.',
    source: 'noise:2014:1',
  });

  assert.deepEqual(fake.calls[0].slice(0, 2), ['remember', 'fact']);
});

test('recall uses bounded JSON search and returns the structured candidate payload unchanged', async () => {
  const payload = {
    query: 'database',
    count: 1,
    results: [{ id: 'ms_01ABCDEFGHIJKLMNOPQRSTUVWX', title: 'Use Postgres', body: 'Use Postgres.' }],
    coverage: 'ok',
    coverage_note: 'covered',
    coverage_witness: 'assertion',
  };
  const fake = fakeExecutor([JSON.stringify(payload)]);
  const adapter = createMemspecAdapter({ execute: fake.execute });

  const result = await adapter.recall({
    case_id: 'M14',
    query: 'database',
    project_id: 'mr-project-a',
    branch: 'main',
    revision_sha: 'a'.repeat(40),
    repo_path: '/tmp/project-a',
    harness: 'codex',
    limit: 10,
  });

  const args = fake.calls[0];
  assert.deepEqual(args.slice(0, 2), ['search', 'database']);
  assert.ok(args.includes('--json'));
  assert.ok(args.includes('--full'));
  assert.equal(args[args.indexOf('--limit') + 1], '10');
  assert.equal(result.coverage, 'ok');
  assert.deepEqual(result.items, payload.results);
});


test('formats candidate CLI stderr and stdout for diagnosable blocked runs', () => {
  const error = new Error('Command failed: memspec remember');
  error.stderr = 'actual memspec validation error\n';
  error.stdout = 'partial output\n';
  error.status = 1;

  const message = formatExecFailure(error);
  assert.match(message, /actual memspec validation error/);
  assert.match(message, /partial output/);
  assert.match(message, /exit 1/);
});
