import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareCase } from '../memory-ratchet/runner.mjs';
import { createReferenceMemoryAdapter } from '../memory-ratchet/reference-adapter.mjs';

function request(prepared, query) {
  return {
    case_id: 'M13',
    query,
    project_id: prepared.current.project_id,
    branch: prepared.current.branch,
    revision_sha: prepared.current.revision_sha,
    repo_path: prepared.current.repo_path,
    harness: null,
    limit: 10,
  };
}

function compactRecall(recall) {
  const compact = (item) => ({
    claim_id: item.claim.id,
    state: item.claim.state,
    superseded_by_claim_id: item.claim.superseded_by_claim_id,
    evidence_id: item.evidence.id,
    source_ref: item.evidence.source_ref,
    authority_class: item.evidence.authority_class,
  });

  return {
    current: recall.items.map(compact),
    history: recall.history.map(compact),
  };
}

test('M13 portable export rebuild preserves M01 M06 and M08 semantics in a fresh instance', async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'memory-engine-m13-source-'));
  const targetRoot = await mkdtemp(join(tmpdir(), 'memory-engine-m13-target-'));
  const sourcePrepared = await prepareCase('M13', sourceRoot);
  const targetPrepared = await prepareCase('M13', targetRoot);

  const source = createReferenceMemoryAdapter();
  const target = createReferenceMemoryAdapter();

  await source.reset();
  await target.reset();

  try {
    await source.setup(sourcePrepared);
    for (const event of sourcePrepared.events) {
      await source.ingest(event);
    }

    const queries = [
      'What is the active SQLite or Postgres project decision, and what is its source?',
      'Which of SQLite or Postgres is current, and which one is superseded history?',
      'Recall the Postgres database decision and the audit-log retention decision, with their durable sources.',
    ];

    const before = [];
    for (const query of queries) {
      before.push(compactRecall(await source.recall(request(sourcePrepared, query))));
    }

    const exported = await source.exportMemory();
    assert.equal(exported.format, 'agent-hub-memory-canonical');
    assert.equal(exported.version, 1);
    assert.equal(Object.hasOwn(exported, 'repository_path_state'), false);
    assert.equal(Object.hasOwn(exported, 'claim_fts'), false);

    await target.setup(targetPrepared);
    const rebuilt = await target.importMemory({ payload: exported });
    assert.equal(rebuilt.indexed_claims, exported.claims.length);
    assert.equal(rebuilt.repository_path_snapshots, 0);

    const after = [];
    for (const query of queries) {
      after.push(compactRecall(await target.recall(request(targetPrepared, query))));
    }

    assert.deepEqual(after, before);

    const database = after[1];
    assert.ok(database.current.some((item) => (
      item.claim_id === 'claim:EV-A-POSTGRES-DECISION'
      && item.state === 'active'
      && item.source_ref === 'session:A-S02'
    )));
    assert.ok(database.history.some((item) => (
      item.claim_id === 'claim:EV-A-SQLITE-ACCEPT'
      && item.state === 'superseded'
      && item.superseded_by_claim_id === 'claim:EV-A-POSTGRES-DECISION'
      && item.source_ref === 'session:A-S01'
    )));

    const provenance = after[2];
    assert.ok(provenance.current.some((item) => (
      item.claim_id === 'claim:EV-A-ADR-POSTGRES'
      && item.source_ref === 'docs/adr/0001-database.md'
      && item.authority_class === 'repo_trusted'
    )));
    assert.ok(provenance.current.some((item) => (
      item.claim_id === 'claim:EV-A-CONVERSATION-DECISION'
      && item.source_ref === 'session:A-S11'
      && item.authority_class === 'user_direct'
    )));
  } finally {
    await source.teardown();
    await target.teardown();
  }
});
