-- P31 PROPOSED MIGRATION. CI-only until separately reviewed and authorized.
-- Additive Standard/Deep candidate projection. Never alters P10 Quick routing.
-- A privileged operator must separately authorize any real deployment.

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
    primary_stratum in (
      'direct-domain', 'evidence-craft', 'adjacent-domain', 'outside-domain'
    )
  ),
  projection_version text not null check (
    projection_version = 'reference-graph.profile-runtime.p30.v1'
  ),
  snapshot_date date not null,
  refreshed_at timestamptz not null
);

alter table public.reference_graph_profile_runtime_projection_p30_v1
  enable row level security;

revoke all on table public.reference_graph_profile_runtime_projection_p30_v1
  from public, anon, authenticated, service_role;
grant select on table public.reference_graph_profile_runtime_projection_p30_v1
  to anon, authenticated;

create policy reference_graph_profile_runtime_p31_utc_snapshot
  on public.reference_graph_profile_runtime_projection_p30_v1
  for select
  to anon, authenticated
  using (snapshot_date = (statement_timestamp() at time zone 'UTC')::date);

-- Service-role-only, all-or-nothing refresh. PostgreSQL reverts the DELETE and
-- INSERT automatically if any check raises; there is no failure commit path.
-- P7 retains sole eligibility authority. P31 joins current_assets strictly by
-- asset_id ONLY to fetch previously captured primary_stratum.
create or replace function public.reference_graph_refresh_profile_runtime_projection_p31()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, reference_graph
set statement_timeout = '5s'
as $$
declare
  v_refreshed_at timestamptz := clock_timestamp();
  v_date date;
  v_source_count bigint;
  v_invalid_count bigint;
  v_metadata_invalid_count bigint;
  v_published_count bigint;
  v_source_hash text;
  v_published_hash text;
begin
  v_date := (v_refreshed_at at time zone 'UTC')::date;

  -- Independent expected membership computed from the pre-publication P7
  -- source; never trust a candidate count/hash copied from a read response.
  select count(*),
         encode(sha256(convert_to(coalesce(
           string_agg(p.legacy_id, E'\n' order by p.legacy_id collate "C"), ''
         ), 'UTF8')), 'hex')
    into v_source_count, v_source_hash
    from public.reference_graph_quick_candidate_pool_p7(
      jsonb_build_object('reference_date', v_date::text)
    ) p;

  if v_source_count = 0 then
    raise exception 'P31 source candidate pool is empty';
  end if;

  select count(*)
    into v_invalid_count
    from public.reference_graph_quick_candidate_pool_p7(
      jsonb_build_object('reference_date', v_date::text)
    ) p
    left join reference_graph.current_assets a on a.id = p.asset_id
   where a.id is null
      or a.metadata->>'primary_stratum' is null
      or a.metadata->>'primary_stratum' not in (
        'direct-domain', 'evidence-craft', 'adjacent-domain', 'outside-domain'
      );

  if v_invalid_count <> 0 then
    raise exception 'P31 source has missing or invalid primary stratum';
  end if;

  -- The P7 eligibility source may contain candidate metadata that is legal
  -- for Quick but violates P28's stricter Standard/Deep DTO contract. Never
  -- publish a snapshot that P30 necessarily rejects.
  select count(*) into v_metadata_invalid_count
  from public.reference_graph_quick_candidate_pool_p7(
    jsonb_build_object('reference_date', v_date::text)
  ) p
  where p.surface_family is null
    or p.surface_family not in (
      'public-home', 'authenticated-home', 'operator-control',
      'library-launcher', 'creation-setup', 'realtime-multiplayer',
      'admin-settings', 'auth-onboarding', 'commerce-checkout',
      'mobile-responsive', 'editorial-experimental',
      'design-system-craft'
    )
    or p.platform is null
    or p.platform not in ('web-responsive', 'native-mobile')
    or p.evidence_class is null
    or p.evidence_class not in (
      'TESTED', 'OBSERVED', 'INTERPRETED', 'INSPIRATION', 'MARKETING_CLAIM'
    )
    or p.access_status is null
    or p.access_status not in ('AVAILABLE', 'PAYWALLED')
    or p.search_text is null
    or jsonb_typeof(p.tags) is distinct from 'array'
    or exists (
      select 1
      from jsonb_array_elements(coalesce(p.tags, '[]'::jsonb)) as tag(value)
      where jsonb_typeof(tag.value) <> 'string'
         or btrim(tag.value #>> '{}') = ''
    );

  if v_metadata_invalid_count <> 0 then
    raise exception 'P31 source has invalid P28 candidate metadata';
  end if;

  delete from public.reference_graph_profile_runtime_projection_p30_v1
  where true;

  insert into public.reference_graph_profile_runtime_projection_p30_v1 (
    asset_id, legacy_id, search_text, product, surface_family, platform,
    page_role, motion, source_family, topology, access_status, evidence_class,
    ordinary_or_failure_prone, multi_state_flow, tags, primary_stratum,
    projection_version, snapshot_date, refreshed_at
  )
  select
    p.asset_id, p.legacy_id, p.search_text, p.product, p.surface_family,
    p.platform, p.page_role, p.motion, p.source_family, p.topology,
    p.access_status, p.evidence_class,
    coalesce(p.ordinary_or_failure_prone, false),
    coalesce(p.multi_state_flow, false), p.tags,
    a.metadata->>'primary_stratum',
    'reference-graph.profile-runtime.p30.v1', v_date, v_refreshed_at
  from public.reference_graph_quick_candidate_pool_p7(
    jsonb_build_object('reference_date', v_date::text)
  ) p
  join reference_graph.current_assets a on a.id = p.asset_id;

  select count(*),
         encode(sha256(convert_to(coalesce(
           string_agg(legacy_id, E'\n' order by legacy_id collate "C"), ''
         ), 'UTF8')), 'hex')
    into v_published_count, v_published_hash
    from public.reference_graph_profile_runtime_projection_p30_v1;

  if v_published_count <> v_source_count
      or v_published_hash <> v_source_hash then
    raise exception 'P31 published candidate membership differs from P7 source';
  end if;

  -- Operator-only aggregate receipt. A trusted operator must transfer and
  -- pin this separately before a P30 runtime read; no client can call this
  -- refresh or retrieve its source-side receipt with publishable privileges.
  return jsonb_build_object(
    'schema_version', 'reference-graph.p31-source-snapshot-receipt.v1',
    'projection_version', 'reference-graph.profile-runtime.p30.v1',
    'snapshot_date', v_date::text,
    'refreshed_at', to_char(v_refreshed_at at time zone 'UTC',
                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expected_candidate_count', v_source_count,
    'expected_candidate_id_set_sha256', v_source_hash,
    'published_candidate_count', v_published_count,
    'published_candidate_id_set_sha256', v_published_hash,
    'live_graph_parity_verified', false,
    'pattern_parity_verified', false,
    'repository_default_graph_enabled', false,
    'activation_performed', false
  );
end;
$$;

revoke all on function public.reference_graph_refresh_profile_runtime_projection_p31()
  from public, anon, authenticated, service_role;
grant execute on function public.reference_graph_refresh_profile_runtime_projection_p31()
  to service_role;
