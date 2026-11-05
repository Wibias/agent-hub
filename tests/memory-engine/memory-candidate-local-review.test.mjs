import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseCandidateReviewArgs,
  inspectPendingCandidateReview,
} from '../../scripts/doctor-memory-candidate-review.mjs';

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'candidate-local-review-'));
  const dbPath = join(root, 'fixture.sqlite3');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(
      'CREATE TABLE memory_candidates (id TEXT, project_id TEXT, branch TEXT, '
      + 'source_authority TEXT, proposed_type TEXT, proposed_value TEXT, '
      + 'status TEXT, evaluated_at TEXT, created_at TEXT)',
    );
    const put = db.prepare('INSERT INTO memory_candidates VALUES (?,?,?,?,?,?,?,?,?)');
    put.run('constraint1','example/project','main','user_direct','constraint',
      'PRIVACY-TEST: Keep this naming rule until the migration completes.',
      'pending',null,'2026-11-01T00:00:00Z');
    put.run('correction2','example/project','main','user_direct','correction',
      'PRIVACY-TEST: Previous decision is now superseded.',
      'pending',null,'2026-11-02T00:00:00Z');
    put.run('otherbranch','example/project','feature','user_direct','constraint',
      'UNRELATED-BRANCH','pending',null,'2026-11-03T00:00:00Z');
    put.run('otherproject','example/other','main','user_direct','correction',
      'UNRELATED-PROJECT','pending',null,'2026-11-03T00:00:00Z');
    put.run('agent3','example/project','main','agent_inference','decision',
      'AGENT-DATA','pending',null,'2026-11-03T00:00:00Z');
    put.run('ignored4','example/project','main','user_direct','constraint',
      'ALREADY-IGNORED','ignored','2026-11-04T00:00:00Z','2026-11-03T00:00:00Z');
    put.run('assessed5','example/project','main','user_direct','correction',
      'ALREADY-ASSESSSED','pending','2026-11-04T00:00:00Z','2026-11-03T00:00:00Z');
    return await run(dbPath);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}

test('local review CLI requires exact scope, rejects unsafe flags and duplicates', () => {
  const args = ['--db-path','fixture.sqlite3','--project-id','example/project','--branch','main'];
  assert.equal(parseCandidateReviewArgs(args).showLocalContent, false);
  assert.equal(parseCandidateReviewArgs([...args,'--show-local-content']).showLocalContent, true);
  assert.throws(() => parseCandidateReviewArgs([...args,'--apply']), /unsupported option/);
  assert.throws(() => parseCandidateReviewArgs([...args,'--db-path','elsewhere']), /duplicate option/);
  assert.throws(() => parseCandidateReviewArgs(args.slice(0,-2)), /required/);
});

test('default review output excludes values and remains branch/project/authority scoped', async () => {
  await withFixture(async (dbPath) => {
    const report = inspectPendingCandidateReview({
      dbPath, projectId: 'example/project', branch: 'main',
    });
    assert.equal(report.readOnly, true);
    assert.equal(report.modelInvocations, 0);
    assert.equal(report.candidateCount, 2);
    assert.deepEqual(report.candidates.map(x => x.kind), ['constraint','correction']);
    assert.ok(report.candidates.every(x => /^~[a-f0-9]{10}$/.test(x.candidateRef)));
    assert.ok(report.candidates.every(x => !Object.hasOwn(x, 'localCandidateText')));
    assert.equal(JSON.stringify(report).includes('PRIVACY-TEST'), false);
    assert.equal(JSON.stringify(report).includes('ALREADY-IGNORED'), false);
    assert.equal(JSON.stringify(report).includes(dbPath), false);
  });
});

test('explicit local-content switch yields only scoped stored text and makes no changes', async () => {
  await withFixture(async (dbPath) => {
    const report = inspectPendingCandidateReview({
      dbPath, projectId: 'example/project', branch: 'main', showLocalContent: true,
    });
    assert.equal(report.contentIncluded, true);
    assert.equal(report.candidateCount, 2);
    assert.match(report.candidates[0].localCandidateText, /migration completes/);
    assert.match(report.candidates[1].localCandidateText, /Previous decision/);
    const text = JSON.stringify(report);
    for (const forbidden of ['UNRELATED-BRANCH','UNRELATED-PROJECT','AGENT-DATA','ALREADY-IGNORED','ALREADY-ASSESSSED']) {
      assert.equal(text.includes(forbidden), false);
    }
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const record = db.prepare('SELECT COUNT(*) AS n FROM memory_candidates').get();
      assert.equal(record.n, 7);
    } finally { db.close(); }
  });
});
