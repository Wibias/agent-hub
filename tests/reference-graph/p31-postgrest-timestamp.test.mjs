import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { loadRecords } from '../../knowledge/design-references/scripts/lib.mjs';
import { buildP28OfflineProfileCandidatePool } from '../../reference-graph/p28-profile-candidate-contract.mjs';
import {
  P30ProfileTransportError,
  fetchP30ProfileCandidateSnapshot,
} from '../../reference-graph/p30-profile-transport.mjs';

const candidates = buildP28OfflineProfileCandidatePool({
  records: loadRecords(),
  now: new Date('2026-11-07T00:00:00.000Z'),
}).slice(0, 2);
const hash = createHash('sha256')
  .update(candidates.map(row => row.legacy_id).sort().join('\n'))
  .digest('hex');

async function readWithTimestamp(timestamp) {
  return fetchP30ProfileCandidateSnapshot({
    supabaseUrl: 'https://example.supabase.co/',
    publishableKey: 'sb_publishable_local',
    expectedDate: '2026-11-07',
    asOf: '2026-11-07T12:00:00.000Z',
    expectedCandidateCount: candidates.length,
    expectedCandidateIdSetSha256: hash,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => candidates.map(row => ({
        ...row,
        projection_version: 'reference-graph.profile-runtime.p30.v1',
        snapshot_date: '2026-11-07',
        refreshed_at: timestamp,
      })),
    }),
  });
}

test('P31 P30-client interoperability: accepts PostgREST UTC timestamptz with +00:00', async () => {
  const result = await readWithTimestamp('2026-11-07T11:30:00+00:00');
  assert.equal(result.transport.refreshed_at, '2026-11-07T11:30:00.000Z');
  assert.deepEqual(result.candidates, candidates);
});

test('P31 P30-client interoperability: canonicalizes PostgREST microseconds and rejects non-UTC offsets', async () => {
  const result = await readWithTimestamp('2026-11-07T11:30:00.123456+00:00');
  assert.equal(result.transport.refreshed_at, '2026-11-07T11:30:00.123Z');
  await assert.rejects(
    readWithTimestamp('2026-11-07T12:30:00+01:00'),
    error => error instanceof P30ProfileTransportError
      && error.category === 'snapshot-invalid',
  );
});
