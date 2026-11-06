import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { EVIDENCE_PROPOSAL_SCHEMA_SQL } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  reconcileCrossBranchDecisionIntents, validateCrossBranchDecisionManifest,
  parseCrossBranchDecisionReconciliationArgs,
} from '../../scripts/reconcile-memory-cross-branch-decisions.mjs';

const PROJECT = 'github.com/example/streamer-content';
const FOREIGN = 'github.com/example/foreign';
const MAIN = 'main';
const B1 = 'feature/private-gallery';
const B2 = 'feature/private-qa';
const SECRET = 'TEST_PRIVATE_CANONICAL_FACT_DO_NOT_PRINT';
const EVIDENCE_TEXT = 'TEST_PRIVATE_SOURCE_BODY_DO_NOT_PRINT';
const SCRIPT = fileURLToPath(new URL(
  '../../scripts/reconcile-memory-cross-branch-decisions.mjs', import.meta.url,
));
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const pref = id => '~p' + sha(id).slice(0, 12);
const eref = id => '~e' + sha(id).slice(0, 12);

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'cross-branch-decisions-'));
  const dbPath = join(root, 'memory.sqlite3');
  const engine = new MemoryEngine({ dbPath });
  let db;
  try {
    engine.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
    engine.registerProject({ projectId: FOREIGN, repoIdentity: FOREIGN });
    for (const [id, project, branch, authority] of [
      ['ev-main', PROJECT, MAIN, 'user_direct'],
      ['ev-gallery', PROJECT, B1, 'user_direct'],
      ['ev-tool', PROJECT, B1, 'tool_observation'],
      ['ev-code', PROJECT, B2, 'tool_observation'],
      ['ev-foreign', FOREIGN, MAIN, 'user_direct'],
    ]) {
      engine.recordEvidence({
        id, projectId: project, branch, harness: 'codex',
        sessionId: EVIDENCE_TEXT, sourceKind: 'session',
        sourceRef: EVIDENCE_TEXT, capturedAt: '2026-11-05T00:00:00.000Z',
        content: EVIDENCE_TEXT, authorityClass: authority,
        metadata: { event_type: 'tool_output' },
      });
    }
    db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
    db.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);
    const insert = db.prepare(
      'INSERT INTO memory_evidence_proposals ' +
      '(id,project_id,branch,kind,canonical_fact,status,policy_version,evaluator_id,' +
      'fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    );
    const link = db.prepare(
      'INSERT INTO memory_evidence_proposal_evidence (proposal_id,evidence_id,linked_at) ' +
      'VALUES (?,?,?)',
    );
    const fixtures = [
      ['p-main', PROJECT, MAIN, 'procedure', 'needs_confirmation', 'ev-main'],
      ['p-gallery', PROJECT, B1, 'knowledge', 'needs_confirmation', 'ev-gallery'],
      ['p-tool', PROJECT, B1, 'procedure', 'pending', 'ev-tool'],
      ['p-code', PROJECT, B2, 'knowledge', 'pending', 'ev-code'],
      ['p-foreign', FOREIGN, MAIN, 'knowledge', 'pending', 'ev-foreign'],
    ];
    for (const [id, project, branch, kind, status, evidence] of fixtures) {
      insert.run(id, project, branch, kind, SECRET + id, status, 'v1',
        'test', id, '2026-11-05T00:00:00.000Z');
      link.run(id, evidence, '2026-11-05T00:00:00.000Z');
    }
    const items = [
      ['p-main', 'source', 'procedure', 'needs_confirmation', 'ev-main', 'user_direct',
        'retain_project_rule_for_review', 'project_wide_e2e_qa', 'explicit_user_confirmation'],
      ['p-gallery', 'other-02', 'knowledge', 'needs_confirmation', 'ev-gallery', 'user_direct',
        'retain_scoped_for_review', 'blender_gallery_only', 'explicit_user_confirmation'],
      ['p-tool', 'other-02', 'procedure', 'pending', 'ev-tool', 'tool_observation',
        'ignore_when_authorized', null, 'implementation_snapshot'],
      ['p-code', 'other-03', 'knowledge', 'pending', 'ev-code', 'tool_observation',
        'ignore_when_authorized', null, 'implementation_snapshot'],
    ];
    const manifest = {
      type: 'agent_hub_memory_cross_branch_manual_decision_intents_v1',
      scope: { projectId: PROJECT, sourceBranch: MAIN },
      origin: 'manual_chat_transcription_unverified',
      items: items.map(([
        id, expectedBranchGroup, expectedKind, expectedStatus,
        evidence, expectedAuthority, intent, targetScope, rationaleCode,
      ]) => ({
        proposalRef: pref(id),
        expectedBranchGroup, expectedKind, expectedStatus,
        canonicalFactSha256: sha(SECRET + id),
        evidenceRefs: [eref(evidence)], expectedAuthority,
        intent, targetScope, rationaleCode,
      })),
    };
    return await fn({ dbPath, root, db, manifest });
  } finally {
    db?.close();
    engine.close();
    await rm(root, { recursive: true, force: true });
  }
}
const inspect = (dbPath, manifest, more = {}) => reconcileCrossBranchDecisionIntents({
  dbPath, projectId: PROJECT, sourceBranch: MAIN, manifest, ...more,
});

