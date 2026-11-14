import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceBoundDecisionRef, inspectEvidenceBoundDecision } from '../../memory-engine/evidence-bound-decision-preflight.mjs';
import {
  parseEvidenceDecisionPreflightArgs,
  runEvidenceDecisionPreflight,
} from '../../scripts/inspect-evidence-bound-decision.mjs';
import { EVIDENCE_PROPOSAL_SCHEMA_SQL } from '../../memory-engine/evidence-bound-proposal-store.mjs';

const PROJECT = 'github.com/example/repo';
const BRANCH = 'main';
const REVISION = 'a'.repeat(40);
const FACT = 'Always verify actual source and reproducible test evidence before reporting a defect.';
const ID = 'review-proposal-1';
const SOURCE_ID = 'source-evidence-1';

function fixture(dbPath = ':memory:') {
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec(
    "CREATE TABLE project_registry (project_id TEXT PRIMARY KEY, repo_identity TEXT);"
    + "CREATE TABLE evidence (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, branch TEXT, "
    + "sensitivity TEXT, authority_class TEXT, content_redacted TEXT, metadata_json TEXT);"
    + "CREATE TABLE claims (id TEXT PRIMARY KEY, project_id TEXT, branch_scope TEXT, "
    + "state TEXT, value_text TEXT);"
  );
  db.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);
  db.prepare('INSERT INTO project_registry (project_id, repo_identity) VALUES (?,?)')
    .run(PROJECT, PROJECT);
  db.prepare('INSERT INTO evidence (id,project_id,branch,sensitivity,authority_class,content_redacted,metadata_json) VALUES (?,?,?,?,?,?,?)')
    .run(SOURCE_ID, PROJECT, BRANCH, 'normal', 'user_direct', FACT, '{"event_type":"user_prompt"}');
  db.prepare(
    "INSERT INTO memory_evidence_proposals (id,project_id,branch,kind,canonical_fact,status,policy_version,evaluator_id,fingerprint,created_at) "
    + "VALUES (?,?,?,?,?,'needs_confirmation',?,?,?,?)",
  ).run(ID, PROJECT, BRANCH, 'procedure', FACT, 'extraction-v1', 'test-extractor', 'f'.repeat(64), '2026-11-14T07:00:00.000Z');
  db.prepare('INSERT INTO memory_evidence_proposal_evidence (proposal_id,evidence_id,linked_at) VALUES (?,?,?)')
    .run(ID, SOURCE_ID, '2026-11-14T07:00:00.000Z');
  return db;
}

function inspect(db, options = {}) {
  return inspectEvidenceBoundDecision({
    db, projectId: PROJECT, branch: BRANCH,
    revisionSha: REVISION, selectedRef: evidenceBoundDecisionRef(ID),
    ...options,
  });
}

test('existing UI E~ refs resolve without revealing source or fact by default', t => {
  const db = fixture(); t.after(() => db.close());
  const report = inspect(db);
  assert.match(report.selectedRef, /^E~[0-9a-f]{10}$/u);
  assert.equal(report.status, 'requires_review');
  assert.equal(report.scope.revisionSha, REVISION);
  assert.equal(report.readOnly, true);
  assert.equal(report.writesToSource, false);
  assert.equal(report.promotionAllowed, false);
  assert.equal(report.hostUserOriginAuthenticated, false);
  assert.equal(report.decisionCommandEnabled, false);
  assert.equal(report.contentIncluded, false);
  assert.equal(JSON.stringify(report).includes(FACT), false);
  assert.ok(report.blockers.includes('evidence_support_requires_review'));
  assert.match(report.reviewSnapshotSha256, /^[0-9a-f]{64}$/u);
  assert.equal(report.evidence[0].authority, 'user_direct');
  assert.equal(db.prepare('SELECT status FROM memory_evidence_proposals WHERE id=?').get(ID).status, 'needs_confirmation');
});

test('explicit local source view is separately opt-in and still not authorization', t => {
  const db = fixture(); t.after(() => db.close());
  const preview = inspect(db, { showLocalContent: true });
  assert.equal(preview.canonicalFact, FACT);
  assert.equal(preview.evidence[0].localRedactedSource, FACT);
  assert.equal(preview.promotionAllowed, false);
  assert.equal(preview.hostUserOriginAuthenticated, false);
});

test('source authority, sensitivity, scope, and changed revision fail closed', t => {
  const db = fixture(); t.after(() => db.close());
  const prior = inspect(db).reviewSnapshotSha256;
  db.prepare("UPDATE evidence SET sensitivity='secret_redacted' WHERE id=?").run(SOURCE_ID);
  assert.equal(inspect(db).status, 'source_authority_or_scope_invalid');
  db.prepare("UPDATE evidence SET sensitivity='normal', authority_class='agent_inference' WHERE id=?").run(SOURCE_ID);
  assert.equal(inspect(db).status, 'source_authority_or_scope_invalid');
  db.prepare("UPDATE evidence SET authority_class='user_direct', content_redacted='Changed source fact.' WHERE id=?").run(SOURCE_ID);
  assert.notEqual(inspect(db).reviewSnapshotSha256, prior);
  assert.equal(inspect(db, {branch:'feature'}).status, 'not_found');
  assert.equal(inspect(db, {selectedRef:'E~0000000000'}).status, 'not_found');
});

