import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { memoryUiGraph } from '../../memory-engine/memory-ui-model.mjs';
import { planTypedRelationDiscovery, discoverTypedRelations } from '../../memory-engine/typed-relation-discovery.mjs';

const at = '2026-11-27T10:00:00.000Z';
const projectId = 'github.com/example/discovery-fixture';
const branch = 'main';
const ref = id => '@' + createHash('sha256').update(id).digest('hex').slice(0, 10);
const response = id => JSON.stringify({
  relations: [{ relation: 'depends_on', target_ref: ref(id), confidence: 'high',
    reason: 'The dispatch requires the configured PowerShell EncodedCommand interface.' }],
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-typed-discovery-'));
  const memory = new MemoryEngine({ dbPath: join(root, 'memory.sqlite3') });
  t.after(async () => { memory.close(); await rm(root, { recursive: true, force: true }); });
  memory.registerProject({ projectId, repoIdentity: projectId });
  memory.registerProject({ projectId: 'other', repoIdentity: 'other' });
  function add(id, value, scope = branch, project = projectId, authority = 'user_direct') {
    memory.ingest({
      evidence: { id: 'e-' + id, projectId: project, harness: 'codex', sessionId: 'fixture',
        sourceKind: 'session', sourceRef: 'session:' + id, capturedAt: at,
        branch: scope, content: value, authorityClass: authority },
      claim: { id, kind: authority, subject: 'rule', predicate: 'states', value,
        branchScope: scope, createdAt: at },
    });
  }
  add('a', 'The Windows dispatch depends on PowerShell EncodedCommand.');
  add('b', 'PowerShell EncodedCommand is the supported dispatch interface.');
  add('c', 'Playwright checks rendering.');
  add('d', 'PowerShell is used here.', 'feature');
  add('e', 'PowerShell is used here.', branch, 'other');
  add('f', 'PowerShell is required.', branch, projectId, 'external_untrusted');
  return { memory, dbPath: join(root, 'memory.sqlite3'), projectId, branch, now: () => at };
}

test('automatic candidate selection remains scoped, bounded, and does not invent edges', async t => {
  const options = await fixture(t);
  const { memory } = options;
  const before = memory.exportCanonical();
  const plan = planTypedRelationDiscovery({ ...options, at, maxSources: 1, maxTargets: 1 });
  assert.deepEqual(plan.batches.map(batch => [batch.sourceClaimId, batch.targets.map(target => target.claimId)]), [['a', ['b']]]);
  assert.equal(plan.remainingSources, 1);
  const next = planTypedRelationDiscovery({ ...options, at, afterClaimId: plan.nextAfterClaimId });
  assert.deepEqual(next.batches.map(batch => batch.sourceClaimId), ['b']);
  assert.deepEqual(memory.exportCanonical(), before);
  assert.deepEqual(memory.listTypedRelations({ projectId, branch, at }), []);
  assert.throws(() => planTypedRelationDiscovery({ ...options, at, sourceClaimId: 'd' }), /not eligible/);
  assert.throws(() => planTypedRelationDiscovery({ ...options, at, maxSources: 11 }), /integer/);
});

test('judge discovery produces a scoped proposal that a caller can explicitly persist through the existing ledger', async t => {
  const options = await fixture(t);
  const { memory } = options;
  const before = memory.exportCanonical();
  let calls = 0;
  const report = await discoverTypedRelations({ ...options, sourceClaimId: 'a',
    judge: async ({ prompt, targetClaimIds }) => {
      calls++;
      assert.deepEqual(targetClaimIds, ['b']);
      assert.match(prompt, /untrusted quoted data/);
      return response('b');
    } });
  assert.equal(calls, 1);
  assert.equal(report.failed, 0);
  assert.equal(report.proposed, 1);
  assert.deepEqual(memory.exportCanonical(), before);
  assert.deepEqual(memory.listTypedRelations({ projectId, branch, at }), []);
  const edge = report.results[0].proposals[0];
  assert.deepEqual(edge.supporting_evidence_ids, ['e-a', 'e-b']);
  assert.equal(edge.advisory, true);
  // This explicit write is confined to the disposable test database.
  memory.proposeTypedRelation({
    projectId, branch, sourceClaimId: edge.source_claim_id, targetClaimId: edge.target_claim_id,
    relation: edge.relation, confidence: edge.confidence, reason: edge.reason,
  }, { evaluatorId: 'test-reviewed-fixture', policyVersion: edge.policy_version, at });
  assert.equal(memory.listTypedRelations({ projectId, branch, at }).length, 1);
  const graph = memoryUiGraph(memory, { projectId, branch, includeSimilarity: false });
  assert.equal(graph.edges.filter(edge => edge.source === 'typed_relation').length, 1);
  assert.deepEqual(memory.exportCanonical(), before);
});

test('malformed output, foreign target and provider failure create no proposals or writes', async t => {
  const options = await fixture(t);
  const before = options.memory.exportCanonical();
  for (const [judge, status] of [
    [async () => 'not json', 'invalid_response'],
    [async () => response('d'), 'invalid_response'],
    [async () => { throw new Error('provider unavailable'); }, 'judge_failed'],
  ]) {
    const result = await discoverTypedRelations({ ...options, sourceClaimId: 'a', judge });
    assert.equal(result.results[0].status, status);
    assert.equal(result.proposed, 0);
    assert.equal(result.failed, 1);
  }
  assert.deepEqual(options.memory.exportCanonical(), before);
  assert.deepEqual(options.memory.listTypedRelations({ projectId, branch, at }), []);
});

test('provider is not called for an isolated eligible source', async t => {
  const options = await fixture(t);
  const result = await discoverTypedRelations({ ...options, sourceClaimId: 'c',
    judge: async () => { throw new Error('must not run'); } });
  assert.equal(result.batches.length, 0);
  assert.equal(result.failed, 0);
});

test('CLI defaults to read-only discovery planning, rejects apply and does not initialize a provider', async t => {
  const { memory, dbPath } = await fixture(t);
  const before = memory.exportCanonical();
  const cli = fileURLToPath(new URL('../../scripts/discover-typed-relations.mjs', import.meta.url));
  const args = [cli, '--db-path', dbPath, '--project', projectId, '--branch', branch, '--source', 'a'];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, 'read-only-plan');
  assert.deepEqual(report.batches[0].targets.map(x => x.claimId), ['b']);
  const forbidden = spawnSync(process.execPath, [...args, '--apply'], { encoding: 'utf8' });
  assert.equal(forbidden.status, 1);
  assert.deepEqual(memory.exportCanonical(), before);
  assert.deepEqual(memory.listTypedRelations({ projectId, branch, at }), []);
});

test('a changed source snapshot invalidates in-flight judge output', async t => {
  const options = await fixture(t);
  const original = options.memory.exportCanonical.bind(options.memory);
  let changed = false;
  options.memory.exportCanonical = () => {
    const snapshot = original();
    if (changed) snapshot.claims.find(x => x.id === 'a').state = 'superseded';
    return snapshot;
  };
  const result = await discoverTypedRelations({ ...options, sourceClaimId: 'a',
    judge: async () => { changed = true; return response('b'); } });
  assert.equal(result.results[0].status, 'stale_context');
  assert.equal(result.proposed, 0);
  assert.equal(options.memory.listTypedRelations({ projectId, branch, at }).length, 0);
});
