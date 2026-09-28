import { performance } from 'node:perf_hooks';

import { prepareCase } from './runner.mjs';

const REQUIRED_METHODS = ['reset', 'setup', 'ingest', 'recall', 'teardown'];

export const OPTIONAL_LIFECYCLE_METHODS = [
  'exportMemory',
  'importMemory',
  'clearDerivedState',
  'interruptIngest',
  'recover',
  'inspectState',
];

export function assertAdapterContract(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('adapter must be an object');
  if (!adapter.metadata || typeof adapter.metadata !== 'object') throw new TypeError('adapter.metadata is required');

  const candidate = adapter.metadata.candidate;
  for (const field of ['name', 'version', 'source_revision']) {
    if (!candidate || typeof candidate[field] !== 'string' || candidate[field].length === 0) {
      throw new TypeError(`adapter.metadata.candidate.${field} is required`);
    }
  }
  if (typeof adapter.metadata.adapter_revision !== 'string' || adapter.metadata.adapter_revision.length === 0) {
    throw new TypeError('adapter.metadata.adapter_revision is required');
  }
  if (typeof adapter.metadata.network_required !== 'boolean') {
    throw new TypeError('adapter.metadata.network_required must be boolean');
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') throw new TypeError(`adapter.${method}() is required`);
  }
  return adapter;
}

function itemCount(recall) {
  return Array.isArray(recall?.items) ? recall.items.length : 0;
}

function payloadBytes(recall) {
  return Buffer.byteLength(JSON.stringify(recall ?? null), 'utf8');
}

export async function runRecallCase(adapter, caseId, root) {
  assertAdapterContract(adapter);
  const prepared = await prepareCase(caseId, root);
  let ingestLatency = 0;

  await adapter.reset();
  try {
    await adapter.setup(prepared);

    for (const event of prepared.events) {
      const started = performance.now();
      await adapter.ingest(event);
      ingestLatency += performance.now() - started;
    }

    const request = {
      case_id: prepared.case_id,
      query: prepared.query,
      project_id: prepared.current.project_id,
      branch: prepared.current.branch,
      revision_sha: prepared.current.revision_sha,
      repo_path: prepared.current.repo_path,
      harness: prepared.query_harness,
      limit: prepared.recall.limit,
    };

    const recallStarted = performance.now();
    const rawRecall = await adapter.recall(request);
    const recallLatency = performance.now() - recallStarted;

    return {
      case_id: caseId,
      fixture_revision: prepared.fixture_revision,
      candidate: adapter.metadata.candidate,
      adapter_revision: adapter.metadata.adapter_revision,
      network_required: adapter.metadata.network_required,
      raw_recall: rawRecall,
      metrics: {
        ingest_latency_ms: ingestLatency,
        recall_latency_ms: recallLatency,
        recall_payload_bytes: payloadBytes(rawRecall),
        memory_items_returned: itemCount(rawRecall),
      },
    };
  } finally {
    await adapter.teardown();
  }
}
