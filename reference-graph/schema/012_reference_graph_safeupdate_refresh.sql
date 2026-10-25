-- P20 keeps the P10 current-date projection refresh compatible with Supabase
-- safeupdate without weakening safeupdate globally. Historical migration 009
-- remains immutable; this migration replaces only the refresh function body.

create or replace function public.reference_graph_refresh_quick_runtime_projection_p10()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, reference_graph
set statement_timeout = '5s'
as $$
declare
  v_refreshed_at timestamptz := clock_timestamp();
  v_count integer;
begin
  delete from public.reference_graph_quick_runtime_projection_p10
  where true;

  insert into public.reference_graph_quick_runtime_projection_p10 (
    asset_id,
    legacy_id,
    product,
    surface_family,
    platform,
    page_role,
    motion,
    source_family,
    topology,
    access_status,
    evidence_class,
    ordinary_or_failure_prone,
    multi_state_flow,
    tags,
    search_text,
    snapshot_date,
    refreshed_at
  )
  select
    p.asset_id,
    p.legacy_id,
    p.product,
    p.surface_family,
    p.platform,
    p.page_role,
    p.motion,
    p.source_family,
    p.topology,
    p.access_status,
    p.evidence_class,
    coalesce(p.ordinary_or_failure_prone, false),
    coalesce(p.multi_state_flow, false),
    p.tags,
    p.search_text,
    current_date,
    v_refreshed_at
  from public.reference_graph_quick_candidate_pool_p7(
    jsonb_build_object('reference_date', current_date::text)
  ) p;

  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'snapshot_date', current_date::text,
    'candidate_count', v_count,
    'refreshed_at', v_refreshed_at
  );
end;
$$;

revoke all on function public.reference_graph_refresh_quick_runtime_projection_p10()
  from public, anon, authenticated, service_role;
grant execute on function public.reference_graph_refresh_quick_runtime_projection_p10()
  to service_role;
