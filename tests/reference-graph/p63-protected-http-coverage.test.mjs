import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  evaluateP63ProtectedCoverage,
} from '../../reference-graph/p63-protected-http-coverage.mjs';
import { runP63CoverageCli } from '../../reference-graph/cli/p63-audit-protected-coverage.mjs';

const start = '2026-11-08T22:00:00.000Z';
const end = '2026-11-09T22:00:00.000Z';
const now = new Date('2026-11-09T23:10:00.000Z');
const slot = n => new Date(Date.parse(start) + n * 7200000).toISOString();
const edge = (n, ok, denied = 0) => ({
  window_utc: slot(n), http_200: ok, http_non_200: denied,
  attempts: ok + denied,
});
const base = changes => ({
  startedAt: start, endedAt: end, edgeRows: [], asOf: now, ...changes,
});

function observation(n) {
  const anchor = Date.parse(slot(n));
  const instant = ms => new Date(anchor + ms).toISOString();
  return {
    schema_version: 'reference-graph.p61-protected-readonly-observation.v1',
    project_ref: 'vrznfnxzlxaavpqbzbzd',
    observed_at: instant(5 * 60000),
    completed_at: instant(5 * 60000 + 500),
    source_witness_sha256: 'a'.repeat(64),
    snapshot_date: instant(5 * 60000).slice(0, 10),
    refreshed_at: instant(60000),
    candidate_count: 275,
    http_get_requests: 1,
    bounded_transport_elapsed_ms: 500,
    server_only_transport_verified: true,
    source_provenance_independently_attested: false,
    twenty_four_hour_soak_complete: false,
    forty_eight_case_live_parity_attested: false,
    production_rollback_rehearsed: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
  };
}

test('P63 reports actual sparse 24h gateway coverage, filling all absent windows', () => {
  const actual = evaluateP63ProtectedCoverage(base({edgeRows:[edge(10, 4)]}));
  assert.equal(actual.two_hour_windows_expected, 12);
  assert.equal(actual.windows_with_protected_http_200, 1);
  assert.equal(actual.windows_with_p61_validated_observations, 0);
  assert.equal(actual.total_protected_http_200, 4);
  assert.equal(actual.total_protected_non_200, 0);
  assert.equal(actual.windows_without_protected_http_200.length, 11);
  assert.equal(actual.windows_without_p61_validated_observation.length, 12);
  assert.equal(actual.operator_claimed_full_window_coverage, false);
  assert.equal(actual.sustained_privileged_data_api_soak_verified, false);
  assert.equal(actual.activation_authorized, false);
});

test('P63 never counts HTTP 401 authentication negatives as protected success', () => {
  const r = evaluateP63ProtectedCoverage(base({ edgeRows: [edge(10,4), edge(11,0,2)] }));
  assert.equal(r.windows_with_protected_http_200, 1);
  assert.equal(r.total_protected_non_200, 2);
  assert.equal(r.windows_without_protected_http_200.length, 11);
  assert.equal(r.operator_claimed_full_window_coverage, false);
});

test('P63 complete synthetic 12-window input still NEVER authenticates external proof', () => {
  const rows = Array.from({length:12},(_,n)=>edge(n, 1));
  const observations = Array.from({length:12},(_,n)=>observation(n));
  const r = evaluateP63ProtectedCoverage(base({
    edgeRows: rows, operatorObservations: observations,
  }));
  assert.equal(r.windows_with_protected_http_200, 12);
  assert.equal(r.windows_with_p61_validated_observations, 12);
  assert.equal(r.operator_claimed_full_window_coverage, true);
  for (const k of [
    'edge_logs_independently_authenticated','complete_attempt_journal_verified',
    'p61_source_provenance_independently_attested',
    'sustained_privileged_data_api_soak_verified',
    'activation_authorized','repository_default_graph_enabled',
  ]) assert.equal(r[k],false,k);
  assert.doesNotMatch(JSON.stringify(r),/sb_secret_|search_text|asset_id/);
});

test('P63 rejects malformed windows, duplicated/unknown rows, dishonest HTTP counts', () => {
  const invalid = [
    {startedAt:'2026-11-08T23:00:00.000Z'},
    {startedAt:'2026-11-08T22:00:00+00:00'},
    {endedAt:'2026-11-09T20:00:00.000Z'},
    {endedAt:'2026-11-10T00:00:00.000Z'},
    {edgeRows:[edge(0,1),edge(0,2)]},
    {edgeRows:[edge(12,1)]},
    {edgeRows:[{...edge(0,1),unknown:true}]},
    {edgeRows:[{...edge(0,1),attempts:999}]},
    {edgeRows:[{...edge(0,1),http_200:-1}]},
    {edgeRows:[{...edge(0,1),http_200:0.5}]},
    {edgeRows:Array.from({length:13},(_,n)=>edge(n,1))},
    {asOf:new Date('2026-11-09T21:59:59.000Z')},
  ];
  for (const bad of invalid) {
    assert.throws(() => evaluateP63ProtectedCoverage(base(bad)),/P63.*BLOCKED/);
  }
});

test('P63 rejects forged, incomplete, out-of-window and retroactive P61 reports', () => {
  const bad = [
    p => {p.source_witness_sha256='UNVERIFIED';},
    p => {p.server_only_transport_verified=false;},
    p => {p.activation_authorized=true;},
    p => {p.candidate_count=0;},
    p => {p.http_get_requests=0;},
    p => {p.observed_at='2026-11-10T00:00:00.000Z';},
    p => {p.completed_at='2026-11-08T23:00:00.000Z';},
    p => {p.refreshed_at='2026-11-08T00:00:00.000Z';},
    p => {p.bounded_transport_elapsed_ms=20000;},
    p => {p.extra='secret';},
  ];
  for (const mutate of bad) {
    const p = observation(0);
    mutate(p);
    assert.throws(() => evaluateP63ProtectedCoverage(base({
      edgeRows:[edge(0,1)],operatorObservations:[p],
    })),/P63.*BLOCKED/);
  }
});

test('P63 CLI reads private sanitized input and emits no candidates or credentials', () => {
  const input = {
    schema_version:'reference-graph.p63-operator-coverage-input.v1',
    window_start_utc:start,window_end_utc:end,
    edge_windows:[edge(10,4)],operator_observations:[],
  };
  let output='';
  const r = runP63CoverageCli({
    argv:['--input','private/aggregate.json'],
    readText:()=>JSON.stringify(input),
    now,
    stdout:{write(x){output+=x;}},
  });
  assert.equal(r.windows_with_protected_http_200,1);
  assert.equal(JSON.parse(output).sustained_privileged_data_api_soak_verified,false);
  assert.doesNotMatch(output,/apikey|sb_secret|legacy_id|search_text/);
  assert.throws(()=>runP63CoverageCli({
    argv:['--input','a'],readText:()=>JSON.stringify({...input,secret:'no'}),
    now,stdout:{write(){throw Error('never');}},
  }),/BLOCKED/);
});

test('P63 stays offline, non-authorizing and unconnected to P11', () => {
  const content = readFileSync(new URL('../../reference-graph/p63-protected-http-coverage.mjs',import.meta.url),'utf8');
  const router = readFileSync(new URL('../../reference-graph/p11-runtime-router.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(router,/p63-protected-http-coverage/);
  assert.doesNotMatch(content,/fetch\(|process\.env|writeFileSync|http\.request|https\.request/);
  assert.ok(content.includes('activation_authorized: false'));
});
