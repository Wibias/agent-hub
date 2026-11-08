-- Disposable PostgreSQL fixture for the P39 access smoke. Never use in production.
\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;
create extension if not exists pgcrypto;

drop table if exists public.reference_graph_profile_runtime_projection_p30_v1 cascade;
drop function if exists public.reference_graph_refresh_profile_runtime_projection_p31();

create table public.reference_graph_profile_runtime_projection_p30_v1 (
  asset_id uuid primary key,
  legacy_id text not null unique,
  search_text text not null,
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
  tags jsonb not null check (jsonb_typeof(tags) = 'array'),
  primary_stratum text not null check (
    primary_stratum in ('direct-domain', 'evidence-craft', 'adjacent-domain', 'outside-domain')
  ),
  projection_version text not null check (
    projection_version = 'reference-graph.profile-runtime.p30.v1'
  ),
  snapshot_date date not null,
  refreshed_at timestamptz not null
);

alter table public.reference_graph_profile_runtime_projection_p30_v1
  enable row level security;

create policy p39_fixture_utc_snapshot
  on public.reference_graph_profile_runtime_projection_p30_v1
  for select
  to anon, authenticated
  using (snapshot_date = (statement_timestamp() at time zone 'UTC')::date);

create function public.reference_graph_refresh_profile_runtime_projection_p31()
returns jsonb language sql as $$ select '{}'::jsonb $$;

insert into public.reference_graph_profile_runtime_projection_p30_v1 (
  asset_id, legacy_id, search_text, product, surface_family, platform,
  page_role, motion, source_family, topology, access_status, evidence_class,
  ordinary_or_failure_prone, multi_state_flow, tags, primary_stratum,
  projection_version, snapshot_date, refreshed_at
) values
  ('a0000000-0000-5000-8000-000000000001', 'p39-current-row-1',
   'p39 private source text one', 'p39', 'public-home', 'web-responsive',
   'home', 'subtle', 'p39-source', 'p39-topology-1', 'AVAILABLE', 'TESTED',
   false, false, '["p39-internal-tag"]'::jsonb, 'direct-domain',
   'reference-graph.profile-runtime.p30.v1',
   (statement_timestamp() at time zone 'UTC')::date, statement_timestamp()),
  ('a0000000-0000-5000-8000-000000000002', 'p39-current-row-2',
   'p39 private source text two', 'p39', 'public-home', 'web-responsive',
   'home', 'subtle', 'p39-source', 'p39-topology-2', 'AVAILABLE', 'TESTED',
   false, false, '["p39-internal-tag"]'::jsonb, 'direct-domain',
   'reference-graph.profile-runtime.p30.v1',
   (statement_timestamp() at time zone 'UTC')::date, statement_timestamp());
