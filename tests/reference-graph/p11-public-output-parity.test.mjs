import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPatterns, loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP8OfflineQuickCandidatePool } from '../../reference-graph/p8-cutover-review.mjs';
import { runP11RuntimeQuery } from '../../reference-graph/p11-runtime-router.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cases = JSON.parse(readFileSync(path.join(root, 'reference-graph/shadow-cases.json'), 'utf8'));
const quickCase = cases.find((row) => row.profile === 'quick');
const records = loadRecords();
const patterns = loadPatterns();
const now = new Date('2026-10-23T12:00:00.000Z');
const candidates = buildP8OfflineQuickCandidatePool(records, { now });

function requestFromCase(row) {
  return {
    profile: row.profile,
    limit: row.limit,
    surface: row.surface,
    platform: row.platform,
    job: row.job,
    dimensions: row.dimensions,
  };
}

test('graph-authoritative quick output is structurally identical to default legacy public JSON', async () => {
  const request = requestFromCase(quickCase);
  const legacy = await runP11RuntimeQuery({
    records,
    patterns,
    request,
    graphMode: 'legacy',
    recordUsageEnabled: false,
    now,
  });
  const graph = await runP11RuntimeQuery({
    records,
    patterns,
    request,
    graphMode: 'graph',
    fetchCandidatePool: async () => ({ candidates }),
    recordUsageEnabled: false,
    now,
  });

  assert.equal(graph.routing.authoritative_source, 'reference-graph');
  assert.equal(graph.routing.record_exact, true);
  assert.equal(graph.routing.pattern_exact, true);
  assert.deepEqual(graph.result, legacy.result);
  assert.equal(JSON.stringify(graph.result).includes('__file'), false);
});
