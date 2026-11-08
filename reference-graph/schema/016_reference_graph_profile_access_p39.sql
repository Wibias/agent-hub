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

-- Runtime roles lose broad table access. anon/authenticated receive only the
-- three freshness columns required by the security-invoker public view;
-- service_role is the trusted server boundary and needs full SELECT for the
-- security-invoker server view. The base table remains the versioned source.
revoke all on table public.reference_graph_profile_runtime_projection_p30_v1
  from public, anon, authenticated, service_role;

-- security_invoker views require the invoker to hold the underlying column
-- privileges. Public roles receive only the three non-sensitive freshness
-- columns; service_role is the trusted server boundary and needs the full
-- candidate surface. RLS remains enabled for every invoker.
grant select (projection_version, snapshot_date, refreshed_at)
  on table public.reference_graph_profile_runtime_projection_p30_v1
  to anon, authenticated;
grant select on table public.reference_graph_profile_runtime_projection_p30_v1
  to service_role;

drop policy if exists reference_graph_profile_runtime_p31_service_snapshot
  on public.reference_graph_profile_runtime_projection_p30_v1;
create policy reference_graph_profile_runtime_p31_service_snapshot
  on public.reference_graph_profile_runtime_projection_p30_v1
  for select
  to service_role
  using (snapshot_date = (statement_timestamp() at time zone 'UTC')::date);

-- Full candidate material is needed only by the server-side P30/P33/P34/P37
-- audit path. The view is owned by the migration role, filters to the current
-- UTC snapshot, and is executable/readable only through the service role.
drop view if exists public.reference_graph_profile_candidates_server_p30_v1;
create view public.reference_graph_profile_candidates_server_p30_v1
with (security_barrier = true, security_invoker = true)
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

-- The only public surface is operational freshness metadata. It has a named
-- consumer (the read-only P38 monitor) and deliberately exposes no product,
-- source text, tags, provenance, internal IDs, or derived pseudonymous IDs.
drop view if exists public.reference_graph_profile_public_p30_v1;
create view public.reference_graph_profile_public_p30_v1
with (security_barrier = true, security_invoker = true)
as
select projection_version, snapshot_date, refreshed_at
from public.reference_graph_profile_runtime_projection_p30_v1
where snapshot_date = (statement_timestamp() at time zone 'UTC')::date;

revoke all on public.reference_graph_profile_public_p30_v1
  from public, anon, authenticated, service_role;
grant select on public.reference_graph_profile_public_p30_v1
  to anon, authenticated;

comment on view public.reference_graph_profile_public_p30_v1 is
  'P39 public P38 freshness metadata only; no product, source text, tags or IDs';

-- A broader public view is deliberately not created. There is no proven
-- consumer for product/IDs, and product/source classification plus an
-- opaque-ID design are not yet approved. Any broader public surface must be a
-- separately reviewed migration with explicit classification and opaque IDs.

commit;
