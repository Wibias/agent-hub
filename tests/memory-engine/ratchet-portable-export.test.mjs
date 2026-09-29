import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareCase } from '../memory-ratchet/runner.mjs';
import { createReferenceMemoryAdapter } from '../memory-ratchet/reference-adapter.mjs';

test('M13 portable rebuild preserves active truth, supersession, and provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-m13-'));
  const prepared = await prepareCase('M13', root);
  const source = createReferenceMemoryAdapter({
    dbPath: join(root, 'source-memory.sqlite3'),
  });
  const rebuilt = createReferenceMemoryAdapter({
    dbPath: join(root, 'rebuilt-memory.sqlite3'),
  });

  await source.reset();
  await rebuilt.reset();

  try {
    await source.setup(prepared);
    for (const event of prepared.events) {
      await source.ingest(event);
    }

    const portable = await source.exportMemory({
      project_id: prepared.current.project_id,
    });

    assert.equal(portable.format, 'agent-hub-memory-export');
    assert.equal(portable.version, 1);
    assert.equal(portable.canonical.projects.length, 1);

    await rebuilt.setup(prepared);
    const imported = await rebuilt.importMemory(portable);
    assert.equal(imported.projects, 1);
    assert.equal(imported.evidence, prepared.events.length);

    const recall = await rebuilt.recall({
      case_id: 'M13',
      query: prepared.query,
      project_id: prepared.current.project_id,
      branch: prepared.current.branch,
      revision_sha: prepared.current.revision_sha,
      repo_path: prepared.current.repo_path,
      limit: 10,
    });

    const postgres = recall.items.find(
      (item) => item.evidence.id === 'evidence:EV-A-POSTGRES-DECISION',
    );
    assert.ok(postgres);
    assert.equal(postgres.claim.state, 'active');
    assert.equal(postgres.evidence.harness, 'claude-code');
    assert.equal(postgres.evidence.session_id, 'A-S02');
    assert.equal(postgres.evidence.source_ref, 'session:A-S02');

    const sqliteCurrent = recall.items.find(
      (item) => item.evidence.id === 'evidence:EV-A-SQLITE-ACCEPT',
    );
    assert.equal(sqliteCurrent, undefined);

    const sqliteHistory = recall.history.find(
      (item) => item.evidence.id === 'evidence:EV-A-SQLITE-ACCEPT',
    );
    assert.ok(sqliteHistory);
    assert.equal(sqliteHistory.claim.state, 'superseded');
    assert.equal(
      sqliteHistory.claim.superseded_by_claim_id,
      'claim:EV-A-POSTGRES-DECISION',
    );
    assert.equal(sqliteHistory.evidence.harness, 'claude-code');
    assert.equal(sqliteHistory.evidence.session_id, 'A-S01');
    assert.equal(sqliteHistory.evidence.source_ref, 'session:A-S01');

    const adr = recall.items.find(
      (item) => item.evidence.id === 'evidence:EV-A-ADR-POSTGRES',
    );
    assert.ok(adr);
    assert.equal(adr.evidence.authority_class, 'repo_trusted');
    assert.equal(adr.freshness.status, 'fresh');

    const reexported = await rebuilt.exportMemory({
      project_id: prepared.current.project_id,
    });
    assert.deepEqual(reexported.canonical, portable.canonical);
  } finally {
    await source.teardown();
    await rebuilt.teardown();
  }
});
