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


function makeFullyReviewedPendingProcedure(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(`UPDATE memory_evidence_proposals
      SET status='pending',kind='procedure',fingerprint=?,
          importance_json=?,support_json=? WHERE id=?`).run(
      evidenceExtractionFingerprint({ kind:'procedure', canonicalFact:fact }),
      JSON.stringify({
        decision:'promote',durability:'long',future_utility:'high',
        confidence:'high',meaning_preserved:true,
        reason:'Long-term project acceptance instruction',risk_flags:[],
      }),
      JSON.stringify({
        decision:'supported',confidence:'high',meaning_preserved:true,
        reason:'Exact user evidence scope',risk_flags:[],
      }),
      proposalId,
    );
    db.prepare(`INSERT INTO memory_evidence_proposal_relations
      (proposal_id,relation,related_claim_id,evaluator_id,policy_version,evaluated_at,result_json)
      VALUES (?,'unrelated',NULL,?,?,?,?)`).run(
        proposalId,'deterministic:zero-comparable-claims','evidence-relation-v1',
        '2026-11-16T10:00:00.000Z',
        JSON.stringify({
          relation:'unrelated',target_ref:null,confidence:'high',
          meaning_preserved:true,reason:'No active comparable claims in scope',
        }),
      );
  } finally { db.close(); }
}

test('fully judged pending procedure exports as UNAPPROVED snapshot without any status coercion',async t=>{
  const f=fixture(t);
  makeFullyReviewedPendingProcedure(f.dbPath);
  const result=await exportProtectedEvidenceReview(f.options);
  assert.equal(result.status,'operator_transfer_ready_unverified_unapproved');
  assert.equal(result.claimWritten,false);
  const src=new DatabaseSync(f.dbPath,{readOnly:true});
  const copy=new DatabaseSync(join(f.outputDir,EVIDENCE_SNAPSHOT_NAME),{readOnly:true});
  try {
    for(const db of [src,copy]){
      const row=db.prepare('SELECT status,kind FROM memory_evidence_proposals WHERE id=?').get(proposalId);
      assert.equal(row.status,'pending');
      assert.equal(row.kind,'procedure');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM claims').get().n,0);
    }
    const m=JSON.parse((await import('node:fs')).readFileSync(
      join(f.outputDir,EVIDENCE_MANIFEST_NAME),'utf8',
    ));
    assert.equal(m.proposalRef,proposalRef);
  } finally {src.close();copy.close();}
});

test('pending without real Support or with targeted relation cannot be exported as operator review',async t=>{
  const f=fixture(t);
  makeFullyReviewedPendingProcedure(f.dbPath);
  const db=new DatabaseSync(f.dbPath);
  try {
    db.prepare("UPDATE memory_evidence_proposals SET support_json=NULL WHERE id=?").run(proposalId);
  } finally {db.close();}
  await assert.rejects(exportProtectedEvidenceReview(f.options),/unavailable/u);
  assert.equal(existsSync(f.outputDir),false);
  const db2=new DatabaseSync(f.dbPath);
  try{
    db2.prepare('UPDATE memory_evidence_proposals SET support_json=? WHERE id=?').run(
      JSON.stringify({
        decision:'supported',confidence:'high',meaning_preserved:true,
        reason:'Exact user evidence scope',risk_flags:[],
      }),proposalId,
    );
    db2.prepare("UPDATE memory_evidence_proposal_relations SET relation='update' WHERE proposal_id=?").run(proposalId);
  }finally{db2.close();}
  await assert.rejects(exportProtectedEvidenceReview(f.options),/unavailable/u);
  assert.equal(existsSync(f.outputDir),false);
});

test('nonduplicate existing Claim still blocks both protected export actions', async t => {
  const f = fixture(t);
  const db = new DatabaseSync(f.dbPath);
  db.prepare('INSERT INTO claims (id,project_id,branch_scope,state,value_text) VALUES (?,?,?,?,?)')
    .run('existing', projectId, 'main', 'active', 'Completely separate existing fact.');
  db.close();
  for (const decision of ['confirm', 'reject']) {
    await assert.rejects(exportProtectedEvidenceReview({...f.options, decision}), /unavailable/);
    assert.equal(existsSync(f.outputDir), false);
  }
  const check = new DatabaseSync(f.dbPath, {readOnly:true});
  try {
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM claims').get().n, 1);
    assert.equal(check.prepare('SELECT status FROM memory_evidence_proposals').get().status, 'needs_confirmation');
  } finally { check.close(); }
});


test('explicit comparison-only export keeps normal admission closed and binds purpose',async t=>{
  const f=fixture(t);
  const purpose='comparison_preview_v1';
  await assert.rejects(exportProtectedEvidenceReview({...f.options,purpose}),/unavailable/);
  assert.equal(existsSync(f.outputDir),false);
  const db=new DatabaseSync(f.dbPath);
  db.prepare('INSERT INTO claims VALUES (?,?,?,?,?)').run('existing',projectId,'main','active','Independent existing fact');
  db.close();
  await assert.rejects(exportProtectedEvidenceReview(f.options),/unavailable/);
  const result=await exportProtectedEvidenceReview({...f.options,purpose});
  assert.equal(result.status,'operator_comparison_transfer_ready_unverified_no_authority');
  assert.equal(result.claimWritten,false);
  assert.equal(result.humanApprovalVerified,false);
  assert.equal(result.protectedServiceImportCompleted,false);
  const {readFileSync}=await import('node:fs');
  const manifest=JSON.parse(readFileSync(join(f.outputDir,EVIDENCE_MANIFEST_NAME),'utf8'));
  assert.deepEqual(manifest,{projectId,branch:'main',revisionSha:f.revisionSha,proposalRef,decision:'confirm',purpose});
  const copy=new DatabaseSync(join(f.outputDir,EVIDENCE_SNAPSHOT_NAME),{readOnly:true});
  try{assert.equal(copy.prepare('SELECT COUNT(*) n FROM claims').get().n,1);}
  finally{copy.close();}
});

test('comparison transfer denies changed claim and leaves no manifest',async t=>{
  const f=fixture(t);
  const db=new DatabaseSync(f.dbPath);
  db.prepare('INSERT INTO claims VALUES (?,?,?,?,?)').run('existing',projectId,'main','active','Independent existing fact');
  db.close();
  await assert.rejects(exportProtectedEvidenceReview({...f.options,purpose:'comparison_preview_v1',
    sqliteBackup:async(input,path)=>{
      await backup(input,path);
      const changed=new DatabaseSync(f.dbPath);
      try{changed.exec("UPDATE claims SET value_text='Changed comparison'");}finally{changed.close();}
    }}),/changed_during_export/);
  assert.equal(existsSync(join(f.outputDir,EVIDENCE_MANIFEST_NAME)),false);
});
