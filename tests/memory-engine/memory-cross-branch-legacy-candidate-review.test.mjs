import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  inspectLegacyCandidateEvidence, parseLegacyCandidateReviewArgs,
} from '../../scripts/inspect-memory-cross-branch-legacy-candidates.mjs';

const PROJECT = 'github.com/example/streamer-content';
const FOREIGN = 'github.com/example/foreign';
const MAIN = 'main';
const BRANCH = 'feature/hidden-gallery';
const SECRET = 'SYNTHETIC_SECRET_VALUE_NOT_FOR_METADATA_OUTPUT';
const SOURCE_TEXT = 'SYNTHETIC_SECRET_SOURCE_NOT_FOR_METADATA_OUTPUT';
const CLI = fileURLToPath(new URL(
  '../../scripts/inspect-memory-cross-branch-legacy-candidates.mjs', import.meta.url,
));
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
const ref = id => '~m' + hash(id);
const eref = id => '~e' + hash(id);

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'candidate-review-'));
  const dbPath = join(root, 'memory.sqlite3');
  const engine = new MemoryEngine({ dbPath });
  let db;
  try {
    engine.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
    engine.registerProject({ projectId: FOREIGN, repoIdentity: FOREIGN });
    const evidence = [
      ['ev-main', PROJECT, MAIN, 'user_direct'],
      ['ev-other', PROJECT, BRANCH, 'user_direct'],
      ['ev-foreign', FOREIGN, BRANCH, 'user_direct'],
    ];
    for (const [id, project, branch, authority] of evidence) {
      engine.recordEvidence({
        id, projectId: project, branch, harness: 'codex', sessionId: 'test-session',
        sourceKind: 'session', sourceRef: 'test-ref',
        capturedAt: '2026-11-05T00:00:00.000Z',
        content: SOURCE_TEXT + id, authorityClass: authority,
        metadata: { event_type: 'user_prompt' },
      });
    }
    db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
    const insert = db.prepare(
      'INSERT INTO memory_candidates (id,project_id,branch,source_evidence_id,' +
      'proposed_type,proposed_value,source_authority,status,decision_reason,' +
      'created_at,policy_version,fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    for (const [id, project, branch, evidenceId, type, status] of [
      ['c-main', PROJECT, MAIN, 'ev-main', 'constraint', 'pending'],
      ['c-other', PROJECT, BRANCH, 'ev-other', 'preference', 'pending'],
      ['c-foreign', FOREIGN, BRANCH, 'ev-foreign', 'preference', 'pending'],
    ]) {
      insert.run(id, project, branch, evidenceId, type, SECRET + id,
        'user_direct', status, 'test decision', '2026-11-05T00:00:00.000Z', 'v1', id);
    }
    return await fn({ db, dbPath });
  } finally {
    db?.close();
    engine.close();
    await rm(root, { recursive: true, force: true });
  }
}
const inspect = ({ dbPath, ...more }) => inspectLegacyCandidateEvidence({
  dbPath, projectId: PROJECT, sourceBranch: MAIN,
  candidateRefs: [ref('c-main'), ref('c-other')], ...more,
});

test('read-only metadata review supports explicit cross-branch refs without secrets', async () => {
  await fixture(async ({ db, dbPath }) => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM memory_candidates').get().n;
    const report = inspect({ dbPath });
    assert.equal(report.status, 'manual_candidate_review_required');
    assert.equal(report.projectOpenCandidates, 2);
    assert.equal(report.contentIncluded, false);
    assert.equal(report.readOnly, true);
    assert.equal(report.writesToSource, false);
    assert.equal(report.decisionsApplied, 0);
    assert.equal(report.candidatesPromoted, 0);
    assert.equal(report.claimsCreated, 0);
    assert.equal(report.promotionAllowed, false);
    assert.equal(report.hostConsentAuthenticated, false);
    assert.equal(report.semanticConflictChecked, false);
    assert.equal(report.evidenceBodyIntegrityVerified, false);
    assert.equal(report.items[0].proposedType, 'constraint');
    assert.equal(report.items[0].sameAsSourceBranch, true);
    assert.equal(report.items[1].sameAsSourceBranch, false);
    assert.equal(report.items[1].source.evidenceRef, eref('ev-other'));
    assert.equal(report.items.every(item => item.matching), true);
    const metadata = JSON.stringify(report);
    for (const forbidden of [SECRET, SOURCE_TEXT, BRANCH, 'c-main', 'ev-other', dbPath]) {
      assert.equal(metadata.includes(forbidden), false, forbidden);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_candidates').get().n, before);
  });
});

test('explicit content opt-in displays only bounded excerpts without changing data', async () => {
  await fixture(async ({ db, dbPath }) => {
    const report = inspect({ dbPath, showLocalContent: true });
    assert.equal(report.status, 'manual_candidate_review_required');
    assert.equal(report.contentIncluded, true);
    assert.match(report.items[0].localProposedValueExcerpt.text, /SYNTHETIC_SECRET_VALUE/u);
    assert.match(report.items[0].source.localRedactedEvidenceExcerpt.text, /SYNTHETIC_SECRET_SOURCE/u);
    assert.equal(report.items[0].localProposedValueExcerpt.truncated, false);
    assert.equal(db.prepare('SELECT status FROM memory_candidates WHERE id=?')
      .get('c-main').status, 'pending');
  });
});

