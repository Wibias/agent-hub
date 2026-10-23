import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

import {
  loadPatterns,
  loadRecords,
} from '../knowledge/design-references/scripts/lib.mjs';
import { fetchP10QuickCandidatePool } from './p10-runtime-client.mjs';
import { runP11RuntimeQuery } from './p11-runtime-router.mjs';

const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
const referenceDate = String(process.env.REFERENCE_DATE || '').trim();
if (!supabaseUrl || !publishableKey || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
  throw new Error('P11 live canary requires URL, publishable key, and YYYY-MM-DD reference date');
}

const records = loadRecords();
const patterns = loadPatterns();
const cases = JSON.parse(fs.readFileSync(new URL('./shadow-cases.json', import.meta.url), 'utf8'));
const now = new Date(`${referenceDate}T12:00:00.000Z`);
const queryCli = new URL('../knowledge/design-references/scripts/query.mjs', import.meta.url);

function requestFor(c) {
  return {
    profile: c.profile,
    limit: c.limit,
    surface: c.surface,
    platform: c.platform,
    job: c.job,
    dimensions: c.dimensions,
  };
}

function cliArgs(c) {
  return [
    queryCli.pathname,
    '--profile', c.profile,
    '--limit', String(c.limit),
    '--surface', c.surface,
    '--platform', c.platform,
    '--job', c.job,
    '--dimensions', c.dimensions,
    '--no-record-usage',
  ];
}

function runCli(c, envPatch = {}) {
  const env = { ...process.env, ...envPatch };
  for (const key of ['REFERENCE_GRAPH_QUICK_RUNTIME', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']) {
    if (envPatch[key] === null) delete env[key];
  }
  const proc = spawnSync(process.execPath, cliArgs(c), {
    env,
    encoding: 'utf8',
    timeout: 15000,
  });
  if (proc.error) throw proc.error;
  if (![0, 2].includes(proc.status)) {
    throw new Error(`query CLI failed for ${c.id}: ${proc.stderr || proc.stdout}`);
  }
  return { exit_code: proc.status, result: JSON.parse(proc.stdout) };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function fakeResponse(payload, { ok = true, status = 200, invalidJson = false } = {}) {
  return {
    ok,
    status,
    async json() {
      if (invalidJson) throw new Error('invalid json');
      return structuredClone(payload);
    },
  };
}

const remote = await fetchP10QuickCandidatePool({
  supabaseUrl,
  publishableKey,
  timeoutMs: 5000,
  expectedDate: referenceDate,
});
if (remote.candidates.length !== 275) {
  throw new Error(`expected 275 current live candidates, got ${remote.candidates.length}`);
}

const rows = [];
for (const c of cases) {
  const request = requestFor(c);
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
    fetchCandidatePool: async () => remote,
    recordUsageEnabled: false,
    now,
  });

  const defaultCli = runCli(c, {
    REFERENCE_GRAPH_QUICK_RUNTIME: null,
    SUPABASE_URL: null,
    SUPABASE_PUBLISHABLE_KEY: null,
  });
  const graphCli = runCli(c, {
    REFERENCE_GRAPH_QUICK_RUNTIME: 'graph',
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
  });

  rows.push({
    id: c.id,
    routing_source: graph.routing.authoritative_source,
    attempted: graph.routing.attempted,
    record_exact: graph.routing.record_exact,
    pattern_exact: graph.routing.pattern_exact,
    router_public_equivalent: sameJson(graph.result, legacy.result),
    default_cli_exit_code: defaultCli.exit_code,
    graph_cli_exit_code: graphCli.exit_code,
    cli_public_equivalent: sameJson(graphCli.result, defaultCli.result),
    graph_cli_coverage_gap_count: graphCli.result.coverageGaps.length,
  });
}

const probeCase = cases[0];
const probeRequest = requestFor(probeCase);
const probeLegacy = await runP11RuntimeQuery({
  records,
  patterns,
  request: probeRequest,
  graphMode: 'legacy',
  recordUsageEnabled: false,
  now,
});

async function fallbackProbe(fetchCandidatePool) {
  const out = await runP11RuntimeQuery({
    records,
    patterns,
    request: probeRequest,
    graphMode: 'graph',
    fetchCandidatePool,
    recordUsageEnabled: false,
    now,
  });
  return out.routing.authoritative_source === 'legacy-control'
    && sameJson(out.result, probeLegacy.result);
}

const transportFailureFallback = await fallbackProbe(async () => {
  throw new Error('intentional transport failure');
});

const missingConfig = await runP11RuntimeQuery({
  records,
  patterns,
  request: probeRequest,
  graphMode: 'graph',
  recordUsageEnabled: false,
  now,
});
const missingKeyZeroFetchFallback = missingConfig.routing.attempted === false
  && missingConfig.routing.authoritative_source === 'legacy-control'
  && sameJson(missingConfig.result, probeLegacy.result);

