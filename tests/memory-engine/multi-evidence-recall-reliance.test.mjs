import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryEngine, evaluateReliance } from '../../memory-engine/index.mjs';

async function createEngine(t) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-hub-r10b-'));
  const dbPath = join(dir, 'memory.sqlite3');
  const memory = new MemoryEngine({ dbPath, clock: () => '2026-10-11T18:00:00.000Z' });
  t.after(() => memory.close());
  t.after(() => rm(dir, { recursive: true, force: true }));
  memory.registerProject({ projectId: 'project-a', repoIdentity: 'project-a' });
  return memory;
}

function evidence(id, authorityClass, content) {
  return {
    id,
    projectId: 'project-a',
    harness: 'codex',
    sessionId: 's1',
    sourceKind: authorityClass === 'user_direct' ? 'session' : 'tool',
    sourceRef: `source:${id}`,
    capturedAt: '2026-10-11T18:00:00.000Z',
    branch: 'main',
    commitSha: 'abc',
    path: null,
    blobOid: null,
    content,
    authorityClass,
    metadata: {},
  };
}

function claim(id, value) {
  return {
    id,
    kind: 'procedure',
    subject: 'project procedure',
    predicate: 'states',
    value,
    state: 'active',
    branchScope: 'main',
    createdAt: '2026-10-11T18:00:01.000Z',
  };
}

test('recall and materialize expose complete provenance in deterministic order', async (t) => {
  const memory = await createEngine(t);
  memory.recordEvidence(evidence('e-user', 'user_direct', 'Use dry-run first.'));
  memory.recordEvidence(evidence('e-tool', 'tool_observation', 'setup script supports dry-run'));
  memory.assertClaim({
    evidenceId: 'e-user',
    evidenceIds: ['e-tool', 'e-user'],
    claim: claim('c-1', 'Use dry-run first.'),
  });

  const recalled = memory.recall({ projectId: 'project-a', branch: 'main', query: 'dry run' });
  assert.equal(recalled.items.length, 1);
  assert.equal(recalled.items[0].evidence.id, 'e-user');
  assert.deepEqual(recalled.items[0].provenance.map((row) => [row.role, row.evidence.id]), [
    ['primary', 'e-user'],
    ['supporting', 'e-tool'],
  ]);

  assert.equal(JSON.stringify(recalled.items[0]).includes('provenance'), false);

  const materialized = memory.materializeRecall({
    projectId: 'project-a', branch: 'main', claimIds: ['c-1'],
  });
  assert.deepEqual(materialized.items[0].provenance.map((row) => [row.role, row.evidence.id]), [
    ['primary', 'e-user'],
    ['supporting', 'e-tool'],
  ]);
});

test('reliance uses every provenance authority and keeps legacy item compatibility', async (t) => {
  const memory = await createEngine(t);
  memory.recordEvidence(evidence('e-user', 'user_direct', 'Procedure A'));
  memory.recordEvidence(evidence('e-tool', 'tool_observation', 'Procedure A observed'));
  memory.assertClaim({ evidenceId: 'e-user', evidenceIds: ['e-user', 'e-tool'], claim: claim('c-a', 'Procedure A') });
  const item = memory.recall({ projectId: 'project-a', branch: 'main', query: 'Procedure A' }).items[0];

  assert.equal(evaluateReliance({ items: [item], use: 'answer' }).selected.length, 1);
  const policy = evaluateReliance({ items: [item], use: 'project_policy' });
  assert.equal(policy.selected.length, 0);
  assert.equal(policy.blocked.length, 1);

  const legacy = {
    claim: { id: 'legacy' },
    evidence: { authority_class: 'user_direct' },
  };
  assert.equal(evaluateReliance({ items: [legacy], use: 'project_policy' }).selected.length, 1);
});

test('a disallowed supporting authority blocks even when the primary authority is allowed', async (t) => {
  const memory = await createEngine(t);
  memory.recordEvidence(evidence('e-user', 'user_direct', 'Procedure B'));
  memory.recordEvidence(evidence('e-external', 'external_untrusted', 'Procedure B external'));
  memory.assertClaim({ evidenceId: 'e-user', evidenceIds: ['e-user', 'e-external'], claim: claim('c-b', 'Procedure B') });
  const item = memory.recall({ projectId: 'project-a', branch: 'main', query: 'Procedure B' }).items[0];

  const answer = evaluateReliance({ items: [item], use: 'answer' });
  assert.equal(answer.selected.length, 0);
  assert.equal(answer.blocked.length, 1);
  assert.equal(evaluateReliance({ items: [item], use: 'planning' }).selected.length, 1);
});
