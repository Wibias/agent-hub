import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { evidenceBoundDecisionRef } from '../../memory-engine/evidence-bound-decision-preflight.mjs';
import { evidenceExtractionFingerprint } from '../../memory-engine/evidence-bound-extraction.mjs';
import { EVIDENCE_PROPOSAL_SCHEMA_SQL } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  exportProtectedEvidenceReview, parseOperatorEvidenceExportArgs,
  EVIDENCE_MANIFEST_NAME, EVIDENCE_SNAPSHOT_NAME,
} from '../../scripts/export-protected-evidence-review.mjs';

const projectId = 'github.com/example/operator-evidence';
const proposalId = 'live-real-evidence-proposal-1';
const fact = 'The project should remember this fact only after explicit operator review.';
const proposalRef = evidenceBoundDecisionRef(proposalId);

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'agenthub-operator-export-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const dbPath = join(dir, 'memory.sqlite3');
  const outputDir = join(dir, 'pinned-export');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 5000,
    stdio: ['ignore','pipe','pipe'],
  }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'operator-fixture@example.invalid');
  git('config', 'user.name', 'Review Fixture');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', 'https://github.com/example/operator-evidence.git');
  writeFileSync(join(repo, 'README.md'), 'operator E~ fixture');
  git('add', 'README.md');
  git('commit', '-m', 'fixture');
  const revisionSha = git('rev-parse', 'HEAD');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE project_registry (project_id TEXT PRIMARY KEY, repo_identity TEXT);
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, branch TEXT NOT NULL,
      authority_class TEXT NOT NULL, sensitivity TEXT NOT NULL,
      content_redacted TEXT NOT NULL, metadata_json TEXT NOT NULL
    );
    CREATE TABLE claims (
      id TEXT PRIMARY KEY, project_id TEXT, branch_scope TEXT,
      state TEXT, value_text TEXT
    );
  `);
  db.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);
  db.prepare('INSERT INTO project_registry (project_id,repo_identity) VALUES (?,?)')
    .run(projectId, projectId);
  db.prepare(`INSERT INTO evidence
    (id,project_id,branch,authority_class,sensitivity,content_redacted,metadata_json)
    VALUES (?,?,?,?,?,?,?)`).run('actual-evidence-1', projectId,
      'main', 'user_direct', 'normal',
      'User-written, not yet authorized Evidence for a real proposal',
      '{"event_type":"user_prompt"}');
  db.prepare(`INSERT INTO memory_evidence_proposals (
    id,project_id,branch,kind,canonical_fact,status,policy_version,
    evaluator_id,fingerprint,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    proposalId, projectId, 'main', 'knowledge', fact,
    'needs_confirmation', 'evidence-v1', 'test-evaluator',
    evidenceExtractionFingerprint({ kind: 'knowledge', canonicalFact: fact }),
    '2026-11-14T19:00:00.000Z',
  );
  db.prepare(`INSERT INTO memory_evidence_proposal_evidence
    (proposal_id,evidence_id,linked_at) VALUES (?,?,?)`).run(
    proposalId, 'actual-evidence-1', '2026-11-14T19:00:01.000Z',
  );
  db.close();
  return { dir, repo, dbPath, outputDir, revisionSha, git,
    options: { dbPath, repoPath: repo, proposalRef, decision: 'confirm', outputDir } };
}

