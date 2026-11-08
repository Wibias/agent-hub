import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8');
const sql = () => read('reference-graph/schema/016_reference_graph_profile_access_p39.sql');
const doc = () => read('reference-graph/P39.md');
const workflow = () => read('.github/workflows/verify-reference-graph.yml');
const p30 = () => read('reference-graph/p30-profile-transport.mjs');
const p33 = () => read('reference-graph/p33-pinned-profile-parity.mjs');
const p37 = () => read('reference-graph/p37-single-snapshot-public-audit.mjs');

test('P39 closes direct base-table access for every runtime role', () => {
  const src = sql();
  assert.match(src, /revoke all on table public\.reference_graph_profile_runtime_projection_p30_v1\s+from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(src, /grant select on table public\.reference_graph_profile_runtime_projection_p30_v1\s+to (?:anon|authenticated)/i);
  assert.match(src, /to_regclass\('public\.reference_graph_profile_runtime_projection_p30_v1'\)/i);
  assert.match(src, /to_regprocedure\('public\.reference_graph_refresh_profile_runtime_projection_p31\(\)'\)/i);
});

test('P39 server view contains the full candidate surface and is service-only', () => {
  const src = sql();
  for (const field of [
    'asset_id', 'legacy_id', 'search_text', 'product', 'surface_family',
    'platform', 'page_role', 'motion', 'source_family', 'topology',
    'access_status', 'evidence_class', 'ordinary_or_failure_prone',
    'multi_state_flow', 'tags', 'primary_stratum', 'projection_version',
    'snapshot_date', 'refreshed_at',
  ]) {
    assert.ok(src.includes(field), 'server view missing ' + field);
  }
  assert.match(src, /create view public\.reference_graph_profile_candidates_server_p30_v1/i);
  assert.match(src, /security_barrier = true, security_invoker = true/i);
  assert.match(src, /grant select on public\.reference_graph_profile_candidates_server_p30_v1\s+to service_role/i);
  assert.match(src, /revoke all on public\.reference_graph_profile_candidates_server_p30_v1\s+from public, anon, authenticated, service_role/i);
  assert.match(src, /snapshot_date = \(statement_timestamp\(\) at time zone 'UTC'\)::date/i);
});

test('P39 public view exposes only operational freshness metadata', () => {
  const src = sql();
  assert.match(src, /create view public\.reference_graph_profile_public_p30_v1/i);
  assert.doesNotMatch(src, /public_id/i);
  assert.match(src, /security_barrier = true, security_invoker = true/i);
  assert.match(src, /select projection_version, snapshot_date, refreshed_at/i);
  assert.match(src, /grant select on public\.reference_graph_profile_public_p30_v1\s+to anon, authenticated/i);
  assert.match(doc(), /public view/i);
  assert.match(doc(), /product/i);
  assert.match(doc(), /opaque|randomized|salted/i);
});

test('P39 least-privilege column grants and BYPASSRLS service boundary support security-invoker views', () => {
  const src = sql();
  assert.match(src, /grant select \(projection_version, snapshot_date, refreshed_at\)/i);
  assert.match(src, /to anon, authenticated/i);
  assert.match(src, /grant select on table public\.reference_graph_profile_runtime_projection_p30_v1\s+to service_role/i);
  assert.doesNotMatch(src, /create policy reference_graph_profile_runtime_p31_service_snapshot/i);
  assert.match(doc(), /BYPASSRLS/i);
  assert.match(doc(), /historical/i);
  assert.doesNotMatch(src, /security definer/i);
});

test('P39 does not reapply P31/P38 or touch Quick/P10 cron state', () => {
  const src = sql();
  assert.doesNotMatch(src, /cron\.schedule|reference_graph_quick_runtime_projection_p10|reference_graph_refresh_quick_runtime_projection_p10/i);
  assert.doesNotMatch(src, /create table public\.reference_graph_profile_runtime_projection_p30_v1/i);
  assert.match(doc(), /already installed/i);
  assert.match(doc(), /Rollback/i);
  assert.match(doc(), /grant select on public\.reference_graph_profile_runtime_projection_p30_v1/i);
  assert.match(doc(), /revoke all on table public\.reference_graph_profile_runtime_projection_p30_v1/i);
  assert.match(doc(), /break-glass/i);
});

test('P39 server transport and parity callers are wired without public credentials', () => {
  assert.match(p30(), /accessMode = 'publishable'|accessMode = 'server'/);
  assert.match(p30(), /SERVER_PROJECTION/);
  assert.match(p30(), /Prefer: 'count=exact'/);
  assert.match(p33(), /serviceKey/);
  assert.match(p33(), /accessMode/);
  assert.match(p37(), /serviceKey/);
  assert.match(p37(), /accessMode/);
  assert.doesNotMatch(p30(), /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});

test('P39 CI applies the additive access migration and runs the negative access smoke', () => {
  const src = workflow();
  assert.match(src, /016_reference_graph_profile_access_p39\.sql/);
  assert.match(src, /p39-profile-access-smoke\.sql/);
  const smoke = read('tests/reference-graph/p39-profile-access-smoke.sql');
  assert.match(smoke, /set role anon/i);
  assert.match(smoke, /set role authenticated/i);
  assert.match(smoke, /set role service_role/i);
  assert.match(smoke, /insufficient_privilege/i);
  assert.match(smoke, /p39_public_view_columns/i);
  assert.match(smoke, /p39_service_role_bypassrls/i);
  assert.match(read('tests/reference-graph/p39-profile-access-fixture.sql'), /alter role service_role bypassrls/i);
  assert.match(smoke, /search_text/i);
});

test('P39 P38 monitor is fixture-only, read-only and non-activating', () => {
  const monitor = read('reference-graph/p39-p38-monitor.mjs');
  const cli = read('reference-graph/cli/p39-p38-monitor.mjs');
  assert.doesNotMatch(monitor + cli, /fetch\(|Supabase|SUPABASE|cron\.schedule|apply_migration|execute_sql/i);
  assert.match(monitor, /auto_remediation: false/);
  assert.match(monitor, /activation_performed: false/);
  assert.match(cli, /evaluateP38Health/);
  assert.match(cli, /planP38Alerts/);
  assert.match(monitor, /p39-p38-health\.v2/);
  assert.match(monitor, /consecutive_failed/);
  assert.match(monitor, /evaluateP38Soak/);
  assert.match(monitor, /HEALTHY_PROBE_SEPARATION_MS/);
  assert.match(cli, /--state-out/);
  const cycleProducer = read('reference-graph/p39-p38-health-snapshot.sql');
  assert.match(cycleProducer, /cron\.job_run_details/);
  assert.match(cycleProducer, /consecutive_failed/);
  assert.match(cycleProducer, /last_cycle_status/);
  assert.match(doc(), /12 two-hour cycles/i);
  assert.match(doc(), /two independent healthy/i);
});

test('P39 documents security-invoker views, RLS boundary and advisor gate', () => {
  const text = doc();
  assert.match(text, /security-invoker view review/i);
  assert.match(text, /security_invoker/i);
  assert.match(text, /caller's privileges|invoker/i);
  assert.match(text, /Supabase Security Advisor/i);
  assert.match(text, /security_definer_view/i);
  assert.match(text, /column-level SELECT/i);
});

test('P39 production monitoring is prepared without a service credential or activation', () => {
  const publicMonitor = read('reference-graph/p39-p38-public-health.mjs');
  const publicCli = read('reference-graph/cli/p39-p38-public-monitor.mjs');
  const runtime = read('reference-graph/p39-p38-runtime.mjs');
  const runner = read('reference-graph/ops/p39-p38-monitor-runner.ps1');
  const registration = read('reference-graph/ops/register-p39-p38-monitor.ps1');
  const activation = read('reference-graph/ops/P39-MONITOR-ACTIVATION.md');
  assert.match(publicCli, /SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(publicCli, /SUPABASE_SECRET_KEY/);
  assert.match(publicMonitor, /public-freshness-only/);
  assert.match(runtime, /writeP38AlertStateAtomic/);
  assert.match(runtime, /state-locked/);
  assert.match(runner, /Remove-Item Env:SUPABASE_SECRET_KEY/);
  assert.match(runner, /Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(registration, /-Apply/);
  assert.match(registration, /DRY-RUN ONLY/);
  assert.doesNotMatch(registration, /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(activation, /PREPARED \/ NOT ACTIVATED/);
  assert.match(activation, /database_changes|database, cron or routing/i);
  assert.match(doc(), /full P38 monitor remains \*\*BLOCKED\*\*/i);
});
