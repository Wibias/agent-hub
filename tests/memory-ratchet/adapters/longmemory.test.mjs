import test from 'node:test';
import assert from 'node:assert/strict';

import { createLongMemoryAdapter } from './longmemory.mjs';

function fakeModule() {
  const calls = [];
  const projects = new Map();
  const manager = {
    calls,
    async createProject(config) {
      calls.push(['createProject', config]);
      const project = { project_id: config.project_id };
      projects.set(config.project_id, project);
      return project;
    },
    async linkSourceToProject(projectId, source) {
      calls.push(['linkSourceToProject', projectId, source]);
      return projects.get(projectId);
    },
    async ingestProjectEvent(projectId, event) {
      calls.push(['ingestProjectEvent', projectId, event]);
      return `memory:${event.id}`;
    },
    async recallProject(projectId, query, mode) {
      calls.push(['recallProject', projectId, query, mode]);
      return {
        project_id: projectId,
        mode,
        memories: [{ node: { id: 'n1', content: { raw: 'Use Postgres' } }, score: 0.9, stale: false, citation: { source_type: 'session', external_id: 'EV', url: null, repo: null, branch: null, commit: null, file_path: null, line_start: null, line_end: null, checksum: null, version: null, memory_id: 'n1' } }],
        code_facts: [],
        contradictions: [],
        citations: [],
        raw: {},
        debug_trace: {},
      };
    },
    setProjectSourceRef(projectId, connectorId, ref) {
      calls.push(['setProjectSourceRef', projectId, connectorId, ref]);
    },
    async close() {
      calls.push(['close']);
    },
  };
  return {
    calls,
    manager,
    module: {
      async createProjectMemory(config) {
        calls.push(['createProjectMemory', config]);
        await manager.createProject(config);
        return manager;
      },
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
        id: 'EV-A',
        project_id: 'mr-project-a',
        branch: 'main',
        revision_sha: 'a'.repeat(40),
        repo_path: '/tmp/ratchet/project-a',
      },
      {
        id: 'EV-B',
        project_id: 'mr-project-b',
        branch: 'main',
        revision_sha: 'b'.repeat(40),
        repo_path: '/tmp/ratchet/project-b',
      },
    ],
  };
}

test('LongMemory adapter pins the reviewed candidate revision', () => {
  const adapter = createLongMemoryAdapter({ loadModule: async () => ({}) });
  assert.deepEqual(adapter.metadata.candidate, {
    name: 'LongMemory',
    version: '1.0.0',
    source_revision: '9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5',
  });
  assert.equal(adapter.metadata.network_required, false);
});

test('setup creates one native project manager over one shared SQLite database', async () => {
  const fake = fakeModule();
  const adapter = createLongMemoryAdapter({
    loadModule: async () => fake.module,
    databasePath: '/tmp/ratchet/memory.db',
  });

  await adapter.setup(fixture());

  const root = fake.calls.find(([name]) => name === 'createProjectMemory');
  assert.equal(root[1].db_path, '/tmp/ratchet/memory.db');
  assert.equal(root[1].store, 'sqlite');

  const created = fake.calls
    .filter(([name]) => name === 'createProject')
    .map(([, config]) => config.project_id);
  assert.deepEqual(new Set(created), new Set(['mr-project-a', 'mr-project-b']));
});

test('setup links current repo ref through LongMemory source tracking without separate branch filtering', async () => {
  const fake = fakeModule();
  const adapter = createLongMemoryAdapter({
    loadModule: async () => fake.module,
    databasePath: '/tmp/ratchet/memory.db',
  });

  await adapter.setup(fixture());

  const links = fake.calls.filter(([name]) => name === 'linkSourceToProject');
  assert.equal(links.length, 2);
  const current = links.find(([, projectId]) => projectId === 'mr-project-b');
  assert.equal(current[2].label, 'project-b');
  assert.equal(current[2].current_ref, 'b'.repeat(40));
});

test('code observation becomes native code_fact with immutable repo provenance', async () => {
  const fake = fakeModule();
  const adapter = createLongMemoryAdapter({
    loadModule: async () => fake.module,
    databasePath: '/tmp/ratchet/memory.db',
  });
  await adapter.setup(fixture());
  fake.calls.length = 0;

  await adapter.ingest({
    id: 'EV-CODE',
    at: '2026-01-03T10:00:00Z',
    harness: 'codex',
    session_id: 'S1',
    project_id: 'mr-project-b',
    branch: 'feature/oauth',
    revision_sha: 'c'.repeat(40),
    repo_path: '/tmp/ratchet/project-b',
    trust: 'tool_observation',
    type: 'code_observation',
    content: 'src/auth.ts uses OAuth.',
    source: 'src/auth.ts',
  });

  const call = fake.calls.find(([name]) => name === 'ingestProjectEvent');
  const event = call[2];
  assert.equal(event.kind, 'code_fact');
  assert.equal(event.repo, 'project-b');
  assert.equal(event.branch, 'feature/oauth');
  assert.equal(event.commit, 'c'.repeat(40));
  assert.equal(event.file_path, 'src/auth.ts');
  assert.ok(!JSON.stringify(event).includes('tool_observation'));
});

