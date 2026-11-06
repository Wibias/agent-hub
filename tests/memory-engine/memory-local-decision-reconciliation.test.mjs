import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { EVIDENCE_PROPOSAL_SCHEMA_SQL } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  parseDecisionReconciliationArgs, validateDecisionIntentManifest,
  reconcileLocalDecisionIntents,
} from '../../scripts/reconcile-memory-review-decisions.mjs';

const PROJECT = 'github.com/test/app';
const OTHER = 'github.com/test/other';
const BRANCH = 'main';
const PRIVATE = 'SYNTHETIC_PRIVATE_FACT_DO_NOT_PRINT';
const PRIVATE_SOURCE = 'SYNTHETIC_PRIVATE_EVIDENCE_DO_NOT_PRINT';
const SCRIPT = fileURLToPath(new URL('../../scripts/reconcile-memory-review-decisions.mjs', import.meta.url));
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const pref = id => '~p' + hash(id).slice(0, 12);
const eref = id => '~e' + hash(id).slice(0, 12);

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'memory-review-reconciliation-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  let db;
  try {
    memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
    memory.registerProject({ projectId: OTHER, repoIdentity: OTHER });
    for (const [id, authority] of [
      ['user-evidence', 'user_direct'],
      ['tool-evidence', 'tool_observation'],
    ]) {
      memory.recordEvidence({
        id, projectId: PROJECT, branch: BRANCH, harness: 'codex',
        sessionId: 'test-session', sourceKind: 'session', sourceRef: 'synthetic',
        capturedAt: '2026-11-05T00:00:00.000Z',
        content: PRIVATE_SOURCE, authorityClass: authority,
        metadata: { event_type: authority === 'user_direct' ? 'user_prompt' : 'tool_output' },
      });
    }
    db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
    db.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);
    const ins = db.prepare(
      'INSERT INTO memory_evidence_proposals ' +
      '(id,project_id,branch,kind,canonical_fact,status,policy_version,evaluator_id,fingerprint,created_at) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?)',
    );
    const link = db.prepare(
      'INSERT INTO memory_evidence_proposal_evidence ' +
      '(proposal_id,evidence_id,linked_at) VALUES (?,?,?)',
    );
    for (const [id, status, evidence] of [
      ['proposal-direct', 'needs_confirmation', 'user-evidence'],
      ['proposal-tool', 'pending', 'tool-evidence'],
    ]) {
      ins.run(id, PROJECT, BRANCH, 'procedure', PRIVATE + id, status,
        'v1', 'synthetic', id, '2026-11-05T00:00:00.000Z');
      link.run(id, evidence, '2026-11-05T00:00:00.000Z');
    }
    const manifest = {
      type: 'agent_hub_memory_manual_decision_intents_v1',
      scope: { projectId: PROJECT, branch: BRANCH },
      origin: 'manual_chat_transcription_unverified',
      items: [
        {
          proposalRef: pref('proposal-direct'),
          expectedKind: 'procedure', expectedStatus: 'needs_confirmation',
          canonicalFactSha256: hash(PRIVATE + 'proposal-direct'),
          evidenceRefs: [eref('user-evidence')], expectedAuthority: 'user_direct',
          intent: 'retain_project_rule_for_review', rationaleCode: 'explicit_user_confirmation',
        },
        {
          proposalRef: pref('proposal-tool'),
          expectedKind: 'procedure', expectedStatus: 'pending',
          canonicalFactSha256: hash(PRIVATE + 'proposal-tool'),
          evidenceRefs: [eref('tool-evidence')], expectedAuthority: 'tool_observation',
          intent: 'ignore_when_authorized', rationaleCode: 'tool_guidance',
        },
      ],
    };
    return await fn({ db, dbPath, root, manifest });
  } finally {
    db?.close();
    memory.close();
    await rm(root, { recursive: true, force: true });
  }
}

const inspect = ({ dbPath, manifest, ...more }) => reconcileLocalDecisionIntents({
  dbPath, projectId: PROJECT, branch: BRANCH, manifest, ...more,
});

test('exact scoped intent manifest matches but never authenticates consent or applies decisions', async () => {
  await fixture(async ({ db, dbPath, manifest }) => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_proposals').get().n;
    const report = inspect({ dbPath, manifest });
    assert.equal(report.status, 'matched_read_only');
    assert.deepEqual(report.blockers, []);
    assert.equal(report.coverage.exact, true);
    assert.equal(report.coverage.scopedOpenTotal, 2);
    assert.deepEqual(report.decisionIntents, {
      retainForFutureReview: 1, ignoreWhenAuthorized: 1,
    });
    for (const key of ['readOnly', 'hostConsentAuthenticated']) {
      assert.equal(report[key], key === 'readOnly');
    }
    assert.equal(report.writesToSource, false);
    assert.equal(report.decisionsApplied, 0);
    assert.equal(report.claimsCreated, 0);
    assert.equal(report.promotionAllowed, false);
    assert.equal(report.semanticConflictChecked, false);
    assert.equal(report.projectWidePropagationImplemented, false);
    assert.equal(report.contentIncluded, false);
    assert.equal(report.claimComparison.semanticConflictDetected, null);
    assert.equal(report.items.every(i => i.matching), true);
    const raw = JSON.stringify(report);
    for (const forbidden of [PRIVATE, PRIVATE_SOURCE, 'proposal-direct',
      'user-evidence', dbPath, 'test-session']) {
      assert.equal(raw.includes(forbidden), false, forbidden);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_evidence_proposals').get().n, before);
  });
});

