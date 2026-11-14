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
import { EVIDENCE_PROPOSAL_SCHEMA_SQL } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  inspectCrossBranchMemoryIndex, parseCrossBranchInventoryArgs,
} from '../../scripts/inspect-memory-cross-branch-metadata.mjs';

const PROJECT = 'github.com/example/streamer-content';
const FOREIGN = 'github.com/example/foreign';
const MAIN = 'main';
const SECRET = 'SYNTHETIC_PRIVATE_MEMORY_DO_NOT_EXPOSE';
const SCRIPT = fileURLToPath(new URL('../../scripts/inspect-memory-cross-branch-metadata.mjs', import.meta.url));
const ref = (prefix, id) => '~' + prefix + createHash('sha256')
  .update(id, 'utf8').digest('hex').slice(0, 12);

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'cross-branch-inventory-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  let db;
  try {
    memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
    memory.registerProject({ projectId: FOREIGN, repoIdentity: FOREIGN });
    for (const [id, projectId, branch, authority] of [
      ['e-main', PROJECT, MAIN, 'user_direct'],
      ['e-feature', PROJECT, 'feature/secret', 'tool_observation'],
      ['e-foreign', FOREIGN, MAIN, 'user_direct'],
    ]) {
      memory.recordEvidence({
        id, projectId, branch, sourceKind: 'session', sourceRef: SECRET,
        harness: 'codex', sessionId: SECRET, capturedAt: '2026-11-05T00:00:00.000Z',
        content: SECRET, authorityClass: authority, metadata: { event_type: 'tool_output' },
      });
    }
    db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
    db.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);
    const claim = db.prepare('INSERT INTO claims (id,project_id,kind,subject,predicate,value_text,' +
      'state,branch_scope,created_from_evidence_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    claim.run('claim-feature-active', PROJECT, 'procedure', SECRET, 'requires', SECRET,
      'active', 'feature/secret', 'e-feature', '2026-11-05T00:00:00.000Z');
    claim.run('claim-main-stale', PROJECT, 'procedure', SECRET, 'requires', SECRET,
      'stale', MAIN, 'e-main', '2026-11-05T00:00:00.000Z');
    claim.run('claim-foreign', FOREIGN, 'procedure', SECRET, 'requires', SECRET,
      'active', MAIN, 'e-foreign', '2026-11-05T00:00:00.000Z');
    const candidate = db.prepare('INSERT INTO memory_candidates ' +
      '(id,project_id,branch,source_evidence_id,proposed_type,proposed_value,source_authority,' +
      'status,decision_reason,created_at,policy_version,fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    candidate.run('candidate-feature', PROJECT, 'feature/secret', 'e-feature',
      'decision', SECRET, 'tool_observation', 'pending', 'synthetic',
      '2026-11-05T00:00:00.000Z', 'v1', 'fp-feature');
    candidate.run('candidate-main', PROJECT, MAIN, 'e-main',
      'decision', SECRET, 'user_direct', 'failed', 'synthetic',
      '2026-11-05T00:00:00.000Z', 'v1', 'fp-main');
    candidate.run('candidate-foreign', FOREIGN, MAIN, 'e-foreign',
      'decision', SECRET, 'user_direct', 'pending', 'synthetic',
      '2026-11-05T00:00:00.000Z', 'v1', 'fp-foreign');
    const proposal = db.prepare('INSERT INTO memory_evidence_proposals ' +
      '(id,project_id,branch,kind,canonical_fact,status,policy_version,evaluator_id,' +
      'fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const link = db.prepare('INSERT INTO memory_evidence_proposal_evidence ' +
      '(proposal_id,evidence_id,linked_at) VALUES (?,?,?)');
    for (const [id, project, branch, evidence, status] of [
      ['proposal-main', PROJECT, MAIN, 'e-main', 'needs_confirmation'],
      ['proposal-feature', PROJECT, 'feature/secret', 'e-feature', 'pending'],
      ['proposal-foreign', FOREIGN, MAIN, 'e-foreign', 'pending'],
    ]) {
      proposal.run(id, project, branch, 'procedure', SECRET, status, 'v1',
        'synthetic', id, '2026-11-05T00:00:00.000Z');
      link.run(id, evidence, '2026-11-05T00:00:00.000Z');
    }
    return await fn({ db, dbPath, memory });
  } finally {
    db?.close();
    memory.close();
    await rm(root, { recursive: true, force: true });
  }
}
const audit = (dbPath, category, more = {}) => inspectCrossBranchMemoryIndex({
  dbPath, projectId: PROJECT, sourceBranch: MAIN, category, ...more,
});

