import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  RunObservationBuffer,
} from '../../memory-engine/run-observation-buffer.mjs';

async function createDb() {
  const root = await mkdtemp(join(tmpdir(), 'run-observation-buffer-'));
  const dbPath = join(root, 'memory.sqlite3');
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec('CREATE TABLE project_registry (project_id TEXT PRIMARY KEY) STRICT;');
  db.prepare('INSERT INTO project_registry VALUES (?)').run('project-a');
  db.close();
  return dbPath;
}

function obs(overrides = {}) {
  return {
    id: 'obs-1',
    projectId: 'project-a',
    branch: 'main',
    sessionId: 'S1',
    turnId: 'T1',
    sourceKind: 'tool',
    sourceRef: 'tool:Bash:tool-1',
    observedAt: '2026-10-11T12:00:00.000Z',
    authorityClass: 'tool_observation',
    sensitivity: 'normal',
    contentRedacted: 'Postgres accepted concurrent writes.',
    metadata: { event_type: 'post_tool_use', tool_name: 'Bash' },
    ...overrides,
  };
}

test('run observation buffer stores scoped operational evidence without canonical claims', async () => {
  const dbPath = await createDb();
  const store = new RunObservationBuffer({ dbPath });
  try {
    const stored = store.record(obs());
    assert.equal(stored.id, 'obs-1');
    assert.equal(stored.authority_class, 'tool_observation');
    assert.deepEqual(stored.metadata, { event_type: 'post_tool_use', tool_name: 'Bash' });
    assert.deepEqual(
      store.listTurn({ projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1' })
        .map((row) => row.id),
      ['obs-1'],
    );

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const claims = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='claims'").all();
      assert.equal(claims.length, 0);
    } finally { db.close(); }
  } finally { store.close(); }
});

test('run observation buffer is idempotent for exact retries but rejects id collisions', async () => {
  const dbPath = await createDb();
  const store = new RunObservationBuffer({ dbPath });
  try {
    const first = store.record(obs());
    const second = store.record(obs());
    assert.deepEqual(second, first);
    assert.throws(() => store.record(obs({ contentRedacted: 'Different result.' })), /collision/u);
  } finally { store.close(); }
});

test('run observation buffer keeps turns isolated and prunes old operational rows', async () => {
  const dbPath = await createDb();
  const store = new RunObservationBuffer({ dbPath });
  try {
    store.record(obs({ id: 'old', observedAt: '2026-10-01T00:00:00.000Z' }));
    store.record(obs({ id: 'new', turnId: 'T2', observedAt: '2026-10-11T00:00:00.000Z' }));
    assert.equal(store.prune({ before: '2026-10-05T00:00:00.000Z' }), 1);
    assert.deepEqual(
      store.listTurn({ projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T1' }),
      [],
    );
    assert.deepEqual(
      store.listTurn({ projectId: 'project-a', branch: 'main', sessionId: 'S1', turnId: 'T2' })
        .map((row) => row.id),
      ['new'],
    );
  } finally { store.close(); }
});

test('run observation buffer rejects secrets and ineligible authority at the storage boundary', async () => {
  const dbPath = await createDb();
  const store = new RunObservationBuffer({ dbPath });
  try {
    assert.throws(() => store.record(obs({ sensitivity: 'secret_redacted' })), /secret/u);
    assert.throws(() => store.record(obs({ authorityClass: 'agent_inference' })), /authority/u);
  } finally { store.close(); }
});