test('real E~ Git+preflight -> consistent SQLite backup+exact manifest with no Claim write', async t => {
  const f = fixture(t);
  const result = await exportProtectedEvidenceReview(f.options);
  assert.equal(result.status, 'operator_transfer_ready_unverified_unapproved');
  assert.equal(result.projectId, projectId);
  assert.equal(result.proposalRef, proposalRef);
  assert.equal(result.revisionSha, f.revisionSha);
  assert.equal(result.evidenceCount, 1);
  assert.equal(result.claimWritten, false);
  assert.equal(result.humanApprovalVerified, false);
  assert.equal(result.protectedServiceImportCompleted, false);
  const manifest = JSON.parse(
    (await import('node:fs')).readFileSync(
      join(f.outputDir, EVIDENCE_MANIFEST_NAME), 'utf8',
    ),
  );
  assert.deepEqual(manifest, {
    projectId, branch: 'main', revisionSha: f.revisionSha,
    proposalRef, decision: 'confirm',
  });
  const original = new DatabaseSync(f.dbPath, { readOnly: true });
  const copy = new DatabaseSync(join(f.outputDir, EVIDENCE_SNAPSHOT_NAME),
    { readOnly: true });
  try {
    assert.equal(original.prepare('SELECT status FROM memory_evidence_proposals').get().status,
      'needs_confirmation');
    assert.equal(copy.prepare('SELECT canonical_fact FROM memory_evidence_proposals').get().canonical_fact,
      fact);
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM claims').get().n, 0);
    assert.equal(original.prepare('SELECT COUNT(*) AS n FROM claims').get().n, 0);
  } finally { original.close(); copy.close(); }
  await assert.rejects(exportProtectedEvidenceReview(f.options),
    /already_exists/);
});

test('changed live Evidence while taking backup blocks operator manifest (no approval)', async t => {
  const f = fixture(t);
  await assert.rejects(exportProtectedEvidenceReview({
    ...f.options,
    sqliteBackup: async (db, path) => {
      await backup(db, path);
      const changed = new DatabaseSync(f.dbPath);
      changed.prepare("UPDATE evidence SET content_redacted='Tampered while exporting'").run();
      changed.close();
    },
  }), /changed_during_export/);
  assert.equal(existsSync(join(f.outputDir, EVIDENCE_MANIFEST_NAME)), false);
});

test('stale/foreign Git context and dangerous relation fail without creating output directory', async t => {
  const f = fixture(t);
  f.git('checkout', '-b', 'other-branch');
  // The exported manifest is scoped to the actual current Git branch,
  // and there is no needs_confirmation E~ in that different branch.
  await assert.rejects(exportProtectedEvidenceReview(f.options), /unavailable/);
  assert.equal(existsSync(f.outputDir), false);
  f.git('checkout', 'main');
  const db = new DatabaseSync(f.dbPath);
  db.prepare(`INSERT INTO claims (id,project_id,branch_scope,state,value_text)
    VALUES (?,?,?,?,?)`).run('active-claim-1', projectId, 'main', 'active', fact);
  db.close();
  await assert.rejects(exportProtectedEvidenceReview(f.options), /unavailable/);
  assert.equal(existsSync(f.outputDir), false);
});

test('malformed ref/decision, duplicate keys, relative paths and unsafe flags deny', () => {
  const sample = [
    '--db-path',join(tmpdir(),'memory.sqlite3'),
    '--repo-path',join(tmpdir(),'repo'),
    '--proposal-ref',proposalRef,'--decision','confirm',
    '--output-dir',join(tmpdir(),'operator-out'),
  ];
  assert.equal(parseOperatorEvidenceExportArgs(sample).decision, 'confirm');
  assert.throws(() => parseOperatorEvidenceExportArgs(
    [...sample,'--apply','yes']), /invalid_export_argument/);
  assert.throws(() => parseOperatorEvidenceExportArgs(
    [...sample,'--decision','reject']), /invalid_export_argument/);
  assert.throws(() => parseOperatorEvidenceExportArgs(
    sample.map(x => x === proposalRef ? '~p1234567890' : x)), /invalid_review_ref/);
  assert.throws(() => parseOperatorEvidenceExportArgs(
    sample.map(x => x === 'confirm' ? 'approve' : x)), /invalid_review_ref/);
  assert.throws(() => parseOperatorEvidenceExportArgs(
    sample.map(x => x === join(tmpdir(),'operator-out') ? 'relative/path' : x)),
    /absolute_path_required/);
});
