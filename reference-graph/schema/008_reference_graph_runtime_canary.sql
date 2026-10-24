-- P9 exposes one narrow current-date runtime surface for the already-certified
-- P7 quick candidate pool. The normal production query path remains legacy-only.
-- Runtime callers receive no arbitrary filters, historical date control, table
-- privileges, or access to the underlying service-role-only P7/P6 RPCs.

create or replace function public.reference_graph_quick_candidate_pool_runtime_p9()
returns table(
  asset_id uuid,
  legacy_id text,
  product text,
  surface_family text,
  platform text,
  page_role text,
  motion text,
  source_family text,
  topology text,
  access_status text,
  evidence_class text,
  ordinary_or_failure_prone boolean,
  multi_state_flow boolean,
  tags jsonb,
  search_text text
)
language sql
stable
security definer
set search_path = pg_catalog, public, reference_graph
set statement_timeout = '2s'
as $$
  select *
  from public.reference_graph_quick_candidate_pool_p7(
    jsonb_build_object('reference_date', current_date::text)
  );
$$;

revoke all on function public.reference_graph_quick_candidate_pool_runtime_p9()
  from public, anon, authenticated, service_role;
grant execute on function public.reference_graph_quick_candidate_pool_runtime_p9()
  to anon, authenticated, service_role;