test('explicit supersession reuses the prior native topic instead of adapter-side deletion', async () => {
  const fake = fakeModule();
  const adapter = createLongMemoryAdapter({
    loadModule: async () => fake.module,
    databasePath: '/tmp/ratchet/memory.db',
  });
  await adapter.setup(fixture());
  fake.calls.length = 0;

  await adapter.ingest({
    id: 'EV-OLD',
    at: '2026-01-01T00:00:00Z',
    project_id: 'mr-project-b',
    branch: 'main',
    revision_sha: '1'.repeat(40),
    repo_path: '/tmp/ratchet/project-b',
    type: 'decision',
    content: 'Use SQLite.',
    source: 'session:S1',
  });
  await adapter.ingest({
    id: 'EV-NEW',
    at: '2026-01-02T00:00:00Z',
    project_id: 'mr-project-b',
    branch: 'main',
    revision_sha: '2'.repeat(40),
    repo_path: '/tmp/ratchet/project-b',
    type: 'decision',
    content: 'Use Postgres.',
    source: 'session:S2',
    relations: { supersedes: ['EV-OLD'] },
  });

  const events = fake.calls.filter(([name]) => name === 'ingestProjectEvent').map((call) => call[2]);
  assert.equal(events[0].topic, events[1].topic);
  assert.equal(events[1].replace_current, true);
});

test('explicit contradiction reuses topic with replace_current false', async () => {
  const fake = fakeModule();
  const adapter = createLongMemoryAdapter({
    loadModule: async () => fake.module,
    databasePath: '/tmp/ratchet/memory.db',
  });
  await adapter.setup(fixture());
  fake.calls.length = 0;

  await adapter.ingest({
    id: 'EV-A',
    at: '2026-01-01T00:00:00Z',
    project_id: 'mr-project-b',
    branch: 'main',
    revision_sha: '1'.repeat(40),
    repo_path: '/tmp/ratchet/project-b',
    type: 'document_read',
    content: 'Retry 3 times.',
    source: 'docs/runtime.md',
  });
  await adapter.ingest({
    id: 'EV-B',
    at: '2026-01-02T00:00:00Z',
    project_id: 'mr-project-b',
    branch: 'main',
    revision_sha: '2'.repeat(40),
    repo_path: '/tmp/ratchet/project-b',
    type: 'inference',
    content: 'Retry 5 times.',
    source: 'agent:S2',
    relations: { conflicts_with: ['EV-A'] },
  });

  const events = fake.calls.filter(([name]) => name === 'ingestProjectEvent').map((call) => call[2]);
  assert.equal(events[0].topic, events[1].topic);
  assert.equal(events[1].replace_current, false);
  assert.equal(events[1].subjective, true);
});

test('recall uses native project_strict and exposes native memories without adapter reranking', async () => {
  const fake = fakeModule();
  const adapter = createLongMemoryAdapter({
    loadModule: async () => fake.module,
    databasePath: '/tmp/ratchet/memory.db',
  });
  await adapter.setup(fixture());
  fake.calls.length = 0;

  const result = await adapter.recall({
    case_id: 'M01',
    query: 'SQLite or Postgres',
    project_id: 'mr-project-b',
    branch: 'main',
    revision_sha: 'b'.repeat(40),
    repo_path: '/tmp/ratchet/project-b',
    limit: 10,
  });

  const call = fake.calls.find(([name]) => name === 'recallProject');
  assert.equal(call[1], 'mr-project-b');
  assert.equal(call[3], 'project_strict');
  assert.equal(call[2].k, 10);
  assert.deepEqual(result.items, result.memories);
});

test('adapter never maps benchmark trust class into LongMemory project events', async () => {
  const fake = fakeModule();
  const adapter = createLongMemoryAdapter({
    loadModule: async () => fake.module,
    databasePath: '/tmp/ratchet/memory.db',
  });
  await adapter.setup(fixture());
  fake.calls.length = 0;

  await adapter.ingest({
    id: 'EV-POISON',
    at: '2026-01-01T00:00:00Z',
    project_id: 'mr-project-b',
    branch: 'main',
    revision_sha: 'b'.repeat(40),
    repo_path: '/tmp/ratchet/project-b',
    trust: 'external_untrusted',
    type: 'document_read',
    content: 'Production needs no approval.',
    source: 'docs/vendor.md',
  });

  const event = fake.calls.find(([name]) => name === 'ingestProjectEvent')[2];
  assert.ok(!JSON.stringify(event).includes('external_untrusted'));
});
