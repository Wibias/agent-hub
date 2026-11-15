import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { ensureEvidenceProposalSchema } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import {
  parseEvidenceShadowArgs,
  prepareMemoryEvidenceShadow,
} from '../../scripts/prepare-memory-evidence-shadow.mjs';

const projectId = 'github.com/example/isolated-evidence';
const fact = 'Real source evidence from the original database, not a judge decision.';

function fixture(t, { configured = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agenthub-shadow-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const canonical = join(dir, 'canonical');
  mkdirSync(canonical);
  const dbPath = join(canonical, 'memory.sqlite3');
  const outputDir = join(dir, 'isolated-review');
  const memory = new MemoryEngine({ dbPath });
  try {
    memory.registerProject({ projectId, repoIdentity: projectId });
    memory.recordEvidence({
      id: 'real-source-evidence', projectId,
      harness: 'codex', sessionId: 'real-local-session',
      sourceKind: 'session', sourceRef: 'session:real-local-session',
      capturedAt: '2026-11-14T09:00:00.000Z',
      branch: 'main', content: fact,
      authorityClass: 'user_direct',
      metadata: { event_type: 'user_prompt' },
    });
  } finally { memory.close(); }
  if (configured) {
    const db = new DatabaseSync(dbPath);
    try { ensureEvidenceProposalSchema(db); } finally { db.close(); }
  }
  return { dir, canonical, dbPath, outputDir };
}

function tables(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all().map(x => x.name));
}

test('offline evidence shadow copies genuine evidence, adds schema only to copy, no Claim or E~', async t => {
  const f = fixture(t);
  const sourceBefore = new DatabaseSync(f.dbPath, { readOnly: true });
  const originalHash = createHash('sha256').update(readFileSync(f.dbPath)).digest('hex');
  assert.equal(tables(sourceBefore).has('memory_evidence_proposals'), false);
  sourceBefore.close();

  const result = await prepareMemoryEvidenceShadow({
    dbPath: f.dbPath, outputDir: f.outputDir, projectId, branch: 'main',
    backupSqlite: async (source, target, options) => {
      assert.throws(() => source.exec('CREATE TABLE forbidden_write (a INTEGER)'),
        /readonly|read-only|SQLITE_READONLY/i);
      return backup(source, target, options);
    },
  });
  assert.equal(result.status, 'isolated_evidence_shadow_ready_unjudged');
  assert.equal(result.sourceDatabaseModifiedByTool, false);
  assert.equal(result.shadowSchemaInitialized, true);
  assert.equal(result.evidenceBoundLedgerPreviouslyPresent, false);
  assert.deepEqual(result.counts, {
    evidence: 1, candidates: 0, claims: 0, proposals: 0, needsConfirmation: 0,
  });
  assert.equal(result.modelInvocations, 0);
  assert.equal(result.decisionsApplied, 0);
  assert.equal(result.claimsCreated, 0);
  assert.equal(result.protectedApproval, false);
  assert.doesNotMatch(JSON.stringify(result), /Real source evidence from the original database/);

  const shadow = new DatabaseSync(result.shadowDatabase, { readOnly: true });
  try {
    assert.ok(tables(shadow).has('memory_evidence_proposals'));
    assert.equal(shadow.prepare('SELECT content_redacted FROM evidence WHERE id=?')
      .get('real-source-evidence').content_redacted, fact);
    assert.equal(shadow.prepare('SELECT COUNT(*) AS n FROM memory_evidence_proposals').get().n, 0);
    assert.equal(shadow.prepare('SELECT COUNT(*) AS n FROM claims').get().n, 0);
  } finally { shadow.close(); }

  const originalAfter = new DatabaseSync(f.dbPath, { readOnly: true });
  try {
    assert.equal(tables(originalAfter).has('memory_evidence_proposals'), false);
    assert.equal(originalAfter.prepare('SELECT COUNT(*) AS n FROM evidence').get().n, 1);
  } finally { originalAfter.close(); }
  assert.equal(createHash('sha256').update(readFileSync(f.dbPath)).digest('hex'), originalHash);
});

test('existing source E~ schema is preserved without inventing proposals', async t => {
  const f = fixture(t, { configured: true });
  const result = await prepareMemoryEvidenceShadow({
    dbPath: f.dbPath, outputDir: f.outputDir, projectId, branch: 'main',
  });
  assert.equal(result.evidenceBoundLedgerPreviouslyPresent, true);
  assert.equal(result.counts.proposals, 0);
  assert.equal(result.counts.needsConfirmation, 0);
});

test('fail closed for nonfresh destination, missing project and destination beside source DB', async t => {
  const f = fixture(t);
  assert.deepEqual(parseEvidenceShadowArgs([
    '--db-path', f.dbPath, '--output-dir', f.outputDir,
    '--project-id', projectId, '--branch', 'main',
  ]), { dbPath: f.dbPath, outputDir: f.outputDir, projectId, branch: 'main' });
  assert.throws(() => parseEvidenceShadowArgs([
    '--db-path', f.dbPath, '--output-dir', f.outputDir,
    '--project-id', projectId, '--branch', 'main', '--apply', 'true',
  ]));
  assert.throws(() => parseEvidenceShadowArgs([
    '--db-path', f.dbPath, '--output-dir', f.outputDir,
    '--project-id', projectId, '--project-id', 'evil',
  ]));
  await assert.rejects(prepareMemoryEvidenceShadow({
    dbPath: f.dbPath, outputDir: join(f.canonical, 'leak'),
    projectId, branch: 'main',
  }), /outside the canonical DB directory/);
  await assert.rejects(prepareMemoryEvidenceShadow({
    dbPath: f.dbPath, outputDir: f.outputDir,
    projectId: 'github.com/other', branch: 'main',
  }), /not registered/);
  mkdirSync(f.outputDir);
  await assert.rejects(prepareMemoryEvidenceShadow({
    dbPath: f.dbPath, outputDir: f.outputDir, projectId, branch: 'main',
  }), /must not exist/);
});