test('canonical text changes are detected even when proposal IDs and evidence refs stay fixed', async () => {
  await fixture(async ({ db, dbPath, manifest }) => {
    db.prepare('UPDATE memory_evidence_proposals SET canonical_fact=? WHERE id=?')
      .run('CHANGED_PRIVATE_VALUE', 'proposal-direct');
    const report = inspect({ dbPath, manifest });
    assert.equal(report.status, 'blocked');
    assert.ok(report.items[0].blockers.includes('proposal_content_changed'));
    assert.equal(JSON.stringify(report).includes('CHANGED_PRIVATE_VALUE'), false);
  });
});

test('status drift, unexpected open proposals, and missing referenced proposals block the whole review', async () => {
  await fixture(async ({ db, dbPath, manifest }) => {
    db.prepare("UPDATE memory_evidence_proposals SET status='failed' WHERE id='proposal-tool'").run();
    let report = inspect({ dbPath, manifest });
    assert.equal(report.status, 'blocked');
    assert.ok(report.items[1].blockers.includes('status_changed'));
    db.prepare("UPDATE memory_evidence_proposals SET status='ignored' WHERE id='proposal-tool'").run();
    report = inspect({ dbPath, manifest });
    assert.equal(report.status, 'blocked');
    assert.ok(report.blockers.includes('incomplete_or_stale_scope_coverage'));
    assert.ok(report.items[1].blockers.includes('proposal_not_open_in_scope'));
  });
});

test('linked evidence scope, sensitivity, authority, and linkage drift are blockers', async () => {
  await fixture(async ({ db, dbPath, manifest }) => {
    db.prepare("UPDATE evidence SET sensitivity='secret_redacted' WHERE id='tool-evidence'").run();
    let report = inspect({ dbPath, manifest });
    assert.ok(report.items[1].blockers.includes('linked_evidence_not_safe_in_scope'));
    db.prepare("UPDATE evidence SET sensitivity='normal', authority_class='agent_inference' WHERE id='tool-evidence'").run();
    report = inspect({ dbPath, manifest });
    assert.ok(report.items[1].blockers.includes('source_authority_changed'));
    db.prepare("UPDATE evidence SET authority_class='tool_observation', project_id=? WHERE id='tool-evidence'")
      .run(OTHER);
    report = inspect({ dbPath, manifest });
    assert.ok(report.items[1].blockers.includes('linked_evidence_not_safe_in_scope'));
    db.prepare("UPDATE evidence SET project_id=? WHERE id='tool-evidence'").run(PROJECT);
    db.prepare("DELETE FROM memory_evidence_proposal_evidence WHERE proposal_id='proposal-tool'").run();
    report = inspect({ dbPath, manifest });
    assert.ok(report.items[1].blockers.includes('evidence_links_changed'));
  });
});

test('missing schema and incomplete scoped manifest cannot report matched', async () => {
  await fixture(async ({ db, dbPath, manifest }) => {
    const incomplete = { ...manifest, items: [manifest.items[0]] };
    assert.equal(inspect({ dbPath, manifest: incomplete }).status, 'blocked');
    db.exec('DROP TABLE memory_evidence_proposal_relations');
    assert.deepEqual(inspect({ dbPath, manifest }).blockers, ['required_ledger_missing']);
  });
});

test('strict manifest rejects duplicates, unexpected fields, fake approval assertions and cross-scope', async () => {
  await fixture(async ({ dbPath, manifest }) => {
    const scope = { projectId: PROJECT, branch: BRANCH };
    assert.equal(validateDecisionIntentManifest(manifest, scope), manifest);
    assert.throws(() => validateDecisionIntentManifest(manifest, { ...scope, branch: 'feature' }));
    assert.throws(() => validateDecisionIntentManifest({ ...manifest, approved: true }, scope));
    assert.throws(() => validateDecisionIntentManifest({
      ...manifest, origin: 'host_authenticated',
    }, scope));
    assert.throws(() => validateDecisionIntentManifest({
      ...manifest, items: [manifest.items[0], manifest.items[0]],
    }, scope));
    assert.throws(() => validateDecisionIntentManifest({
      ...manifest, items: [{ ...manifest.items[0], rationale: PRIVATE }, manifest.items[1]],
    }, scope));
    assert.throws(() => validateDecisionIntentManifest({
      ...manifest, items: [{ ...manifest.items[0], expectedAuthority: 'agent_inference' }, manifest.items[1]],
    }, scope));
    assert.throws(() => parseDecisionReconciliationArgs(['--apply']));
    assert.throws(() => parseDecisionReconciliationArgs([
      '--db-path', dbPath, '--db-path', dbPath,
    ]));
    assert.throws(() => parseDecisionReconciliationArgs(['--show-local-content']));
  });
});

test('CLI accepts the local JSON file and never emits private fact text or source paths', async () => {
  await fixture(async ({ dbPath, root, manifest }) => {
    const path = join(root, 'review-intents.json');
    await writeFile(path, JSON.stringify(manifest), { encoding: 'utf8', mode: 0o600 });
    const args = [
      '--db-path', dbPath, '--project-id', PROJECT,
      '--branch', BRANCH, '--decisions-file', path,
    ];
    const cli = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    const report = JSON.parse(cli.stdout);
    assert.equal(report.status, 'matched_read_only');
    for (const forbidden of [PRIVATE, PRIVATE_SOURCE, dbPath, path]) {
      assert.equal(cli.stdout.includes(forbidden), false, forbidden);
    }
    const rejected = spawnSync(process.execPath, [SCRIPT, ...args, '--apply'], { encoding: 'utf8' });
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, '');
    assert.equal(rejected.stderr.includes(path), false);
  });
});
