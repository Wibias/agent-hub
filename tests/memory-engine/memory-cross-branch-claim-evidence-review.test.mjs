import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  inspectCrossBranchClaimEvidence, parseCrossBranchClaimReviewArgs,
} from '../../scripts/inspect-memory-cross-branch-claim-evidence.mjs';

const PROJECT = 'github.com/example/streamer-content';
const FOREIGN = 'github.com/example/foreign';
const SOURCE_BRANCH = 'main';
const FEATURE = 'feature/private-branch';
const SECRET = 'SYNTHETIC_PRIVATE_CLAIM_CONTENT';
const EVIDENCE_TEXT = 'SYNTHETIC_PRIVATE_EVIDENCE_CONTENT';
const SCRIPT = fileURLToPath(new URL(
  '../../scripts/inspect-memory-cross-branch-claim-evidence.mjs', import.meta.url,
));
const opaque = id => '~c' + createHash('sha256').update(id, 'utf8')
  .digest('hex').slice(0, 12);

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'cross-branch-claim-review-'));
  const dbPath = join(dir, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  let db;
  try {
    memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
    memory.registerProject({ projectId: FOREIGN, repoIdentity: FOREIGN });
    for (const [id, projectId, branch] of [
      ['source-a', PROJECT, FEATURE],
      ['source-b', PROJECT, FEATURE],
      ['source-foreign', FOREIGN, FEATURE],
    ]) {
      memory.recordEvidence({
        id, projectId, branch, harness: 'codex', sessionId: SECRET,
        sourceKind: 'session', sourceRef: SECRET,
        capturedAt: '2026-11-05T00:00:00.000Z',
        content: EVIDENCE_TEXT,
        authorityClass: 'user_direct',
        metadata: { event_type: 'user_prompt' },
      });
    }
    db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
    const addClaim = (id, project, branch, evidence, state) => {
      db.prepare('INSERT INTO claims ' +
        '(id,project_id,kind,subject,predicate,value_text,state,branch_scope,' +
        'created_from_evidence_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(id, project, 'user_direct', SECRET + ' subject', 'states',
          SECRET + ' value', state, branch, evidence, '2026-11-05T00:00:00.000Z');
      db.prepare('INSERT INTO claim_evidence (claim_id,evidence_id,role,linked_at) ' +
        'VALUES (?,?,"primary",?)')
        .run(id, evidence, '2026-11-05T00:00:00.000Z');
    };
    addClaim('claim-a', PROJECT, FEATURE, 'source-a', 'active');
    addClaim('claim-b', PROJECT, FEATURE, 'source-b', 'active');
    addClaim('claim-foreign', FOREIGN, FEATURE, 'source-foreign', 'active');
    return await fn({ db, dbPath });
  } finally {
    db?.close();
    memory.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const audit = (dbPath, ref = opaque('claim-a'), options = {}) =>
  inspectCrossBranchClaimEvidence({
    dbPath, projectId: PROJECT, sourceBranch: SOURCE_BRANCH,
    selectedRef: ref, ...options,
  });

test('metadata-only review resolves one cross-branch Claim without texts, IDs or branch names', async () => {
  await fixture(async ({ db, dbPath }) => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM claims').get().n;
    const r = audit(dbPath);
    assert.equal(r.status, 'manual_claim_review_required');
    assert.equal(r.claim.state, 'active');
    assert.equal(r.claim.kind, 'user_direct');
    assert.equal(r.claim.sameAsSourceBranch, false);
    assert.equal(r.claim.primaryEvidenceLinked, true);
    assert.equal(r.claim.allSourcesStructurallySafe, true);
    assert.equal(r.claim.linkedEvidence, 1);
    assert.equal(r.sources.length, 1);
    assert.equal(r.sources[0].authority, 'user_direct');
    assert.equal(r.sources[0].sameProjectAndClaimBranch, true);
    assert.equal(r.sources[0].hostOriginAuthenticatedByThisAudit, false);
    assert.equal(r.readOnly, true);
    assert.equal(r.writesToSource, false);
    assert.equal(r.claimsCreated, 0);
    assert.equal(r.decisionsApplied, 0);
    assert.equal(r.promotionAllowed, false);
    assert.equal(r.contentIncluded, false);
    assert.equal(r.semanticConflictChecked, false);
    assert.equal(r.evidenceBodyIntegrityVerified, false);
    assert.equal(r.hostConsentAuthenticated, false);
    assert.equal(r.projectWidePropagationImplemented, false);
    const result = JSON.stringify(r);
    for (const forbidden of [SECRET, EVIDENCE_TEXT, 'claim-a', 'source-a',
      FEATURE, FOREIGN, dbPath, 'sessionId']) {
      assert.equal(result.includes(forbidden), false, forbidden);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n, before);
  });
});

test('single explicitly opted-in local review reveals bounded normal Claim and Evidence text', async () => {
  await fixture(async ({ dbPath }) => {
    const r = audit(dbPath, opaque('claim-b'), { showLocalContent: true });
    assert.equal(r.status, 'manual_claim_review_required');
    assert.equal(r.contentIncluded, true);
    assert.equal(r.claim.localSubject.text, SECRET + ' subject');
    assert.equal(r.claim.localValue.text, SECRET + ' value');
    assert.equal(r.claim.localPredicate.text, 'states');
    assert.equal(r.sources[0].localRedactedEvidenceExcerpt.text, EVIDENCE_TEXT);
    assert.equal(r.sources[0].normalSensitivity, true);
  });
});

test('sensitive or cross-branch source blocks content even when explicitly requested', async () => {
  await fixture(async ({ db, dbPath }) => {
    db.prepare("UPDATE evidence SET sensitivity='secret_redacted' WHERE id='source-a'").run();
    let r = audit(dbPath, opaque('claim-a'), { showLocalContent: true });
    assert.equal(r.status, 'blocked');
    assert.equal(r.contentIncluded, false);
    assert.equal(JSON.stringify(r).includes(SECRET), false);
    db.prepare("UPDATE evidence SET sensitivity='normal', branch='main' WHERE id='source-a'").run();
    r = audit(dbPath, opaque('claim-a'), { showLocalContent: true });
    assert.equal(r.status, 'blocked');
    assert.equal(r.contentIncluded, false);
  });
});

test('missing, mismatched, or multiple primary sources never grant text access', async () => {
  await fixture(async ({ db, dbPath }) => {
    db.prepare("DELETE FROM claim_evidence WHERE claim_id='claim-a'").run();
    let r = audit(dbPath, opaque('claim-a'), { showLocalContent: true });
    assert.equal(r.status, 'blocked');
    assert.equal(r.claim.primaryEvidenceLinked, false);
    assert.equal(r.contentIncluded, false);
    db.prepare("INSERT INTO claim_evidence (claim_id,evidence_id,role,linked_at) " +
      "VALUES ('claim-a','source-b','primary','2026-11-05T00:00:00.000Z')").run();
    r = audit(dbPath, opaque('claim-a'), { showLocalContent: true });
    assert.equal(r.status, 'blocked');
    assert.equal(r.contentIncluded, false);
  });
});

test('project and opaque reference boundaries fail closed without leaking foreign claims', async () => {
  await fixture(async ({ dbPath }) => {
    assert.deepEqual(audit(dbPath, opaque('claim-foreign')).blockers, ['claim_not_found_in_scope']);
    assert.deepEqual(audit(dbPath, '~c000000000000').blockers, ['claim_not_found_in_scope']);
    assert.deepEqual(audit(dbPath, opaque('claim-a'), {
      projectId: 'github.com/absent',
    }).blockers, ['project_not_registered']);
    assert.throws(() => audit(dbPath, 'claim-a'), /scope/u);
  });
});

test('missing schema blocks instead of claiming absence of Claims', async () => {
  await fixture(async ({ db, dbPath }) => {
    db.exec('DROP TABLE claim_evidence');
    assert.deepEqual(audit(dbPath).blockers, ['required_ledger_missing']);
  });
});

test('CLI enforces interactive content opt-in and rejects write and ambiguous flags', async () => {
  await fixture(async ({ dbPath }) => {
    const args = ['--db-path', dbPath, '--project-id', PROJECT,
      '--source-branch', SOURCE_BRANCH, '--claim-ref', opaque('claim-a')];
    assert.equal(parseCrossBranchClaimReviewArgs(args).selectedRef, opaque('claim-a'));
    assert.throws(() => parseCrossBranchClaimReviewArgs([...args, '--apply']));
    assert.throws(() => parseCrossBranchClaimReviewArgs([...args, '--show-raw-content']));
    assert.throws(() => parseCrossBranchClaimReviewArgs([
      ...args, '--claim-ref', opaque('claim-b'),
    ]));
    const read = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(read.status, 0, read.stderr);
    assert.equal(JSON.parse(read.stdout).contentIncluded, false);
    assert.equal(read.stdout.includes(SECRET), false);
    const nonTty = spawnSync(process.execPath, [
      SCRIPT, ...args, '--show-local-content',
    ], { encoding: 'utf8' });
    assert.equal(nonTty.status, 1);
    assert.equal(nonTty.stdout, '');
    assert.equal(nonTty.stderr.includes(dbPath), false);
  });
});
