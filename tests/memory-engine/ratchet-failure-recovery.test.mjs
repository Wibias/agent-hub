import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareCase } from '../memory-ratchet/runner.mjs';
import { createReferenceMemoryAdapter } from '../memory-ratchet/reference-adapter.mjs';

function recallRequest(prepared) {
  return {
    case_id: 'M15',
    query: prepared.query,
    project_id: prepared.current.project_id,
    branch: prepared.current.branch,
    revision_sha: prepared.current.revision_sha,
    repo_path: prepared.current.repo_path,
    harness: prepared.query_harness,
    limit: 10,
  };
}

function assertCommittedDatabaseMemory(recall) {
  const postgres = recall.items.find(
    (item) => item.claim.id === 'claim:EV-A-POSTGRES-DECISION',
  );
  assert.ok(postgres, 'committed Postgres decision must be current');
  assert.equal(postgres.claim.state, 'active');
  assert.equal(postgres.evidence.source_ref, 'session:A-S02');

  const sqlite = recall.history.find(
    (item) => item.claim.id === 'claim:EV-A-SQLITE-ACCEPT',
  );
  assert.ok(sqlite, 'SQLite decision must remain historical');
  assert.equal(sqlite.claim.state, 'superseded');
  assert.equal(
    sqlite.claim.superseded_by_claim_id,
    'claim:EV-A-POSTGRES-DECISION',
  );
  assert.equal(sqlite.evidence.source_ref, 'session:A-S01');
}

test('M15 rebuilds removed derived state without losing committed memory or provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-m15-derived-'));
  const prepared = await prepareCase('M15', root);
  const adapter = createReferenceMemoryAdapter();

  await adapter.reset();
  try {
    await adapter.setup(prepared);

    for (const event of prepared.events.filter(
      (item) => item.id !== 'EV-A-PARTIAL-WRITE',
    )) {
      await adapter.ingest(event);
    }

    const before = await adapter.recall(recallRequest(prepared));
    assertCommittedDatabaseMemory(before);

    await adapter.clearDerivedState();

    const withoutDerived = await adapter.recall(recallRequest(prepared));
    assert.deepEqual(withoutDerived.items, []);
    assert.deepEqual(withoutDerived.history, []);

    const recovery = await adapter.recover();
    assert.equal(recovery.indexed_claims, 2);
    assert.equal(recovery.repository_path_snapshots, 0);

    const after = await adapter.recall(recallRequest(prepared));
    assertCommittedDatabaseMemory(after);
  } finally {
    await adapter.teardown();
  }
});

test('M15 hard process termination cannot promote an interrupted write to committed memory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-m15-crash-'));
  const prepared = await prepareCase('M15', root);
  const adapter = createReferenceMemoryAdapter();

  await adapter.reset();
  try {
    await adapter.setup(prepared);

    const committed = prepared.events.filter(
      (item) => item.id !== 'EV-A-PARTIAL-WRITE',
    );
    for (const event of committed) {
      await adapter.ingest(event);
    }

    const partial = prepared.events.find(
      (item) => item.id === 'EV-A-PARTIAL-WRITE',
    );
    assert.ok(partial, 'M15 partial-write fixture event is required');

    const interrupted = await adapter.interruptIngest(partial);
    assert.equal(interrupted.interrupted, true);
    assert.equal(interrupted.signal, 'SIGKILL');

    const recovery = await adapter.recover();
    assert.equal(recovery.indexed_claims, 2);

    const exported = await adapter.exportMemory();
    assert.equal(
      exported.evidence.some(
        (row) => row.id === 'evidence:EV-A-PARTIAL-WRITE',
      ),
      false,
    );
    assert.equal(
      exported.claims.some(
        (row) => row.id === 'claim:EV-A-PARTIAL-WRITE',
      ),
      false,
    );

    const recall = await adapter.recall(recallRequest(prepared));
    assertCommittedDatabaseMemory(recall);
    assert.equal(
      JSON.stringify(recall).includes('switch audit logs to 3 days'),
      false,
    );
  } finally {
    await adapter.teardown();
  }
});
