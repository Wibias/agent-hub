import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  inspectAtomicShadowDb,
  parseAtomicShadowDbArgs,
} from '../../scripts/inspect-memory-atomic-shadow-db.mjs';

async function withDb(run) {
  const root = await mkdtemp(join(tmpdir(), 'atomic-shadow-db-'));
  const path = join(root, 'data.sqlite3');
  const db = new DatabaseSync(path);
  try {
    db.exec([
      'CREATE TABLE memory_candidates (id TEXT, project_id TEXT, branch TEXT, '
        + 'source_authority TEXT, proposed_type TEXT, proposed_value TEXT, '
        + 'status TEXT, evaluated_at TEXT, created_at TEXT);',
    ].join('\n'));
    const insert = db.prepare('INSERT INTO memory_candidates VALUES (?,?,?,?,?,?,?,?,?)');
    insert.run('c1','test/project','main','user_direct','constraint',
      'In future releases, always test the live overlay with real fixtures.',
      'pending',null,'2026-11-01T00:00:00Z');
    insert.run('c2','test/project','main','user_direct','constraint',
      'For this audit, always keep the checkout unchanged.',
      'pending',null,'2026-11-02T00:00:00Z');
    insert.run('c3','test/project','main','user_direct','correction',
      'Fix the overlay today.',
      'pending',null,'2026-11-03T00:00:00Z');
    insert.run('c4','test/project','feature','user_direct','constraint',
      'In future, always use Postgres.',
      'pending',null,'2026-11-03T00:00:00Z');
    insert.run('c5','test/other','main','user_direct','constraint',
      'In future, always use MySQL.',
      'pending',null,'2026-11-03T00:00:00Z');
    insert.run('c6','test/project','main','agent_inference','constraint',
      'In future, always write agent logs.',
      'pending',null,'2026-11-03T00:00:00Z');
    insert.run('c7','test/project','main','user_direct','constraint',
      'In future, always use forbidden style.',
      'ignored','2026-11-04T00:00:00Z','2026-11-03T00:00:00Z');
    return await run(db, path);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}

test('read-only db shadow CLI requires exact scope and rejects writes', () => {
  const args = ['--db-path','source.sqlite3','--project-id','test/project','--branch','main'];
  assert.equal(parseAtomicShadowDbArgs(args).limit, 20);
  assert.equal(parseAtomicShadowDbArgs([...args,'--limit','2']).limit, 2);
  assert.throws(() => parseAtomicShadowDbArgs([...args,'--apply']), /unsupported/);
  assert.throws(() => parseAtomicShadowDbArgs([...args,'--limit','100']), /limit/);
  assert.throws(() => parseAtomicShadowDbArgs([...args,'--db-path','other']), /duplicate/);
  assert.throws(() => parseAtomicShadowDbArgs(args.slice(0,-2)), /scope/);
});

test('shadow reads only pending user candidate scope, no text or DB changes', async () => {
  await withDb(async (db, path) => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM memory_candidates').get().n;
    const report = inspectAtomicShadowDb({ dbPath:path, projectId:'test/project', branch:'main' });
    assert.equal(report.readOnly, true);
    assert.equal(report.modelInvocations, 0);
    assert.equal(report.contentIncluded, false);
    assert.equal(report.sourceDatabaseModified, false);
    assert.equal(report.candidateCount, 3);
    assert.equal(report.items.length, 3);
    assert.equal(report.reviewCounts.durable_review, 1);
    assert.equal(report.reviewCounts.bounded_review, 0);
    assert.equal(report.reviewCounts.ambiguous_review, 0);
    assert.equal(report.items[1].reason, 'scoped_audit_protocol');
    assert.ok(report.items.every(x=>/^~[0-9a-f]{10}$/u.test(x.candidateRef)));
    const output = JSON.stringify(report);
    for (const privateText of ['In future releases','For this audit','Fix the overlay','MySQL','Postgres','forbidden style']) {
      assert.equal(output.includes(privateText), false);
    }
    assert.equal(output.includes(path), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_candidates').get().n, before);
  });
});

test('limit bounds queries and does not promote or re-evaluate anything', async () => {
  await withDb(async (db,path) => {
    const result = inspectAtomicShadowDb({
      dbPath:path, projectId:'test/project', branch:'main', limit:1,
    });
    assert.equal(result.candidateCount, 1);
    assert.equal(result.reviewCounts.durable_review, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory_candidates WHERE status='pending'").get().n,6);
  });
});
