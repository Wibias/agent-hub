import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  expireDueClaims,
} from '../../memory-engine/claim-expiration-maintenance.mjs';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'claim-expiration-'));
  const dbPath = join(root, 'memory.sqlite3');
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE claims (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      branch_scope TEXT NOT NULL,
      state TEXT NOT NULL,
      valid_from TEXT,
      valid_until TEXT
    ) STRICT;
  `);
  db.close();
  return dbPath;
}

function insert(dbPath, row) {
  const db = new DatabaseSync(dbPath);
  db.prepare(`INSERT INTO claims (
    id, project_id, branch_scope, state, valid_from, valid_until
  ) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.project_id ?? 'project-a', row.branch_scope ?? 'main', row.state ?? 'active', row.valid_from ?? null, row.valid_until ?? null);
  db.close();
}

function states(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare('SELECT id, state FROM claims ORDER BY id').all()
    .map((row) => ({ id: row.id, state: row.state }));
  db.close();
  return rows;
}

test('expiration maintenance transitions only due active claims at exact valid_until boundary', async () => {
  const dbPath = await setup();
  insert(dbPath, { id: 'due', valid_until: '2026-10-11T12:00:00.000Z' });
  insert(dbPath, { id: 'future', valid_until: '2026-10-11T12:00:00.001Z' });
  insert(dbPath, { id: 'unbounded' });
  insert(dbPath, { id: 'already-expired', state: 'expired', valid_until: '2026-10-01T00:00:00.000Z' });

  const result = expireDueClaims({
    dbPath,
    now: '2026-10-11T12:00:00.000Z',
  });

  assert.deepEqual(result, {
    evaluated: 3,
    expired: 1,
    claim_ids: ['due'],
  });
  assert.deepEqual(states(dbPath), [
    { id: 'already-expired', state: 'expired' },
    { id: 'due', state: 'expired' },
    { id: 'future', state: 'active' },
    { id: 'unbounded', state: 'active' },
  ]);
});

test('expiration maintenance can be scoped by project and branch', async () => {
  const dbPath = await setup();
  insert(dbPath, { id: 'target', valid_until: '2026-10-01T00:00:00.000Z' });
  insert(dbPath, { id: 'other-project', project_id: 'project-b', valid_until: '2026-10-01T00:00:00.000Z' });
  insert(dbPath, { id: 'other-branch', branch_scope: 'dev', valid_until: '2026-10-01T00:00:00.000Z' });

  const result = expireDueClaims({
    dbPath,
    now: '2026-10-11T12:00:00.000Z',
    projectId: 'project-a',
    branch: 'main',
  });
  assert.deepEqual(result.claim_ids, ['target']);
  assert.deepEqual(states(dbPath), [
    { id: 'other-branch', state: 'active' },
    { id: 'other-project', state: 'active' },
    { id: 'target', state: 'expired' },
  ]);
});

test('invalid temporal bounds fail atomically before any state mutation', async () => {
  const dbPath = await setup();
  insert(dbPath, { id: 'due', valid_until: '2026-10-01T00:00:00.000Z' });
  insert(dbPath, { id: 'invalid', valid_until: 'not-a-time' });

  assert.throws(
    () => expireDueClaims({ dbPath, now: '2026-10-11T12:00:00.000Z' }),
    /valid_until.*invalid/i,
  );
  assert.deepEqual(states(dbPath), [
    { id: 'due', state: 'active' },
    { id: 'invalid', state: 'active' },
  ]);
});

test('inverted interval fails atomically rather than expiring a malformed claim', async () => {
  const dbPath = await setup();
  insert(dbPath, {
    id: 'invalid-range',
    valid_from: '2026-10-12T00:00:00.000Z',
    valid_until: '2026-10-11T00:00:00.000Z',
  });
  assert.throws(
    () => expireDueClaims({ dbPath, now: '2026-10-13T00:00:00.000Z' }),
    /before valid_from/i,
  );
  assert.equal(states(dbPath)[0].state, 'active');
});