test('matches entire multi-branch project without enabling writes, consent or production promotion', async () => {
  await fixture(async ({ db, dbPath, manifest }) => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_proposals').get().n;
    const report = inspect(dbPath, manifest);
    assert.equal(report.status, 'matched_read_only');
    assert.deepEqual(report.blockers, []);
    assert.deepEqual(report.coverage, {
      projectOpenTotal: 4, manifestItems: 4, exact: true,
      sourceAndOtherGroups: [
        { name: 'other-02', count: 2 }, { name: 'other-03', count: 1 },
        { name: 'source', count: 1 },
      ],
    });
    assert.deepEqual(report.decisionIntents, {
      ignoredForFutureAuthorization: 2,
      retainedProjectRuleForReview: 1,
      retainedGalleryRuleForReview: 1,
    });
    assert.equal(report.items.every(item => item.matching), true);
    assert.equal(report.readOnly, true);
    assert.equal(report.writesToSource, false);
    assert.equal(report.decisionsApplied, 0);
    assert.equal(report.claimsCreated, 0);
    assert.equal(report.promotionAllowed, false);
    assert.equal(report.hostConsentAuthenticated, false);
    assert.equal(report.semanticConflictChecked, false);
    assert.equal(report.evidenceBodyIntegrityVerified, false);
    assert.equal(report.sourceBodiesInspected, false);
    assert.equal(report.projectWidePropagationImplemented, false);
    const json = JSON.stringify(report);
    for (const forbidden of [SECRET, EVIDENCE_TEXT, B1, B2, 'ev-main',
      'p-gallery', 'p-code', dbPath, FOREIGN]) {
      assert.equal(json.includes(forbidden), false, forbidden);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_proposals').get().n, before);
  });
});

test('canonical fact, kind and status drift are item mismatches, no changed content leaked', async () => {
  await fixture(async ({ db, dbPath, manifest }) => {
    db.prepare("UPDATE memory_evidence_proposals SET canonical_fact=?, kind='preference', status='failed' WHERE id='p-tool'")
      .run('CHANGED_SECRET',);
    const report = inspect(dbPath, manifest);
    assert.equal(report.status, 'blocked');
    const problems = report.items.find(item => item.proposalRef === pref('p-tool')).blockers;
    assert.ok(problems.includes('canonical_fact_changed'));
    assert.ok(problems.includes('kind_changed'));
    assert.ok(problems.includes('status_changed'));
    assert.equal(JSON.stringify(report).includes('CHANGED_SECRET'), false);
  });
});

test('extra and disappeared project proposals block, foreign-project proposals are ignored', async () => {
  await fixture(async ({ db, dbPath, manifest }) => {
    db.prepare(
      'INSERT INTO memory_evidence_proposals ' +
      '(id,project_id,branch,kind,canonical_fact,status,policy_version,evaluator_id,' +
      'fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run('p-new', PROJECT, B2, 'knowledge', SECRET, 'pending', 'v1',
      'fixture', 'p-new', '2026-11-05T00:00:00.000Z');
    let report = inspect(dbPath, manifest);
    assert.equal(report.status, 'blocked');
    assert.ok(report.blockers.includes('incomplete_or_stale_project_coverage'));
    db.prepare("DELETE FROM memory_evidence_proposals WHERE id='p-new'").run();
    db.prepare("UPDATE memory_evidence_proposals SET status='ignored' WHERE id='p-code'").run();
    report = inspect(dbPath, manifest);
    assert.equal(report.status, 'blocked');
    assert.ok(report.items.find(item => item.proposalRef === pref('p-code'))
      .blockers.includes('proposal_not_open_in_scope'));
  });
});

test('branch-group binding detects moving or splitting proposal branches without printing them', async () => {
  await fixture(async ({ db, dbPath, manifest }) => {
    db.prepare("UPDATE memory_evidence_proposals SET branch=? WHERE id='p-tool'").run(B2);
    let report = inspect(dbPath, manifest);
    assert.equal(report.status, 'blocked');
    assert.ok(report.items.find(item => item.proposalRef === pref('p-tool'))
      .blockers.includes('branch_group_changed'));
    db.prepare("UPDATE memory_evidence_proposals SET branch=? WHERE id='p-main'").run(B1);
    report = inspect(dbPath, manifest);
    assert.equal(report.status, 'blocked');
    assert.ok(report.items.find(item => item.proposalRef === pref('p-main'))
      .blockers.includes('source_branch_mismatch'));
    assert.equal(JSON.stringify(report).includes(B1), false);
    assert.equal(JSON.stringify(report).includes(B2), false);
  });
});

