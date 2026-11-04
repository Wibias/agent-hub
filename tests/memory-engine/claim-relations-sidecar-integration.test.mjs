import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine } from '../../memory-engine/index.mjs';

const projectId = 'github.com/example/d1b-v6';
const at = '2026-11-04T18:00:00.000Z';
const proposal = {
  projectId, branch: 'main', sourceClaimId: 'a', targetClaimId: 'b',
  relation: 'supports', confidence: 'high', reason: 'A provides evidence for B.',
};
function seed(memory) {
  memory.registerProject({ projectId });
  for (const id of ['a', 'b']) {
    memory.ingest({
      evidence: {
        id: `e-${id}`, projectId, sourceKind: 'session', branch: 'main',
        capturedAt: at, authorityClass: 'agent_inference', content: `Agent decision ${id}`,
      },
      claim: {
        id, kind: 'decision', subject: 'dispatch', predicate: 'supports',
        value: `Agent decision ${id}`, createdAt: at,
      },
    });
  }
}

test('D1b v6 sidecar uses real MemoryEngine and never changes canonical export', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hub-d1b-v6-real-'));
  try {
    const source = new MemoryEngine({ dbPath: join(dir, 'source.sqlite3') });
    let archive;
    try {
      seed(source);
      const before = source.exportCanonical();
      source.proposeTypedRelation(proposal, { evaluatorId: 'fixture:semantic-v1', at });
      archive = source.exportTypedRelationSidecar({ projectId, branch: 'main', at });
      assert.equal(archive.relations.length, 1);
      assert.deepEqual(source.exportCanonical(), before);
    } finally { source.close(); }

    const target = new MemoryEngine({ dbPath: join(dir, 'target.sqlite3') });
    try {
      seed(target);
      const before = target.exportCanonical();
      const result = target.importTypedRelationSidecar(archive, { projectId, branch: 'main', at });
      assert.equal(result.imported, 1);
      assert.equal(target.listTypedRelations({ projectId, branch: 'main', at }).length, 1);
      assert.deepEqual(target.exportCanonical(), before);
    } finally { target.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D1b v6 MemoryEngine sidecar import refuses mismatched canonical primary Evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hub-d1b-v6-mismatch-'));
  try {
    const source = new MemoryEngine({ dbPath: join(dir, 'source.sqlite3') });
    let archive;
    try {
      seed(source);
      source.proposeTypedRelation(proposal, { evaluatorId: 'fixture:semantic-v1', at });
      archive = source.exportTypedRelationSidecar({ projectId, branch: 'main', at });
    } finally { source.close(); }

    const target = new MemoryEngine({ dbPath: join(dir, 'target.sqlite3') });
    try {
      target.registerProject({ projectId });
      for (const id of ['a', 'b']) {
        target.ingest({
          evidence: {
            id: `changed-e-${id}`, projectId, sourceKind: 'session', branch: 'main',
            capturedAt: at, authorityClass: 'agent_inference', content: `Changed evidence for ${id}`,
          },
          claim: { id, kind: 'decision', subject: 'dispatch', predicate: 'supports', value: `Changed ${id}`, createdAt: at },
        });
      }
      assert.throws(() => target.importTypedRelationSidecar(archive, { projectId, branch: 'main', at }), /provenance|evidence/);
      assert.equal(target.listTypedRelations({ projectId, branch: 'main', at }).length, 0);
    } finally { target.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D1b v6 relation reason follows canonical MemoryEngine secret redaction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hub-d1b-v6-redaction-'));
  const memory = new MemoryEngine({ dbPath: join(dir, 'memory.sqlite3') });
  try {
    seed(memory);
    const fixtureSecret = 'sk-abcdefghijklmnopqrstuvw';
    const recordedEvidence = memory.recordEvidence({
      id: 'redaction-check', projectId, sourceKind: 'session', branch: 'main',
      capturedAt: at, authorityClass: 'agent_inference', content: `Secret ${fixtureSecret}`,
    });
    assert.doesNotMatch(recordedEvidence.content_redacted, /sk-abcdefghijklmnopqrstuvw/);
    const stored = memory.proposeTypedRelation({
      ...proposal, reason: `Source and target ${fixtureSecret} overlap`,
    }, { evaluatorId: 'fixture', at });
    assert.doesNotMatch(stored.reason, /sk-abcdefghijklmnopqrstuvw/);
    assert.match(stored.reason, /\[REDACTED_SECRET\]/);
  } finally {
    memory.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
