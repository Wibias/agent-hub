-- P39: close the P31 base-table exposure and add explicit access surfaces.
-- This migration is intentionally additive to the already-installed P31/P38
-- state. It does not re-run 014/015 or modify the P38 cron job.

begin;

do $guard$
begin
  if to_regclass('public.reference_graph_profile_runtime_projection_p30_v1') is null then
    raise exception 'P39 requires the installed P31 projection';
  end if;
  if to_regprocedure('public.reference_graph_refresh_profile_runtime_projection_p31()') is null then
    raise exception 'P39 requires the installed P31 refresh function';
  end if;
end;
$guard$;

-- No runtime role reads the base table directly. The table remains the
-- versioned source for the service-only and public views below.
revoke all on table public.reference_graph_profile_runtime_projection_p30_v1
  from public, anon, authenticated, service_role;

-- Full candidate material is needed only by the server-side P30/P33/P34/P37
-- audit path. The view is owned by the migration role, filters to the current
-- UTC snapshot, and is executable/readable only through the service role.
drop view if exists public.reference_graph_profile_candidates_server_p30_v1;
create view public.reference_graph_profile_candidates_server_p30_v1
with (security_barrier = true)
as
select
  asset_id, legacy_id, search_text, product, surface_family, platform,
  page_role, motion, source_family, topology, access_status, evidence_class,
  ordinary_or_failure_prone, multi_state_flow, tags, primary_stratum,
  projection_version, snapshot_date, refreshed_at
from public.reference_graph_profile_runtime_projection_p30_v1
where snapshot_date = (statement_timestamp() at time zone 'UTC')::date;

revoke all on public.reference_graph_profile_candidates_server_p30_v1
  from public, anon, authenticated, service_role;
grant select on public.reference_graph_profile_candidates_server_p30_v1
  to service_role;

comment on view public.reference_graph_profile_candidates_server_p30_v1 is
  'P39 full P30 candidate snapshot; service_role only; current UTC date only';

-- Public consumers get stable pseudonymous IDs and non-sensitive selection
-- metadata. Source text, editorial tags, provenance/topology and internal IDs
-- are deliberately absent.
drop view if exists public.reference_graph_profile_public_p30_v1;
create view public.reference_graph_profile_public_p30_v1
with (security_barrier = true)
as
select
  encode(sha256(convert_to(legacy_id, 'UTF8')), 'hex') as public_id,
  product, surface_family, platform, page_role, motion, access_status,
  evidence_class, ordinary_or_failure_prone, multi_state_flow,
  primary_stratum, projection_version, snapshot_date, refreshed_at
from public.reference_graph_profile_runtime_projection_p30_v1
where snapshot_date = (statement_timestamp() at time zone 'UTC')::date;

revoke all on public.reference_graph_profile_public_p30_v1
  from public, anon, authenticated, service_role;
grant select on public.reference_graph_profile_public_p30_v1
  to anon, authenticated;

comment on view public.reference_graph_profile_public_p30_v1 is
  'P39 public P30 metadata; pseudonymous public_id; no source text, tags or internal IDs';

commit;