test('linked Evidence authority, project, branch, sensitivity and ref changes block', async () => {
  await fixture(async ({ db, dbPath, manifest }) => {
    db.prepare("UPDATE evidence SET sensitivity='secret_redacted' WHERE id='ev-gallery'").run();
    let report = inspect(dbPath, manifest);
    assert.ok(report.items.find(item => item.proposalRef === pref('p-gallery'))
      .blockers.includes('evidence_scope_or_sensitivity_changed'));
    db.prepare("UPDATE evidence SET sensitivity='normal', authority_class='agent_inference' WHERE id='ev-gallery'").run();
    report = inspect(dbPath, manifest);
    assert.ok(report.items.find(item => item.proposalRef === pref('p-gallery'))
      .blockers.includes('evidence_authority_changed'));
    db.prepare('UPDATE evidence SET authority_class=?, project_id=? WHERE id=?')
      .run('user_direct', FOREIGN, 'ev-gallery');
    report = inspect(dbPath, manifest);
    assert.ok(report.items.find(item => item.proposalRef === pref('p-gallery'))
      .blockers.includes('evidence_scope_or_sensitivity_changed'));
    db.prepare("UPDATE evidence SET project_id=? WHERE id='ev-gallery'").run(PROJECT);
    db.prepare("DELETE FROM memory_evidence_proposal_evidence WHERE proposal_id='p-gallery'").run();
    report = inspect(dbPath, manifest);
    assert.ok(report.items.find(item => item.proposalRef === pref('p-gallery'))
      .blockers.includes('unexpected_evidence_count'));
  });
});

test('rejects fake host approval, extra fields, duplicate refs, and invalid retained scope', async () => {
  await fixture(async ({ dbPath, manifest }) => {
    const scope = { projectId: PROJECT, sourceBranch: MAIN };
    assert.equal(validateCrossBranchDecisionManifest(manifest, scope), manifest);
    assert.throws(() => validateCrossBranchDecisionManifest({ ...manifest, approved: true }, scope));
    assert.throws(() => validateCrossBranchDecisionManifest({
      ...manifest, origin: 'host_authenticated',
    }, scope));
    assert.throws(() => validateCrossBranchDecisionManifest({
      ...manifest, items: [...manifest.items, manifest.items[0]],
    }, scope));
    assert.throws(() => validateCrossBranchDecisionManifest({
      ...manifest, items: [{
        ...manifest.items[0], targetScope: 'blender_gallery_only',
      }, ...manifest.items.slice(1)],
    }, scope));
    assert.throws(() => validateCrossBranchDecisionManifest({
      ...manifest, items: [{
        ...manifest.items[1], expectedAuthority: 'tool_observation',
      }, ...manifest.items.slice(1)],
    }, scope));
    assert.throws(() => validateCrossBranchDecisionManifest({
      ...manifest, scope: { projectId: FOREIGN, sourceBranch: MAIN },
    }, scope));
    assert.throws(() => parseCrossBranchDecisionReconciliationArgs(['--apply']));
    assert.throws(() => parseCrossBranchDecisionReconciliationArgs([
      '--db-path', dbPath, '--db-path', dbPath,
    ]));
  });
});

test('missing required ledger and unknown project fail closed', async () => {
  await fixture(async ({ db, dbPath, manifest }) => {
    assert.deepEqual(inspect(dbPath, manifest, { projectId: 'github.com/not/registered' })
      .blockers, ['project_not_registered']);
    db.exec('DROP TABLE memory_evidence_proposal_evidence');
    assert.deepEqual(inspect(dbPath, manifest).blockers, ['required_ledger_missing']);
  });
});

test('CLI reads private local manifest, returns only metadata, rejects write flags', async () => {
  await fixture(async ({ root, dbPath, manifest }) => {
    const path = join(root, 'private-review-intents.json');
    await writeFile(path, JSON.stringify(manifest), { encoding: 'utf8', mode: 0o600 });
    const args = [
      '--db-path', dbPath, '--project-id', PROJECT,
      '--source-branch', MAIN, '--decisions-file', path,
    ];
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).coverage.projectOpenTotal, 4);
    for (const forbidden of [SECRET, EVIDENCE_TEXT, dbPath, path, B1, B2]) {
      assert.equal(result.stdout.includes(forbidden), false, forbidden);
    }
    for (const badFlag of ['--apply', '--show-local-content', '--approve']) {
      const rejected = spawnSync(process.execPath, [SCRIPT, ...args, badFlag],
        { encoding: 'utf8' });
      assert.equal(rejected.status, 1);
      assert.equal(rejected.stdout, '');
      assert.equal(rejected.stderr.includes(dbPath), false);
    }
  });
});
