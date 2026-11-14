import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { EVIDENCE_PROPOSAL_SCHEMA_SQL } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  parseLegacyCandidateExportArgs, buildLegacyCandidateReviewExport,
  exportLegacyCandidateReviewFile,
} from '../../scripts/export-memory-legacy-candidates-private.mjs';

const PROJECT = 'github.com/test/streamer-content';
const FOREIGN = 'github.com/test/other';
const MAIN = 'main';
const OTHER_A = 'feature/gallery-private';
const OTHER_B = 'feature/unrelated-private';
const SECRET = 'SYNTHETIC_PRIVATE_CANDIDATE_VALUE';
const SOURCE_SECRET = 'SYNTHETIC_PRIVATE_SOURCE_EVIDENCE';
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const cli = fileURLToPath(new URL(
  '../../scripts/export-memory-legacy-candidates-private.mjs', import.meta.url,
));

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'legacy-candidate-private-export-'));
  const dbPath = join(root, 'memory.sqlite3');
  const engine = new MemoryEngine({ dbPath });
  let db;
  try {
    engine.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
    engine.registerProject({ projectId: FOREIGN, repoIdentity: FOREIGN });
    const evidenceRows = [
      ['source-main', PROJECT, MAIN],
      ['source-gallery', PROJECT, OTHER_A],
      ['source-unrelated', PROJECT, OTHER_B],
      ['foreign-source', FOREIGN, MAIN],
    ];
    for (const [id, projectId, branch] of evidenceRows) {
      engine.recordEvidence({
        id, projectId, branch, harness: 'codex', sessionId: 'private-session',
        sourceKind: 'session', sourceRef: 'private-source',
        capturedAt: '2026-11-05T00:00:00.000Z',
        content: SOURCE_SECRET + id, authorityClass: 'user_direct',
        metadata: { event_type: 'user_prompt' },
      });
    }
    db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
    db.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);
    const insert = db.prepare(
      'INSERT INTO memory_candidates ' +
      '(id,project_id,branch,source_evidence_id,proposed_type,proposed_value,' +
      'source_authority,status,decision_reason,created_at,policy_version,fingerprint) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    for (const [id, project, branch, source, type] of [
      ['main-one', PROJECT, MAIN, 'source-main', 'constraint'],
      ['gallery-one', PROJECT, OTHER_A, 'source-gallery', 'decision'],
      ['other-one', PROJECT, OTHER_B, 'source-unrelated', 'preference'],
      ['foreign-one', FOREIGN, MAIN, 'foreign-source', 'preference'],
    ]) {
      insert.run(id, project, branch, source, type, SECRET + id,
        'user_direct', 'pending', 'test-reason',
        '2026-11-05T00:00:00.000Z', 'v1', id);
    }
    return await fn({ db, dbPath, root });
  } finally {
    db?.close();
    engine.close();
    await rm(root, { recursive: true, force: true });
  }
}
const build = dbPath => buildLegacyCandidateReviewExport({
  dbPath, projectId: PROJECT, sourceBranch: MAIN, expectedCount: 3,
});
const runExport = (dbPath, root) => exportLegacyCandidateReviewFile({
  dbPath, projectId: PROJECT, sourceBranch: MAIN, expectedCount: 3,
  outputFile: join(root, 'private-candidates.json'),
});