const staleRows = remote.candidates.map((row) => ({ ...row, snapshot_date: '2026-10-22' }));
const staleSnapshotFallback = await fallbackProbe(() => fetchP10QuickCandidatePool({
  supabaseUrl,
  publishableKey,
  timeoutMs: 1500,
  expectedDate: referenceDate,
  fetchImpl: async () => fakeResponse(staleRows),
}));
const emptySnapshotFallback = await fallbackProbe(() => fetchP10QuickCandidatePool({
  supabaseUrl,
  publishableKey,
  timeoutMs: 1500,
  expectedDate: referenceDate,
  fetchImpl: async () => fakeResponse([]),
}));
const malformedPayloadFallback = await fallbackProbe(() => fetchP10QuickCandidatePool({
  supabaseUrl,
  publishableKey,
  timeoutMs: 1500,
  expectedDate: referenceDate,
  fetchImpl: async () => fakeResponse({ not: 'an array' }),
}));

let graphUsageCount = 0;
const usageGraph = await runP11RuntimeQuery({
  records,
  patterns,
  request: probeRequest,
  graphMode: 'graph',
  fetchCandidatePool: async () => remote,
  recordUsageFn: () => { graphUsageCount += 1; },
  now,
});
let fallbackUsageCount = 0;
const usageFallback = await runP11RuntimeQuery({
  records,
  patterns,
  request: probeRequest,
  graphMode: 'graph',
  fetchCandidatePool: async () => { throw new Error('intentional'); },
  recordUsageFn: () => { fallbackUsageCount += 1; },
  now,
});

const noNetwork = {};
for (const [profile, limit] of [['standard', 8], ['deep', 20]]) {
  let fetchCount = 0;
  const request = { ...probeRequest, profile, limit };
  const out = await runP11RuntimeQuery({
    records,
    patterns,
    request,
    graphMode: 'graph',
    fetchCandidatePool: async () => {
      fetchCount += 1;
      throw new Error('network must not run');
    },
    recordUsageEnabled: false,
    now,
  });
  noNetwork[profile] = {
    fetch_count: fetchCount,
    authoritative_source: out.routing.authoritative_source,
    equivalent_to_legacy: out.routing.attempted === false,
  };
}

const defaultCliEquivalentCount = rows.filter((row) => row.cli_public_equivalent).length;
const authoritativeGraphCount = rows.filter((row) => row.routing_source === 'reference-graph').length;
const exactRecordCount = rows.filter((row) => row.record_exact === true).length;
const exactPatternCount = rows.filter((row) => row.pattern_exact === true).length;
const coverageExitExactCount = rows.filter((row) => row.graph_cli_exit_code === row.default_cli_exit_code).length;
const mismatchCount = rows.filter((row) => (
  row.routing_source !== 'reference-graph'
  || row.record_exact !== true
  || row.pattern_exact !== true
  || row.router_public_equivalent !== true
  || row.cli_public_equivalent !== true
  || row.graph_cli_exit_code !== row.default_cli_exit_code
)).length;

const summary = {
  schema_version: 'reference-graph.p11-live-activation-canary.v1',
  reference_date: referenceDate,
  auth_mode: 'publishable',
  candidate_count: remote.candidates.length,
  case_count: rows.length,
  default_cli_equivalent_count: defaultCliEquivalentCount,
  authoritative_graph_count: authoritativeGraphCount,
  exact_record_count: exactRecordCount,
  exact_pattern_count: exactPatternCount,
  coverage_exit_exact_count: coverageExitExactCount,
  mismatch_count: mismatchCount,
  fallback: {
    transport_failure: transportFailureFallback,
    missing_key_zero_fetch: missingKeyZeroFetchFallback,
    stale_snapshot: staleSnapshotFallback,
    empty_snapshot: emptySnapshotFallback,
    malformed_payload: malformedPayloadFallback,
  },
  usage: {
    graph_authoritative_source: usageGraph.routing.authoritative_source,
    graph_write_count: graphUsageCount,
    fallback_authoritative_source: usageFallback.routing.authoritative_source,
    fallback_write_count: fallbackUsageCount,
  },
  no_network: noNetwork,
  rows,
};

fs.writeFileSync('/tmp/p11-live-activation-canary.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify({
  reference_date: summary.reference_date,
  auth_mode: summary.auth_mode,
  candidate_count: summary.candidate_count,
  case_count: summary.case_count,
  default_cli_equivalent_count: summary.default_cli_equivalent_count,
  authoritative_graph_count: summary.authoritative_graph_count,
  exact_record_count: summary.exact_record_count,
  exact_pattern_count: summary.exact_pattern_count,
  coverage_exit_exact_count: summary.coverage_exit_exact_count,
  mismatch_count: summary.mismatch_count,
  fallback: summary.fallback,
  usage: summary.usage,
  no_network: summary.no_network,
}, null, 2));

const ok = summary.case_count === 24
  && summary.default_cli_equivalent_count === 24
  && summary.authoritative_graph_count === 24
  && summary.exact_record_count === 24
  && summary.exact_pattern_count === 24
  && summary.coverage_exit_exact_count === 24
  && summary.mismatch_count === 0
  && Object.values(summary.fallback).every((value) => value === true)
  && summary.usage.graph_authoritative_source === 'reference-graph'
  && summary.usage.graph_write_count === 1
  && summary.usage.fallback_authoritative_source === 'legacy-control'
  && summary.usage.fallback_write_count === 1
  && summary.no_network.standard.fetch_count === 0
  && summary.no_network.standard.authoritative_source === 'legacy-control'
  && summary.no_network.deep.fetch_count === 0
  && summary.no_network.deep.authoritative_source === 'legacy-control';
if (!ok) process.exitCode = 1;
