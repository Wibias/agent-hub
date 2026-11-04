import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { inspectMemoryDatabase } from '../../memory-engine/memory-doctor.mjs';

const projectId = 'github.com/example/agent-hub';
const at = '2026-11-04T10:00:00.000Z';
function add(memory, id, branch = 'main') {
  memory.ingest({
    evidence: {
      id: `e-${id}`, projectId, sourceKind: 'session', branch,
      capturedAt: at, authorityClass: 'agent_inference',
      content: `Agent decision: ${id} on ${branch}`,
    },
    claim: {
      id, kind: 'agent_inference', subject: 'agent decision', predicate: 'states',
      value: `Agent decision: ${id} on ${branch}`, createdAt: at,
    },
  });
}
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'agent-hub-d1b-full-'));
  const path = join(root, 'memory.sqlite3');
  try { return fn(path); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('D1b MemoryEngine integration adds optional table without changing canonical export', () => fixture(path => {
  const memory = new MemoryEngine({ dbPath: path });
  memory.registerProject({ projectId });
  add(memory, 'a');
  add(memory, 'b');
  const canonicalBefore = memory.exportCanonical();
  const proposal = {
    projectId, branch: 'main', sourceClaimId: 'a', targetClaimId: 'b',
    relation: 'implements', confidence: 'high', reason: 'Specific implementation link.',
  };
  const stored = memory.proposeTypedRelation(proposal, {
    evaluatorId: 'test:semantic-relation-v1', at,
  });
  assert.equal(stored.relation, 'implements');
  assert.equal(stored.advisory, true);
  assert.deepEqual(memory.exportCanonical(), canonicalBefore);
  assert.equal(memory.listTypedRelations({ projectId, branch: 'main', at }).length, 1);
  memory.close();
  const doctor = inspectMemoryDatabase({ dbPath: path, projectId, branch: 'main' });
  assert.equal(doctor.typedRelationLedgerAvailable, true);
  assert.equal(doctor.typedRelationCount, 1);
  const reopened = new MemoryEngine({ dbPath: path });
  assert.equal(reopened.listTypedRelations({ projectId, branch: 'main', at }).length, 1);
  reopened.close();
}));

test('D1b MemoryEngine integration enforces branch and legacy schema compatibility', () => fixture(path => {
  const memory = new MemoryEngine({ dbPath: path });
  memory.registerProject({ projectId });
  add(memory, 'a');
  add(memory, 'dev-b', 'dev');
  assert.throws(() => memory.proposeTypedRelation({
    projectId, branch: 'main', sourceClaimId: 'a', targetClaimId: 'dev-b',
    relation: 'related_to', confidence: 'high', reason: 'Not allowed across branches.',
  }, { evaluatorId: 'test', at }), /branch|scope/i);
  memory.close();
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec('DROP TABLE claim_relations');
  db.close();
  const ro = new MemoryEngine({ dbPath: path, readOnly: true });
  assert.deepEqual(ro.listTypedRelations({ projectId, branch: 'main', at }), []);
  ro.close();
  const oldDoctor = inspectMemoryDatabase({ dbPath: path, projectId, branch: 'main' });
  assert.equal(oldDoctor.typedRelationLedgerAvailable, false);
  const migrated = new MemoryEngine({ dbPath: path });
  assert.deepEqual(migrated.listTypedRelations({ projectId, branch: 'main', at }), []);
  migrated.close();
}));


test('D1b real MemoryEngine accepts descriptive kind with Evidence authority', () => fixture(path => {
  const memory = new MemoryEngine({ dbPath: path });
  try {
    memory.registerProject({ projectId });
    for (const [id, authorityClass] of [['user-a', 'user_direct'], ['agent-b', 'agent_inference']]) {
      memory.ingest({
        evidence: {
          id: `e-${id}`, projectId, sourceKind: 'session', branch: 'main',
          capturedAt: at, authorityClass, content: `Decision ${id}`,
        },
        claim: {
          id, kind: 'decision', subject: 'dispatch', predicate: 'uses',
          value: `Decision ${id}`, createdAt: at,
        },
      });
    }
    const stored = memory.proposeTypedRelation({
      projectId, branch: 'main', sourceClaimId: 'user-a', targetClaimId: 'agent-b',
      relation: 'supports', confidence: 'high', reason: 'A bounded relation test.',
    }, { evaluatorId: 'test', at });
    assert.equal(stored.source_claim_id, 'user-a');
    assert.equal(memory.listTypedRelations({ projectId, branch: 'main', at }).length, 1);
  } finally {
    memory.close();
  }
}));