test('missing and no-longer-open candidates block all output without leaking facts', async () => {
  await fixture(async ({ db, dbPath }) => {
    db.prepare("UPDATE memory_candidates SET status='ignored' WHERE id='c-other'").run();
    const report = inspect({ dbPath, showLocalContent: true });
    assert.equal(report.status, 'blocked');
    assert.equal(report.contentIncluded, false);
    assert.ok(report.items[1].blockers.includes('candidate_not_open_in_project'));
    assert.equal(JSON.stringify(report).includes(SECRET), false);
    assert.equal(JSON.stringify(report).includes(SOURCE_TEXT), false);
  });
});

test('source authority and sensitivity mismatch block; content does not escape a blocked batch', async () => {
  await fixture(async ({ db, dbPath }) => {
    db.prepare("UPDATE evidence SET authority_class='agent_inference' WHERE id='ev-other'").run();
    let report = inspect({ dbPath, showLocalContent: true });
    assert.equal(report.status, 'blocked');
    assert.ok(report.items[1].blockers.includes('authority_mismatch'));
    assert.equal(report.contentIncluded, false);
    assert.equal(JSON.stringify(report).includes(SECRET), false);
    db.prepare("UPDATE evidence SET authority_class='user_direct', sensitivity='secret_redacted' WHERE id='ev-other'").run();
    report = inspect({ dbPath });
    assert.equal(report.status, 'blocked');
    assert.ok(report.items[1].blockers.includes('source_not_safe_in_scope'));
  });
});

test('exact project boundary rejects foreign project selection and malformed selections', async () => {
  await fixture(async ({ dbPath }) => {
    const report = inspect({ dbPath, candidateRefs: [ref('c-foreign')] });
    assert.equal(report.status, 'blocked');
    assert.ok(report.items[0].blockers.includes('candidate_not_open_in_project'));
    assert.throws(() => inspect({ dbPath, candidateRefs: [ref('c-main'), ref('c-main')] }));
    assert.throws(() => inspect({ dbPath, candidateRefs: ['raw-db-id'] }));
  });
});

test('CLI refuses content when output is piped and rejects mutation and unsafe options', async () => {
  await fixture(async ({ dbPath }) => {
    const args = [
      '--db-path', dbPath, '--project-id', PROJECT,
      '--source-branch', MAIN, '--candidate-refs', ref('c-main') + ',' + ref('c-other'),
    ];
    const ok = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).contentIncluded, false);
    const blocked = spawnSync(process.execPath, [CLI, ...args, '--show-local-content'],
      { encoding: 'utf8' });
    assert.equal(blocked.status, 1);
    assert.equal(blocked.stdout, '');
    for (const forbidden of [SECRET, SOURCE_TEXT, BRANCH, dbPath]) {
      assert.equal(ok.stdout.includes(forbidden), false, forbidden);
      assert.equal(blocked.stderr.includes(forbidden), false, forbidden);
    }
    for (const flag of ['--apply', '--promote', '--approve', '--output-file']) {
      const rejected = spawnSync(process.execPath, [CLI, ...args, flag],
        { encoding: 'utf8' });
      assert.equal(rejected.status, 1);
      assert.equal(rejected.stdout, '');
    }
  });
});

test('missing ledger and project registration block without leaking source', async () => {
  await fixture(async ({ db, dbPath }) => {
    const wrongProject = inspectLegacyCandidateEvidence({
      dbPath, projectId: 'github.com/example/missing',
      sourceBranch: MAIN, candidateRefs: [ref('c-main')],
    });
    assert.deepEqual(wrongProject.blockers, ['project_not_registered']);
    db.exec('DROP TABLE memory_candidates');
    const report = inspect({ dbPath });
    assert.deepEqual(report.blockers, ['required_ledger_missing']);
  });
});

test('strict CLI selection parser rejects duplicate and malformed refs', () => {
  const a = ['--db-path', '/tmp/x', '--project-id', PROJECT, '--source-branch', MAIN];
  assert.throws(() => parseLegacyCandidateReviewArgs([...a, '--candidate-refs', ref('c-main') + ',' + ref('c-main')]));
  assert.throws(() => parseLegacyCandidateReviewArgs([...a, '--candidate-refs', 'c-main']));
  assert.throws(() => parseLegacyCandidateReviewArgs([...a, '--candidate-refs', ref('c-main'), '--apply']));
  assert.throws(() => parseLegacyCandidateReviewArgs([...a, '--candidate-refs', ref('c-main'), '--candidate-refs', ref('c-other')]));
  const parsed = parseLegacyCandidateReviewArgs([
    ...a, '--candidate-refs', ref('c-main') + ',' + ref('c-other'),
  ]);
  assert.equal(parsed.candidateRefs.length, 2);
});
