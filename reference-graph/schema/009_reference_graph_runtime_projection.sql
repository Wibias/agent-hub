-- P10 replaces the public SECURITY DEFINER runtime wrapper with a narrow,
-- current-date RLS-backed read projection. The certified P7 pool remains the
-- source of truth and may only be copied here through the service-role refresh.

create table if not exists public.reference_graph_quick_runtime_projection_p10 (
  asset_id uuid primary key,
  legacy_id text not null unique,
  product text,
  surface_family text,
  platform text,
  page_role text,
  motion text,
  source_family text,
  topology text,
  access_status text,
  evidence_class text,
  ordinary_or_failure_prone boolean not null,
  multi_state_flow boolean not null,
  tags jsonb not null,
  search_text text not null,
  snapshot_date date not null,
  refreshed_at timestamptz not null
);

alter table public.reference_graph_quick_runtime_projection_p10 enable row level security;

revoke all on table public.reference_graph_quick_runtime_projection_p10
  from public, anon, authenticated;
grant select on table public.reference_graph_quick_runtime_projection_p10
  to anon, authenticated;

drop policy if exists reference_graph_quick_runtime_current_p10
  on public.reference_graph_quick_runtime_projection_p10;
create policy reference_graph_quick_runtime_current_p10
  on public.reference_graph_quick_runtime_projection_p10
  for select
  to anon, authenticated
  using (snapshot_date = current_date);

-- Close the P9 publishable-key SECURITY DEFINER surface. The historical
-- function remains available to service_role for operator/debug use only.
revoke execute on function public.reference_graph_quick_candidate_pool_runtime_p9()
  from anon, authenticated;

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
  delete from public.reference_graph_quick_runtime_projection_p10;

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
    p.ordinary_or_failure_prone,
    p.multi_state_flow,
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