test('complete inventory exports 3 scoped candidates with expected fields and grouped branches', async () => {
  await fixture(async ({ db, dbPath, root }) => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM memory_candidates').get().n;
    const receipt = runExport(dbPath, root);
    assert.equal(receipt.status, 'private_local_export_created');
    assert.equal(receipt.candidatesExported, 3);
    assert.equal(receipt.databaseReadOnly, true);
    assert.equal(receipt.decisionsApplied, 0);
    assert.equal(receipt.claimsCreated, 0);
    assert.equal(receipt.hostConsentAuthenticated, false);
    assert.equal(receipt.promotionAllowed, false);
    assert.equal(receipt.privateContentPrinted, false);
    assert.equal(receipt.outputPathIncluded, false);
    assert.equal(JSON.stringify(receipt).includes(SECRET), false);
    assert.equal(JSON.stringify(receipt).includes(dbPath), false);
    const bytes = await readFile(join(root, 'private-candidates.json'));
    const data = JSON.parse(bytes);
    assert.equal(hash(bytes.toString('utf8')), receipt.sha256);
    assert.equal(data.status, 'ready_for_private_local_export');
    assert.equal(data.inventory.returnedCount, 3);
    assert.equal(data.inventory.complete, true);
    assert.deepEqual(data.inventory.branchSlots, ['other-01', 'other-02', 'source']);
    assert.deepEqual(data.items.map(item => item.proposedType).sort(),
      ['constraint', 'decision', 'preference']);
    assert.deepEqual(data.items.map(item => item.branchSlot).sort(),
      ['other-01', 'other-02', 'source']);
    assert.equal(data.items.every(item =>
      item.source.authority === 'user_direct'
      && item.source.normalSensitivity && item.source.sourceAuthorityAgrees), true);
    assert.equal(bytes.toString('utf8').includes(SECRET), true);
    assert.equal(bytes.toString('utf8').includes(SOURCE_SECRET), true);
    assert.equal(bytes.toString('utf8').includes(OTHER_A), false);
    assert.equal(bytes.toString('utf8').includes(OTHER_B), false);
    assert.equal(bytes.toString('utf8').includes('private-session'), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_candidates').get().n, before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory_candidates WHERE status='pending'").get().n, 4);
  });
});

test('exclusive output path forbids overwrite; existing JSON stays byte-for-byte untouched', async () => {
  await fixture(async ({ dbPath, root }) => {
    const outputFile = join(root, 'private-candidates.json');
    await writeFile(outputFile, 'DO_NOT_OVERWRITE');
    assert.throws(() => runExport(dbPath, root), /EEXIST|file already exists/u);
    assert.equal(await readFile(outputFile, 'utf8'), 'DO_NOT_OVERWRITE');
  });
});

test('changed expected count fails closed before any export is written', async () => {
  await fixture(async ({ dbPath, root }) => {
    const outputFile = join(root, 'private-candidates.json');
    const report = exportLegacyCandidateReviewFile({
      dbPath, projectId: PROJECT, sourceBranch: MAIN,
      expectedCount: 67, outputFile,
    });
    assert.equal(report.status, 'blocked');
    assert.deepEqual(report.blockers, ['candidate_count_changed']);
    assert.equal(existsSync(outputFile), false);
    assert.equal(JSON.stringify(report).includes(SECRET), false);
  });
});

test('foreign evidence, authority drift, or unsafe sensitivity blocks entire export without content', async () => {
  await fixture(async ({ db, dbPath, root }) => {
    const outputFile = join(root, 'private-candidates.json');
    db.prepare("UPDATE evidence SET authority_class='agent_inference' WHERE id='source-gallery'").run();
    let report = runExport(dbPath, root);
    assert.equal(report.status, 'blocked');
    assert.deepEqual(report.blockers, ['source_authority_changed']);
    assert.equal(existsSync(outputFile), false);
    db.prepare("UPDATE evidence SET authority_class='user_direct', sensitivity='secret_redacted' WHERE id='source-gallery'").run();
    report = runExport(dbPath, root);
    assert.deepEqual(report.blockers, ['linked_evidence_not_safe_in_scope']);
    db.prepare("UPDATE evidence SET sensitivity='normal', project_id=? WHERE id='source-gallery'").run(FOREIGN);
    report = runExport(dbPath, root);
    assert.deepEqual(report.blockers, ['linked_evidence_not_safe_in_scope']);
    assert.equal(JSON.stringify(report).includes(SOURCE_SECRET), false);
  });
});

