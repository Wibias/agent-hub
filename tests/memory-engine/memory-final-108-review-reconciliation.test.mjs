import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  parseFinal108ReconciliationArgs, validateFinal108Manifest,
  reconcileFinal108Review,
} from './reconcile-memory-final-108-review.mjs';

const PROJECT = 'github.com/example/streamer-content';
const MAIN = 'main';
const SECRET = 'DO_NOT_PRINT_PRIVATE_USER_TEXT';
const OTHER = ['feature/a', 'feature/b', 'feature/c', 'feature/d'];
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const ref = (prefix, id) => '~' + prefix + sha(id).slice(0, 12);
const CLI = fileURLToPath(new URL('./reconcile-memory-final-108-review.mjs', import.meta.url));

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'd12-3-full-reconcile-'));
  const dbPath = join(root, 'memory.sqlite3');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE project_registry (project_id TEXT PRIMARY KEY);
      CREATE TABLE evidence (
        id TEXT PRIMARY KEY, project_id TEXT, branch TEXT, sensitivity TEXT,
        authority_class TEXT, source_kind TEXT, content_redacted TEXT
      );
      CREATE TABLE memory_evidence_proposals (
        id TEXT PRIMARY KEY, project_id TEXT, branch TEXT, kind TEXT,
        status TEXT, canonical_fact TEXT
      );
      CREATE TABLE memory_evidence_proposal_evidence (
        proposal_id TEXT, evidence_id TEXT
      );
      CREATE TABLE memory_candidates (
        id TEXT PRIMARY KEY, project_id TEXT, branch TEXT, status TEXT,
        proposed_type TEXT, proposed_value TEXT,
        source_evidence_id TEXT, source_authority TEXT
      );
      CREATE TABLE claims (
        id TEXT PRIMARY KEY, project_id TEXT, branch_scope TEXT,
        state TEXT, created_from_evidence_id TEXT
      );
      CREATE TABLE claim_evidence (claim_id TEXT, evidence_id TEXT, role TEXT);
    `);
    db.prepare('INSERT INTO project_registry VALUES (?)').run(PROJECT);
    db.prepare('INSERT INTO project_registry VALUES (?)')
      .run('github.com/another/irrelevant-project');
    const evidence = db.prepare('INSERT INTO evidence VALUES (?,?,?,?,?,?,?)');
    const insertProposal = db.prepare('INSERT INTO memory_evidence_proposals VALUES (?,?,?,?,?,?)');
    const linkProposal = db.prepare('INSERT INTO memory_evidence_proposal_evidence VALUES (?,?)');
    const insertCandidate = db.prepare('INSERT INTO memory_candidates VALUES (?,?,?,?,?,?,?,?)');
    const insertClaim = db.prepare('INSERT INTO claims VALUES (?,?,?,?,?)');
    const linkClaim = db.prepare('INSERT INTO claim_evidence VALUES (?,?,?)');
    const proposals = [];
    const candidates = [];
    const claimRefs = [];
    for (let i = 0; i < 21; i++) {
      const id = `proposed-${i}`;
      const eid = `proposal-evidence-${i}`;
      const branch = i < 9 ? MAIN : i < 15 ? OTHER[1] : i < 20 ? OTHER[2] : OTHER[3];
      const group = i < 9 ? 'source' : i < 15 ? 'other-02' : i < 20 ? 'other-03' : 'other-04';
      const fact = `${SECRET}: proposal ${i}`;
      evidence.run(eid, PROJECT, branch, 'normal', 'user_direct', 'session', `${SECRET} E${i}`);
      insertProposal.run(id, PROJECT, branch, 'procedure', 'pending', fact);
      linkProposal.run(id, eid);
      const intent = i === 0 ? 'retain_project_rule_for_review'
        : i === 9 ? 'retain_scoped_for_review' : 'ignore_when_authorized';
      proposals.push({
        proposalRef: ref('p', id), branchGroup: group,
        expectedKind: 'procedure', expectedStatus: 'pending',
        canonicalFactSha256: sha(fact), evidenceRefs: [ref('e', eid)],
        expectedAuthority: 'user_direct', intent,
        targetScope: i === 0 ? 'project_wide_e2e_qa'
          : i === 9 ? 'blender_gallery_only' : null,
      });
    }
    for (let i = 0; i < 87; i++) {
      const id = `legacy-${i}`;
      const eid = `legacy-evidence-${i}`;
      const branch = i < 2 ? MAIN : OTHER[0];
      const slot = i < 2 ? 'source' : 'other-01';
      const value = `${SECRET} candidate ${i}`;
      const source = `${SECRET} Evidence ${i}`;
      evidence.run(eid, PROJECT, branch, 'normal', 'user_direct', 'session', source);
      insertCandidate.run(id, PROJECT, branch, 'pending', 'constraint', value, eid, 'user_direct');
      candidates.push({
        candidateRef: ref('m', id), branchSlot: slot, expectedStatus: 'pending',
        expectedType: 'constraint', proposedValueSha256: sha(value),
        evidenceRef: ref('e', eid), evidenceSha256: sha(source),
        expectedAuthority: 'user_direct', sourceKind: 'session',
        intent: i === 10 ? 'retain_scoped_for_review' : 'ignore_when_authorized',
        targetScope: i === 10 ? 'blender_gallery_only' : null,
        evidenceExcerptTruncated: i === 2, valueExcerptTruncated: i === 2,
      });
    }
    for (let i = 0; i < 2; i++) {
      const id = `existing-claim-${i}`;
      const eid = `claim-evidence-${i}`;
      evidence.run(eid, PROJECT, OTHER[1], 'normal', 'user_direct', 'session', `${SECRET} claim ${i}`);
      insertClaim.run(id, PROJECT, OTHER[1], 'active', eid);
      linkClaim.run(id, eid, 'primary');
      claimRefs.push(ref('c', id));
    }
    evidence.run('foreign-evidence', 'github.com/another/irrelevant-project', MAIN,
      'normal', 'user_direct', 'session', 'FOREIGN_SECRET');
    insertCandidate.run('foreign-candidate', 'github.com/another/irrelevant-project', MAIN,
      'pending', 'constraint', 'FOREIGN_SECRET', 'foreign-evidence', 'user_direct');
    const manifest = {
      type: 'agent_hub_memory_d12_3_combined_readonly_review_intents_v1',
      origin: 'untrusted_manual_chat_transcription',
      scope: { projectId: PROJECT, sourceBranch: MAIN },
      expectedCounts: { proposals: 21, candidates: 87, activeClaims: 2 },
      sourceSnapshot: {
        proposalsReviewSha256: '1'.repeat(64),
        legacyExportSha256: '2'.repeat(64),
        closureSha256: '3'.repeat(64),
      },
      proposals, candidates, expectedActiveClaimRefs: claimRefs,
    };
    return run({ db, dbPath, root, manifest });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}
const inspect = (dbPath, manifest, overrides = {}) => reconcileFinal108Review({
  dbPath, projectId: PROJECT, sourceBranch: MAIN, manifest, ...overrides,
});
const blocked = output => {
  assert.equal(output.status, 'blocked');
  assert.equal(output.promotionAllowed, false);
  assert.equal(output.decisionsApplied, 0);
  assert.equal(output.writesToSource, false);
};

test('matches all 108 exactly, including claim scope; emits no private content or approval', () => fixture(({ db, dbPath, manifest }) => {
  const before = db.prepare('SELECT COUNT(*) n FROM memory_candidates').get().n;
  const out = inspect(dbPath, manifest);
  assert.equal(out.status, 'matched_read_only');
  assert.deepEqual(out.blockers, []);
  assert.deepEqual(out.coverage.expected, { proposals: 21, candidates: 87, activeClaims: 2 });
  assert.deepEqual(out.coverage.observed, { proposals: 21, candidates: 87, claims: 2 });
  assert.equal(out.coverage.matchedReviewedItems, 108);
  assert.equal(out.storedCandidateEvidenceHashesCompared, 87);
  assert.equal(out.proposalEvidenceBodyHashesCompared, 0);
  assert.equal(out.intentions.totalIgnored, 105);
  assert.equal(out.intentions.totalRetainedForReview, 3);
  for (const prop of ['hostConsentAuthenticated', 'evidenceBodyIntegrityVerified',
    'semanticConflictChecked', 'projectWidePropagationImplemented', 'reviewManifestAuthenticated']) {
    assert.equal(out[prop], false, prop);
  }
  assert.equal(JSON.stringify(out).includes(SECRET), false);
  assert.equal(JSON.stringify(out).includes(dbPath), false);
  assert.equal(JSON.stringify(out).includes('feature/'), false);
  assert.equal(JSON.stringify(out).includes('foreign-candidate'), false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM memory_candidates').get().n, before);
}));

test('fails closed if inventory gains 1 candidate or loses a confirmed Proposal', () => fixture(({ db, dbPath, manifest }) => {
  db.prepare('INSERT INTO memory_candidates VALUES (?,?,?,?,?,?,?,?)')
    .run('extra', PROJECT, MAIN, 'pending', 'constraint', SECRET, 'legacy-evidence-0', 'user_direct');
  let out = inspect(dbPath, manifest);
  blocked(out);
  assert.ok(out.blockers.includes('project_inventory_changed'));
  db.prepare("DELETE FROM memory_candidates WHERE id='extra'").run();
  db.prepare("UPDATE memory_evidence_proposals SET status='ignored' WHERE id='proposed-10'").run();
  out = inspect(dbPath, manifest);
  blocked(out);
  assert.ok(out.blockers.includes('project_reference_set_changed'));
}));

test('detects Candidate original proposed text drift despite truncated preview flag', () => fixture(({ db, dbPath, manifest }) => {
  db.prepare("UPDATE memory_candidates SET proposed_value=? WHERE id='legacy-2'")
    .run(SECRET + ' changed beyond excerpt');
  const out = inspect(dbPath, manifest);
  blocked(out);
  assert.ok(out.mismatches.some(x => x.ref === ref('m', 'legacy-2')
    && x.code === 'proposed_value_hash_changed'));
  assert.equal(JSON.stringify(out).includes('changed beyond excerpt'), false);
}));

test('detects stored redacted Evidence body and metadata drift, but never claims origin authenticity', () => fixture(({ db, dbPath, manifest }) => {
  db.prepare("UPDATE evidence SET content_redacted=? WHERE id='legacy-evidence-4'")
    .run('ALTERED_SOURCE_BODY');
  db.prepare("UPDATE evidence SET authority_class='agent_inference' WHERE id='legacy-evidence-5'").run();
  const out = inspect(dbPath, manifest);
  blocked(out);
  assert.ok(out.mismatches.some(x => x.code === 'stored_evidence_hash_changed'));
  assert.ok(out.mismatches.some(x => x.code === 'evidence_metadata_changed'));
  assert.equal(JSON.stringify(out).includes('ALTERED_SOURCE_BODY'), false);
  assert.equal(out.evidenceProvenanceAuthenticated, false);
}));

test('Proposal canonical fact and linked Evidence changes block', () => fixture(({ db, dbPath, manifest }) => {
  db.prepare("UPDATE memory_evidence_proposals SET canonical_fact=? WHERE id='proposed-1'")
    .run('changed-private-canonical-fact');
  db.prepare("UPDATE memory_evidence_proposal_evidence SET evidence_id=? WHERE proposal_id=?")
    .run('proposal-evidence-2', 'proposed-1');
  const out = inspect(dbPath, manifest);
  blocked(out);
  assert.ok(out.mismatches.some(x => x.code === 'fact_hash_changed'));
  assert.ok(out.mismatches.some(x => x.code === 'evidence_links_changed'));
}));

test('Candidate and Proposal branch movement blocks with no branch name exposure', () => fixture(({ db, dbPath, manifest }) => {
  db.prepare("UPDATE memory_candidates SET branch=? WHERE id='legacy-4'").run(OTHER[1]);
  db.prepare("UPDATE memory_evidence_proposals SET branch=? WHERE id='proposed-12'").run(OTHER[2]);
  const out = inspect(dbPath, manifest);
  blocked(out);
  assert.ok(out.mismatches.some(x => x.code === 'branch_slot_changed'));
  assert.ok(out.mismatches.some(x => x.code === 'branch_group_changed'));
  assert.equal(JSON.stringify(out).includes('feature/'), false);
}));

test('Claim state or broken primary Evidence linkage blocks', () => fixture(({ db, dbPath, manifest }) => {
  db.prepare("UPDATE claims SET state='stale' WHERE id='existing-claim-0'").run();
  db.prepare("UPDATE claim_evidence SET role='supporting' WHERE claim_id='existing-claim-1'").run();
  const out = inspect(dbPath, manifest);
  blocked(out);
  assert.ok(out.mismatches.some(x => x.code === 'claim_state_changed'));
  assert.ok(out.mismatches.some(x => x.code === 'primary_evidence_link_changed'));
}));

test('rejects extra keys, fake authorization, wrong scope and retention inventory tampering', () => fixture(({ dbPath, manifest }) => {
  const scope = { projectId: PROJECT, sourceBranch: MAIN };
  assert.equal(validateFinal108Manifest(manifest, scope), manifest);
  assert.throws(() => validateFinal108Manifest({ ...manifest, approved: true }, scope));
  assert.throws(() => validateFinal108Manifest({ ...manifest, origin: 'authenticated' }, scope));
  assert.throws(() => validateFinal108Manifest({ ...manifest, scope: { projectId: 'other', sourceBranch: MAIN } }, scope));
  const swapped = { ...manifest, candidates: manifest.candidates.map((x, i) =>
    i === 10 ? { ...x, targetScope: 'project_wide_e2e_qa' } : x) };
  assert.throws(() => validateFinal108Manifest(swapped, scope));
  assert.throws(() => validateFinal108Manifest({ ...manifest, expectedCounts: { proposals: 21, candidates: 88, activeClaims: 2 } }, scope));
  assert.throws(() => validateFinal108Manifest({ ...manifest, proposals: [...manifest.proposals, manifest.proposals[0]] }, scope));
  assert.throws(() => inspect(dbPath, manifest, { projectId: 'not-project' }));
}));

test('CLI rejects --apply, missing digest and unverified file, but accepts exact local digest', () => fixture(({ dbPath, root, manifest }) => {
  const file = join(root, 'review-intents.json');
  writeFileSync(file, JSON.stringify(manifest));
  const digest = sha(readFileSync(file));
  const args = [
    '--db-path', dbPath, '--project-id', PROJECT,
    '--source-branch', MAIN, '--review-file', file,
    '--expected-review-sha256', digest,
  ];
  const ok = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).status, 'matched_read_only');
  const rejectHash = spawnSync(process.execPath, [CLI, ...args.slice(0, -1), '0'.repeat(64)], { encoding: 'utf8' });
  assert.equal(rejectHash.status, 1);
  assert.equal(rejectHash.stdout, '');
  const rejectFlag = spawnSync(process.execPath, [CLI, ...args, '--apply'], { encoding: 'utf8' });
  assert.equal(rejectFlag.status, 1);
  assert.equal(rejectFlag.stdout, '');
  for (const x of [ok.stdout, rejectFlag.stderr]) {
    assert.equal(x.includes(SECRET), false);
    assert.equal(x.includes(dbPath), false);
    assert.equal(x.includes(file), false);
  }
}));

test('missing tables, unknown projects and extra active Claims fail closed', () => fixture(({ db, dbPath, manifest }) => {
  db.prepare('INSERT INTO claims VALUES (?,?,?,?,?)')
    .run('extra-claim', PROJECT, MAIN, 'active', 'legacy-evidence-0');
  let out = inspect(dbPath, manifest);
  blocked(out);
  assert.ok(out.blockers.includes('project_inventory_changed'));
  db.prepare("DELETE FROM claims WHERE id='extra-claim'").run();
  const wrongProjectManifest = { ...manifest, scope: { projectId: 'github.com/example/missing', sourceBranch: MAIN } };
  out = inspect(dbPath, wrongProjectManifest, { projectId: 'github.com/example/missing' });
  blocked(out);
  assert.deepEqual(out.blockers, ['project_not_registered']);
  db.exec('DROP TABLE claim_evidence');
  out = inspect(dbPath, manifest);
  blocked(out);
  assert.deepEqual(out.blockers, ['required_ledger_missing']);
}));

test('strict CLI argument validation refuses duplicate controls, non-JSON manifest flags and mutations', () => {
  assert.throws(() => parseFinal108ReconciliationArgs(['--apply']));
  assert.throws(() => parseFinal108ReconciliationArgs([
    '--db-path', '/tmp/db', '--db-path', '/tmp/db', '--project-id', PROJECT,
  ]));
  assert.throws(() => parseFinal108ReconciliationArgs([
    '--db-path', '/tmp/db', '--project-id', PROJECT, '--source-branch', MAIN,
    '--review-file', '/tmp/review', '--expected-review-sha256', 'not-a-sha',
  ]));
});
