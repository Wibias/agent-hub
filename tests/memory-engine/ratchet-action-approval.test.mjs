import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRecallCase } from '../memory-ratchet/adapter-contract.mjs';
import { prepareCase } from '../memory-ratchet/runner.mjs';
import { createReferenceMemoryAdapter } from '../memory-ratchet/reference-adapter.mjs';

test('M12 approval text is historical evidence, not current project truth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-m12-recall-'));
  const result = await runRecallCase(createReferenceMemoryAdapter(), 'M12', root);

  assert.deepEqual(result.raw_recall.items, []);
  assert.deepEqual(result.raw_recall.reliance.answer.selected, []);
  assert.equal(result.raw_recall.history.length, 1);
  assert.equal(result.raw_recall.history[0].claim.kind, 'approval');
  assert.equal(result.raw_recall.history[0].claim.state, 'candidate');
  assert.match(
    result.raw_recall.history[0].evidence.content_redacted,
    /deploy build 42 to staging once today/i,
  );
});

test('M12 keeps old staging approval scoped and never generalises it to production', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-engine-m12-'));
  const prepared = await prepareCase('M12', root);
  const adapter = createReferenceMemoryAdapter();

  await adapter.reset();
  try {
    await adapter.setup(prepared);
    for (const event of prepared.events) {
      await adapter.ingest(event);
    }

    const approvals = await adapter.listApprovals({
      project_id: prepared.current.project_id,
    });
    assert.equal(approvals.length, 1);
    assert.deepEqual({
      action: approvals[0].action,
      target: approvals[0].target,
      environment: approvals[0].environment,
      issued_at: approvals[0].issued_at,
      expires_at: approvals[0].expires_at,
      max_uses: approvals[0].max_uses,
      uses: approvals[0].uses,
    }, {
      action: 'deploy',
      target: 'build-42',
      environment: 'staging',
      issued_at: '2026-01-11T09:00:00.000Z',
      expires_at: '2026-01-11T23:59:59.000Z',
      max_uses: 1,
      uses: 0,
    });

    const productionWhileValid = await adapter.authorizeAction({
      project_id: prepared.current.project_id,
      action: 'deploy',
      target: 'build-42',
      environment: 'production',
      at: '2026-01-11T10:00:00Z',
    });
    assert.equal(productionWhileValid.authorized, false);

    const stagingWhileValid = await adapter.authorizeAction({
      project_id: prepared.current.project_id,
      action: 'deploy',
      target: 'build-42',
      environment: 'staging',
      at: '2026-01-11T10:00:00Z',
    });
    assert.equal(stagingWhileValid.authorized, true);

    const stagingLater = await adapter.authorizeAction({
      project_id: prepared.current.project_id,
      action: 'deploy',
      target: 'build-42',
      environment: 'staging',
      at: '2026-01-12T09:00:00Z',
    });
    assert.equal(stagingLater.authorized, false);
  } finally {
    await adapter.teardown();
  }
});
