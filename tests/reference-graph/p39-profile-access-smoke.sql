-- Disposable PostgreSQL smoke only. Never point this at production.
-- Requires the installed P31 projection and migration 016.
\set ON_ERROR_STOP on

delete from public.reference_graph_profile_runtime_projection_p30_v1
where legacy_id = 'p39-stale-row';

insert into public.reference_graph_profile_runtime_projection_p30_v1 (
  asset_id, legacy_id, search_text, product, surface_family, platform,
  page_role, motion, source_family, topology, access_status, evidence_class,
  ordinary_or_failure_prone, multi_state_flow, tags, primary_stratum,
  projection_version, snapshot_date, refreshed_at
) values (
  'a0000000-0000-5000-8000-000000000099', 'p39-stale-row',
  'p39 private source text', 'p39', 'public-home', 'web-responsive',
  'home', 'subtle', 'p39-source', 'p39-topology', 'AVAILABLE', 'TESTED',
  false, false, '["p39-internal-tag"]'::jsonb, 'direct-domain',
  'reference-graph.profile-runtime.p30.v1',
  (statement_timestamp() at time zone 'UTC')::date - 1,
  statement_timestamp()
);

select count(*) as p39_current_count
from public.reference_graph_profile_runtime_projection_p30_v1
where snapshot_date = (statement_timestamp() at time zone 'UTC')::date
\gset

select 1 / case when
  has_any_column_privilege('anon', 'public.reference_graph_profile_runtime_projection_p30_v1', 'SELECT')
  and has_column_privilege('anon', 'public.reference_graph_profile_runtime_projection_p30_v1', 'snapshot_date', 'SELECT')
  and has_column_privilege('authenticated', 'public.reference_graph_profile_runtime_projection_p30_v1', 'refreshed_at', 'SELECT')
  and not has_column_privilege('anon', 'public.reference_graph_profile_runtime_projection_p30_v1', 'search_text', 'SELECT')
  and not has_column_privilege('anon', 'public.reference_graph_profile_runtime_projection_p30_v1', 'product', 'SELECT')
  and not has_column_privilege('authenticated', 'public.reference_graph_profile_runtime_projection_p30_v1', 'tags', 'SELECT')
  and not has_column_privilege('authenticated', 'public.reference_graph_profile_runtime_projection_p30_v1', 'asset_id', 'SELECT')
  and has_table_privilege('service_role', 'public.reference_graph_profile_runtime_projection_p30_v1', 'SELECT')
then 1 else 0 end as p39_base_sensitive_columns_closed;

select 1 / case when
  has_table_privilege('service_role', 'public.reference_graph_profile_candidates_server_p30_v1', 'SELECT')
  and not has_table_privilege('anon', 'public.reference_graph_profile_candidates_server_p30_v1', 'SELECT')
  and not has_table_privilege('authenticated', 'public.reference_graph_profile_candidates_server_p30_v1', 'SELECT')
then 1 else 0 end as p39_server_view_service_only;

select 1 / case when
  has_table_privilege('anon', 'public.reference_graph_profile_public_p30_v1', 'SELECT')
  and has_table_privilege('authenticated', 'public.reference_graph_profile_public_p30_v1', 'SELECT')
  and not has_table_privilege('service_role', 'public.reference_graph_profile_public_p30_v1', 'SELECT')
then 1 else 0 end as p39_public_view_roles;

select 1 / case when (
  select array_agg(column_name::text order by ordinal_position)
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'reference_graph_profile_candidates_server_p30_v1'
) = array[
  'asset_id','legacy_id','search_text','product','surface_family','platform',
  'page_role','motion','source_family','topology','access_status','evidence_class',
  'ordinary_or_failure_prone','multi_state_flow','tags','primary_stratum',
  'projection_version','snapshot_date','refreshed_at'
]::text[] then 1 else 0 end as p39_server_view_columns;

select 1 / case when (
  select array_agg(column_name::text order by ordinal_position)
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'reference_graph_profile_public_p30_v1'
) = array['projection_version','snapshot_date','refreshed_at']::text[]
then 1 else 0 end as p39_public_view_columns;

select 1 / case when not exists (
  select 1 from information_schema.columns
  where table_schema = 'public'
    and table_name = 'reference_graph_profile_public_p30_v1'
    and column_name in ('product','search_text','tags','asset_id','legacy_id','public_id','source_family','topology')
) then 1 else 0 end as p39_public_sensitive_columns_absent;

select 1 / case when
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'reference_graph_profile_runtime_projection_p30_v1')
  and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'reference_graph_profile_candidates_server_p30_v1'
     and c.reloptions @> array['security_barrier=true','security_invoker=true'])
  and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'reference_graph_profile_public_p30_v1'
     and c.reloptions @> array['security_barrier=true','security_invoker=true'])
  and exists (select 1 from pg_policies
   where schemaname = 'public'
     and tablename = 'reference_graph_profile_runtime_projection_p30_v1'
     and policyname = 'reference_graph_profile_runtime_p31_service_snapshot'
     and 'service_role' = any(roles))
then 1 else 0 end as p39_rls_and_security_invoker;

set role anon;
select 1 / case when count(*) = :p39_current_count
  then 1 else 0 end as p39_anon_current_public_rows
from public.reference_graph_profile_public_p30_v1;

do $$
begin
  begin
    execute 'select search_text from public.reference_graph_profile_runtime_projection_p30_v1 limit 1';
    raise exception 'anon sensitive base column read unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;

do $$
begin
  begin
    execute 'select count(*) from public.reference_graph_profile_candidates_server_p30_v1';
    raise exception 'anon server view read unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set role authenticated;
select 1 / case when count(*) = :p39_current_count
  then 1 else 0 end as p39_authenticated_current_public_rows
from public.reference_graph_profile_public_p30_v1;

do $$
begin
  begin
    execute 'select search_text from public.reference_graph_profile_runtime_projection_p30_v1 limit 1';
    raise exception 'authenticated sensitive base column read unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;

do $$
begin
  begin
    execute 'select count(*) from public.reference_graph_profile_candidates_server_p30_v1';
    raise exception 'authenticated server view read unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set role service_role;
select 1 / case when count(*) = :p39_current_count
  then 1 else 0 end as p39_service_current_server_rows
from public.reference_graph_profile_candidates_server_p30_v1;

select 1 / case when count(*) = :p39_current_count
  then 1 else 0 end as p39_service_current_base_rows
from public.reference_graph_profile_runtime_projection_p30_v1;

do $$
begin
  begin
    execute 'select count(*) from public.reference_graph_profile_public_p30_v1';
    raise exception 'service_role public view read unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

delete from public.reference_graph_profile_runtime_projection_p30_v1
where legacy_id = 'p39-stale-row';