test('unreviewed active or duplicate Claims cannot pass the relation gate', t => {
  const db = fixture(); t.after(() => db.close());
  db.prepare("INSERT INTO claims (id,project_id,branch_scope,state,value_text) VALUES (?,?,?,?,?)")
    .run('claim-1', PROJECT, BRANCH, 'active', FACT);
  const result = inspect(db);
  assert.equal(result.activeClaimsInScope, 1);
  assert.equal(result.exactDuplicateCount, 1);
  assert.ok(result.blockers.includes('active_exact_duplicate'));
  assert.ok(result.blockers.includes('independent_semantic_relation_review_required'));
  assert.equal(result.promotionAllowed, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n, 1);
});

test('strict CLI parsing and Git identity/revision verification reject stale or unsafe commands', t => {
  const db = fixture(); t.after(() => { try { db.close(); } catch {} });
  const options = {
    dbPath: ':memory:', repoPath: '/local/repo', projectId: PROJECT, branch: BRANCH,
    revisionSha: REVISION, selectedRef: evidenceBoundDecisionRef(ID),
    gitResolve: () => ({
      repoPath: '/local/repo', projectId: PROJECT, branch: BRANCH, revisionSha: REVISION,
    }),
    openDb: () => db,
  };
  assert.throws(() => parseEvidenceDecisionPreflightArgs(['--apply']), /unknown/);
  assert.throws(() => parseEvidenceDecisionPreflightArgs([
    '--db-path','test','--repo-path','test','--project-id',PROJECT,'--branch',BRANCH,
    '--revision',REVISION,'--proposal-ref','~p123456789abc',
  ]), /invalid revision/);
  assert.throws(() => runEvidenceDecisionPreflight({
    ...options, gitResolve: () => ({ ...options, revisionSha:'b'.repeat(40) }),
  }), /mismatch/);
  assert.throws(() => runEvidenceDecisionPreflight({
    ...options, showLocalContent:true, isTty:false,
  }), /interactive TTY/);
  const initial = runEvidenceDecisionPreflight({ ...options, isTty:false });
  assert.match(initial.reviewSnapshotSha256, /^[0-9a-f]{64}$/u);
});

test('stale snapshot token never authorizes an operation', () => {
  const db = fixture();
  const out = runEvidenceDecisionPreflight({
    dbPath: ':memory:', repoPath: '/local/repo', projectId: PROJECT, branch: BRANCH,
    revisionSha: REVISION, selectedRef: evidenceBoundDecisionRef(ID),
    expectedSnapshot: 'f'.repeat(64),
    gitResolve: () => ({ projectId:PROJECT, branch:BRANCH, revisionSha:REVISION }),
    openDb: () => db,
  });
  assert.equal(out.status, 'snapshot_changed');
  assert.equal(out.promotionAllowed, false);
  assert.equal(out.decisionCommandEnabled, false);
});

test('real Git + CLI stdio preflight is read-only and identity-bound', t => {
  const git = spawnSync('git', ['--version'], { encoding:'utf8' });
  if (git.error?.code === 'ENOENT') return t.skip('Git not installed in isolated test container');
  assert.equal(git.status, 0);
  const root = mkdtempSync(join(tmpdir(), 'agenthub-evidence-preflight-'));
  const repoPath = join(root, 'repo');
  const dbPath = join(root, 'memory.sqlite3');
  const command = fileURLToPath(new URL('../../scripts/inspect-evidence-bound-decision.mjs', import.meta.url));
  try {
    mkdirSync(repoPath);
    execFileSync('git', ['init','-b','main',repoPath], { stdio:'ignore' });
    execFileSync('git', ['-C',repoPath,'config','user.email','test@example.com']);
    execFileSync('git', ['-C',repoPath,'config','user.name','Local Test']);
    execFileSync('git', ['-C',repoPath,'remote','add','origin','https://github.com/example/repo.git']);
    writeFileSync(join(repoPath, 'README.md'), 'fixture\n');
    execFileSync('git', ['-C',repoPath,'add','README.md']);
    execFileSync('git', ['-C',repoPath,'commit','-m','fixture'], { stdio:'ignore' });
    const revision = execFileSync('git', ['-C',repoPath,'rev-parse','HEAD'], { encoding:'utf8' }).trim();
    const db = fixture(dbPath);
    db.close();
    const args = [
      command, '--db-path',dbPath, '--repo-path',repoPath, '--project-id',PROJECT,
      '--branch',BRANCH, '--revision',revision, '--proposal-ref',evidenceBoundDecisionRef(ID),
    ];
    const ok = spawnSync(process.execPath, args, { encoding:'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    const report = JSON.parse(ok.stdout);
    assert.equal(report.status,'requires_review');
    assert.equal(report.scope.revisionSha,revision);
    assert.equal(report.writesToSource,false);
    assert.equal(report.contentIncluded,false);
    const wrong = spawnSync(process.execPath, [
      ...args.slice(0, args.indexOf('--project-id') + 1),
      'github.com/example/another-repo',
      ...args.slice(args.indexOf('--project-id') + 2),
    ], { encoding:'utf8' });
    assert.equal(wrong.status,2);
    assert.equal(wrong.stdout,'');
    const dbVerify = new DatabaseSync(dbPath, {readOnly:true});
    try {
      assert.equal(dbVerify.prepare('SELECT status FROM memory_evidence_proposals WHERE id=?').get(ID).status,
        'needs_confirmation');
      assert.equal(dbVerify.prepare('SELECT COUNT(*) AS n FROM claims').get().n,0);
    } finally { dbVerify.close(); }
  } finally {
    rmSync(root, { recursive:true, force:true });
  }
});
