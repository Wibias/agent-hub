import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { executeD8EvidenceAudit, parseD8Args } from '../../scripts/audit-memory-graph-d8.mjs';

const PROJECT = 'github.com/example/d8-db-integration';

test('D8 CLI audits existing SQLite without writes, raw payload or implicit Git trust', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-hub-d8-audit-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  try {
    memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
    const at = new Date(Date.now() - 60_000).toISOString();
    memory.ingest({
      evidence: {
        id: 'e-d8', projectId: PROJECT, harness: 'codex', sessionId: 'd8',
        sourceKind: 'session', sourceRef: 'session:PRIVATE_REF', capturedAt: at,
        branch: 'main', commitSha: null, path: null, blobOid: null,
        content: 'PRIVATE_EVIDENCE', authorityClass: 'user_direct', metadata: {},
      },
      claim: { id: 'claim-d8', kind: 'decision', subject: 'test', predicate: 'checks',
        value: 'PRIVATE_CLAIM', branchScope: 'main', createdAt: at },
    });
  } finally { memory.close(); }
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const before = hash(await readFile(dbPath));
  const output = [];
  const report = await executeD8EvidenceAudit({
    argv: ['--db-path', dbPath, '--project-id', PROJECT, '--branch', 'main'],
    emit: (text) => output.push(text),
  });
  assert.equal(report.outcome, 'blocked');
  assert.equal(report.claims.inScope, 1);
  assert.equal(report.nextStep, 'no_repository_evidence_recorded');
  assert.equal(output.length, 1);
  assert.doesNotMatch(output[0], /PRIVATE|claim-d8|e-d8|agent-hub-d8-audit-|memory\.sqlite3/);
  assert.equal(hash(await readFile(dbPath)), before);
});

test('D8 help does not need a database and emits usage text', async () => {
  const output = [];
  const result = await executeD8EvidenceAudit({ argv: ['--help'], emit: (s) => output.push(s) });
  assert.equal(result.outcome, 'help');
  assert.match(output[0], /read-only repository Evidence coverage/i);
});


test('D8 CLI requires explicit scope and rejects ambiguous option flags', () => {
  assert.equal(parseD8Args(['--project-id', PROJECT, '--branch', 'main']).branch, 'main');
  assert.throws(() => parseD8Args(['--project-id', PROJECT]), /required/);
  assert.throws(() => parseD8Args(['--project-id', PROJECT, '--branch', 'main', '--unsafe']), /unknown/);
  assert.throws(() => parseD8Args(['--branch', 'main', '--branch', 'feature']), /duplicate/);
});