test('explicit excerpts are bounded and truncation flagged but full hashes remain available', async () => {
  await fixture(async ({ db, dbPath }) => {
    const longValue = 'V'.repeat(3500);
    const longSource = 'S'.repeat(11000);
    db.prepare("UPDATE memory_candidates SET proposed_value=? WHERE id='main-one'")
      .run(longValue);
    db.prepare("UPDATE evidence SET content_redacted=? WHERE id='source-main'")
      .run(longSource);
    const report = build(dbPath);
    assert.equal(report.status, 'ready_for_private_local_export');
    assert.equal(report.inventory.truncatedCandidates, 1);
    assert.equal(report.inventory.truncatedEvidence, 1);
    const main = report.items.find(item => item.branchSlot === 'source');
    assert.equal(main.proposedValue.truncated, true);
    assert.equal(main.proposedValue.text.length, 2500);
    assert.equal(main.proposedValue.originalSha256, hash(longValue));
    assert.equal(main.source.redactedEvidence.truncated, true);
    assert.equal(main.source.redactedEvidence.text.length, 8000);
    assert.equal(main.source.redactedEvidence.originalSha256, hash(longSource));
  });
});

test('missing ledger, missing project and missing source rows block', async () => {
  await fixture(async ({ db, dbPath }) => {
    const missing = buildLegacyCandidateReviewExport({
      dbPath, projectId: 'github.com/missing/repo', sourceBranch: MAIN,
      expectedCount: 3,
    });
    assert.deepEqual(missing.blockers, ['project_not_registered']);
    db.prepare("UPDATE memory_candidates SET source_evidence_id='source-unrelated' WHERE id='gallery-one'")
      .run();
    assert.deepEqual(build(dbPath).blockers, ['linked_evidence_not_safe_in_scope']);
    db.prepare("UPDATE memory_candidates SET source_evidence_id='source-gallery' WHERE id='gallery-one'").run();
    db.exec('DROP TABLE memory_evidence_proposals');
    assert.deepEqual(build(dbPath).blockers, ['required_ledger_missing']);
  });
});

test('strict CLI parser requires consent flag, exact expected-count, JSON destination and rejects mutation controls', () => {
  const good = [
    '--db-path', '/tmp/memory.sqlite3', '--project-id', PROJECT,
    '--source-branch', MAIN, '--expected-count', '3',
    '--output-file', '/tmp/private.json', '--include-local-redacted-content',
  ];
  assert.equal(parseLegacyCandidateExportArgs(good).expectedCount, 3);
  assert.throws(() => parseLegacyCandidateExportArgs(good.filter(x =>
    x !== '--include-local-redacted-content')));
  assert.throws(() => parseLegacyCandidateExportArgs([
    ...good, '--apply',
  ]));
  assert.throws(() => parseLegacyCandidateExportArgs([
    ...good, '--promote',
  ]));
  assert.throws(() => parseLegacyCandidateExportArgs([
    ...good, '--expected-count', '4',
  ]));
  assert.throws(() => parseLegacyCandidateExportArgs(
    good.map(x => x === '3' ? '0' : x)));
  assert.throws(() => parseLegacyCandidateExportArgs(
    good.map(x => x === '/tmp/private.json' ? '/tmp/memory.sqlite3' : x)));
  assert.throws(() => parseLegacyCandidateExportArgs(
    good.map(x => x === '/tmp/private.json' ? '/tmp/private.txt' : x)));
});

test('CLI in a pipe rejects private content with no stdout and no local export', async () => {
  await fixture(async ({ dbPath, root }) => {
    const outputFile = join(root, 'private-candidates.json');
    const result = spawnSync(process.execPath, [cli,
      '--db-path', dbPath, '--project-id', PROJECT,
      '--source-branch', MAIN, '--expected-count', '3',
      '--output-file', outputFile, '--include-local-redacted-content',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(existsSync(outputFile), false);
    for (const forbidden of [SECRET, SOURCE_SECRET, dbPath, outputFile]) {
      assert.equal(result.stderr.includes(forbidden), false);
    }
  });
});

test('created output is owner-only on POSIX where private file mode is enforced', async () => {
  if (process.platform === 'win32') return;
  await fixture(async ({ dbPath, root }) => {
    const outputFile = join(root, 'private-candidates.json');
    runExport(dbPath, root);
    const metadata = await stat(outputFile);
    assert.equal(metadata.mode & 0o077, 0);
  });
});