test('summary enumerates only registered project rows across branches, no text', async () => {
  await fixture(async ({ db, dbPath }) => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM claims').get().n;
    const result = audit(dbPath, 'summary');
    assert.equal(result.status, 'manual_metadata_review_required');
    assert.deepEqual(result.inventory, {
      branchesWithRows: 2, claims: 2, candidates: 2, proposals: 2,
      completelyEnumerated: true, truncated: false, selectedReturned: 0,
    });
    assert.equal(result.branchSlots.source.claims, 1);
    assert.equal(result.branchSlots['other-01'].claims, 1);
    assert.equal(result.branchSlots['other-01'].candidates, 1);
    assert.equal(result.branchSlots['other-01'].proposals, 1);
    assert.equal(result.items.length, 0);
    assert.equal(result.readOnly, true);
    assert.equal(result.writesToSource, false);
    assert.equal(result.semanticConflictChecked, false);
    assert.equal(result.hostConsentAuthenticated, false);
    assert.equal(result.evidenceBodyIntegrityVerified, false);
    assert.equal(result.projectWidePropagationImplemented, false);
    assert.equal(result.claimsCreated, 0);
    assert.equal(result.decisionsApplied, 0);
    assert.equal(result.promotionAllowed, false);
    const json = JSON.stringify(result);
    for (const forbidden of [SECRET, 'feature/secret', 'candidate-feature',
      'claim-feature-active', 'proposal-feature', 'e-feature', dbPath]) {
      assert.equal(json.includes(forbidden), false, forbidden);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n, before);
  });
});

test('claims return opaque refs, safe source metadata and no cross-project records', async () => {
  await fixture(async ({ dbPath }) => {
    const r = audit(dbPath, 'claims');
    assert.equal(r.items.length, 2);
    assert.equal(r.items[0].ref, ref('c', 'claim-feature-active'));
    assert.equal(r.items[0].branchSlot, 'other-01');
    assert.equal(r.items[0].state, 'active');
    assert.equal(r.items[0].primaryEvidence.authority, 'tool_observation');
    assert.equal(r.items[0].primaryEvidence.normalSensitivity, true);
    assert.equal(r.items[0].primaryEvidence.sameProjectAndBranch, true);
    assert.equal(r.items[1].ref, ref('c', 'claim-main-stale'));
    assert.equal(r.items[1].branchSlot, 'source');
  });
});

test('candidates include failed records and identify authority metadata drift', async () => {
  await fixture(async ({ db, dbPath }) => {
    db.prepare("UPDATE memory_candidates SET source_authority='user_direct' WHERE id='candidate-feature'").run();
    const r = audit(dbPath, 'candidates');
    assert.equal(r.items.length, 2);
    assert.equal(r.items[0].ref, ref('m', 'candidate-feature'));
    assert.equal(r.items[0].source.authority, 'tool_observation');
    assert.equal(r.items[0].sourceAuthorityAgrees, false);
    assert.equal(r.items[1].status, 'failed');
    assert.equal(r.items[1].sourceAuthorityAgrees, true);
  });
});

test('proposals flag missing, foreign and non-normal linked Evidence', async () => {
  await fixture(async ({ db, dbPath }) => {
    let r = audit(dbPath, 'proposals');
    assert.equal(r.items.length, 2);
    assert.equal(r.items[0].ref, ref('p', 'proposal-feature'));
    assert.equal(r.items[0].sourcesStructurallyReviewable, true);
    assert.equal(r.items[1].ref, ref('p', 'proposal-main'));
    db.prepare("UPDATE evidence SET sensitivity='secret_redacted' WHERE id='e-feature'").run();
    r = audit(dbPath, 'proposals');
    assert.equal(r.items[0].sourcesStructurallyReviewable, false);
    assert.equal(r.items[0].authorityClasses[0], 'tool_observation');
  });
});

test('missing table and unknown registered project never produce empty success', async () => {
  await fixture(async ({ db, dbPath }) => {
    assert.deepEqual(audit(dbPath, 'summary', { projectId: 'github.com/no/project' }).blockers,
      ['project_not_registered']);
    db.exec('DROP TABLE memory_evidence_proposal_evidence');
    assert.deepEqual(audit(dbPath, 'summary').blockers, ['required_ledger_missing']);
  });
});

test('guard against unsafe truncation instead of reporting partial inventories', async () => {
  await fixture(async ({ db, dbPath }) => {
    const insert = db.prepare('INSERT INTO memory_evidence_proposals ' +
      '(id,project_id,branch,kind,canonical_fact,status,policy_version,evaluator_id,' +
      'fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for (let i = 0; i < 1000; i++) {
      const id = 'extra-' + i;
      insert.run(id, PROJECT, MAIN, 'knowledge', SECRET, 'pending', 'v1',
        'synthetic', id, '2026-11-05T00:00:00.000Z');
    }
    const r = audit(dbPath, 'summary');
    assert.equal(r.status, 'blocked');
    assert.deepEqual(r.blockers, ['ledger_over_1000_records']);
    assert.equal(JSON.stringify(r).includes(SECRET), false);
  });
});

test('CLI rejects write, content, and unknown scopes and emits safe metadata', async () => {
  await fixture(async ({ dbPath }) => {
    const args = ['--db-path', dbPath, '--project-id', PROJECT,
      '--source-branch', MAIN, '--category', 'claims'];
    assert.equal(parseCrossBranchInventoryArgs(args).category, 'claims');
    assert.throws(() => parseCrossBranchInventoryArgs([...args, '--apply']), /option/u);
    assert.throws(() => parseCrossBranchInventoryArgs([...args, '--show-local-content']), /option/u);
    assert.throws(() => parseCrossBranchInventoryArgs([...args, '--category', 'proposals']), /option/u);
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).items.length, 2);
    assert.equal(result.stdout.includes(SECRET), false);
    const rejected = spawnSync(process.execPath, [SCRIPT, ...args, '--apply'], { encoding: 'utf8' });
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, '');
    assert.equal(rejected.stderr.includes(dbPath), false);
  });
});
