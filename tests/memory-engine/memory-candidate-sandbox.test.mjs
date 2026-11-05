import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  countSandboxMemory,
  parseCandidateSandboxArgs,
  runCandidateSandbox,
} from '../../scripts/doctor-memory-candidate-sandbox.mjs';

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'memory-sandbox-fixture-'));
  const source = join(dir, 'live.sqlite3');
  const db = new DatabaseSync(source);
  try {
    db.exec([
      'PRAGMA journal_mode=WAL;',
      'CREATE TABLE claims(project_id TEXT, branch_scope TEXT, state TEXT);',
      'CREATE TABLE memory_candidates(project_id TEXT, branch TEXT, status TEXT, evaluated_at TEXT);',
      'CREATE TABLE memory_evidence_proposals(project_id TEXT, branch TEXT, status TEXT);',
    ].join('\n'));
    db.prepare('INSERT INTO memory_candidates VALUES (?,?,?,?)').run('github.com/example/project', 'main', 'pending', null);
    db.prepare('INSERT INTO memory_candidates VALUES (?,?,?,?)').run('different/project', 'main', 'pending', null);
    db.prepare('INSERT INTO memory_evidence_proposals VALUES (?,?,?)').run('github.com/example/project', 'main', 'needs_confirmation');
    return await run({ source, db });
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('sandbox CLI requires explicit scope and execute-on-copy gate', () => {
  const argv = [
    '--source-db','./fixture.sqlite3',
    '--project-id','github.com/example/project',
    '--branch','main',
    '--execute-on-copy',
  ];
  assert.equal(parseCandidateSandboxArgs(argv).limit, 1);
  assert.throws(() => parseCandidateSandboxArgs(argv.slice(0,-1)), /execute-on-copy/);
  assert.throws(() => parseCandidateSandboxArgs([...argv,'--limit','100']), /unsupported/);
  assert.throws(() => parseCandidateSandboxArgs([...argv,'--source-db','other']), /duplicate/);
  assert.throws(() => parseCandidateSandboxArgs([...argv,'--apply']), /unsupported/);
});

test('online snapshot includes WAL data, runs stages only on copy, and omits private text', async () => {
  await fixture(async ({ source, db }) => {
    const projectId = 'github.com/example/project';
    const before = countSandboxMemory(source, projectId, 'main');
    assert.equal(before.pendingImportance, 1);
    assert.equal(before.evidenceNeedsConfirmation, 1);
    let copiedDb = null;
    const stages = [];
    const mockRuntime = (label) => async ({ dependencies }) => {
      const path = dependencies.resolveRuntime().dbPath;
      assert.notEqual(path, source, label);
      assert.equal(dependencies.resolveRuntime().projectId, projectId);
      assert.equal(dependencies.resolveRuntime().branch, 'main');
      copiedDb = path;
      stages.push(label);
      if (label === 'importance') {
        const edit = new DatabaseSync(path);
        try {
          edit.prepare("UPDATE memory_candidates SET status='ignored' WHERE project_id=? AND branch=?").run(projectId,'main');
        } finally { edit.close(); }
        return { summary: { total: 1, evaluated: 1, applied: 1, failed: 0, results: [{
          candidate_ref: 'SECRET-CANDIDATE', decision: 'ignore', judgment: {
            canonical_fact: 'PRIVATE MEMORY TEXT',
          },
        }] } };
      }
      if (label === 'relation') return { summary: { total: 0, evaluated: 0, applied: 0, failed: 0, results: [] } };
      return { summary: { total: 0, promoted: 0, superseded: 0, needs_confirmation: 0, failed: 0, results: [] } };
    };
    const report = await runCandidateSandbox({
      sourceDbPath: source, projectId, branch: 'main', limit: 1,
      runImportance: mockRuntime('importance'),
      runRelation: mockRuntime('relation'),
      runPromotion: mockRuntime('promotion'),
    });
    assert.equal(report.status, 'completed');
    assert.deepEqual(stages, ['importance','relation','promotion']);
    assert.equal(report.before.pendingImportance, 1);
    assert.equal(report.after.pendingImportance, 0);
    assert.equal(report.after.evidenceNeedsConfirmation, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory_candidates WHERE project_id=? AND status='pending'").get(projectId).n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory_candidates WHERE project_id=? AND status='pending'").get('different/project').n, 1);
    assert.equal(existsSync(copiedDb), false);
    const output = JSON.stringify(report);
    assert.equal(output.includes('SECRET-CANDIDATE'), false);
    assert.equal(output.includes('PRIVATE MEMORY TEXT'), false);
    assert.equal(output.includes(source), false);
    assert.equal(report.stages[0].decisions.ignore, 1);
  });
});

test('sandbox reports only the stage on unexpected failure and still removes copy', async () => {
  await fixture(async ({ source }) => {
    let copy = null;
    const report = await runCandidateSandbox({
      sourceDbPath: source, projectId: 'github.com/example/project', branch: 'main',
      runImportance: async ({ dependencies }) => {
        copy = dependencies.resolveRuntime().dbPath;
        throw new Error('PRIVATE-LIVE-DATABASE-CONTENT');
      },
    });
    assert.equal(report.status, 'failed');
    assert.equal(report.failedStage, 'importance');
    assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
    assert.equal(existsSync(copy), false);
    assert.equal(countSandboxMemory(source, 'github.com/example/project', 'main').pendingImportance, 1);
  });
});

test('sandbox does not invoke models when requested scope has no pending candidates', async () => {
  await fixture(async ({ source }) => {
    const report = await runCandidateSandbox({
      sourceDbPath: source, projectId: 'github.com/example/project', branch: 'feature',
      runImportance: () => { throw new Error('should not run'); },
    });
    assert.equal(report.status, 'nothing_pending');
    assert.deepEqual(report.stages, []);
  });
});
