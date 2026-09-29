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
    limit: 10,
  };
}

function compactRecall(recall) {
  const compact = (item) => ({
    claim_id: item.claim.id,
    state: item.claim.state,
    superseded_by_claim_id: item.claim.superseded_by_claim_id,
    evidence_id: item.evidence.id,
    harness: item.evidence.harness,
    session_id: item.evidence.session_id,
    source_ref: item.evidence.source_ref,
    authority_class: item.evidence.authority_class,
    freshness_status: item.freshness?.status ?? null,
  });

  return {
    current: recall.items.map(compact),
    history: recall.history.map(compact),
  };
}

test('M13 portable rebuild preserves M01 M06 and M08 semantics in a fresh instance', async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'memory-engine-m13-source-'));
  const targetRoot = await mkdtemp(join(tmpdir(), 'memory-engine-m13-target-'));
  const sourcePrepared = await prepareCase('M13', sourceRoot);
  const targetPrepared = await prepareCase('M13', targetRoot);

  const source = createReferenceMemoryAdapter({
    dbPath: join(sourceRoot, 'source-memory.sqlite3'),
  });
  const rebuilt = createReferenceMemoryAdapter({
    dbPath: join(targetRoot, 'rebuilt-memory.sqlite3'),
  });

  await source.reset();
  await rebuilt.reset();

  try {
    await source.setup(sourcePrepared);
    for (const event of sourcePrepared.events) {
      await source.ingest(event);
    }

    const queries = [
      'What is the active SQLite or Postgres project database decision?',
      'Which of SQLite or Postgres is current, and which one is superseded history?',
      'Recall the Postgres database decision and audit-log retention decision with their durable sources.',
    ];

    const before = [];
    for (const query of queries) {
      before.push(compactRecall(await source.recall(request(sourcePrepared, query))));
    }

    const portable = await source.exportMemory({
      project_id: sourcePrepared.current.project_id,
    });
    assert.equal(portable.format, 'agent-hub-memory-export');
    assert.equal(portable.version, 1);
    assert.equal(portable.canonical.projects.length, 1);
    assert.equal(Object.hasOwn(portable.canonical, 'repository_path_state'), false);
    assert.equal(Object.hasOwn(portable.canonical, 'claim_fts'), false);

    await rebuilt.setup(targetPrepared);
    const imported = await rebuilt.importMemory(portable);
    assert.equal(imported.projects, 1);
    assert.equal(imported.evidence, sourcePrepared.events.length);

    const after = [];
    for (const query of queries) {
      after.push(compactRecall(await rebuilt.recall(request(targetPrepared, query))));
    }

    assert.deepEqual(after, before);

    const database = after[1];
    assert.ok(database.current.some((item) => (
      item.claim_id === 'claim:EV-A-POSTGRES-DECISION'
      && item.state === 'active'
      && item.source_ref === 'session:A-S02'
    )));
    assert.equal(
      database.current.some((item) => item.claim_id === 'claim:EV-A-SQLITE-ACCEPT'),
      false,
    );
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
      && item.freshness_status === 'fresh'
    )));
    assert.ok(provenance.current.some((item) => (
      item.claim_id === 'claim:EV-A-CONVERSATION-DECISION'
      && item.source_ref === 'session:A-S11'
      && item.authority_class === 'user_direct'
    )));

    const reexported = await rebuilt.exportMemory({
      project_id: targetPrepared.current.project_id,
    });
    assert.deepEqual(reexported.canonical, portable.canonical);
  } finally {
    await source.teardown();
    await rebuilt.teardown();
  }
});
