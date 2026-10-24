-- P7 lexical parity exposes the complete current eligible pool so the
-- graph-native quick selector can reproduce the established legacy policy.
-- Query relevance, surface/platform preference, diversity, and coverage are
-- intentionally evaluated outside SQL by the pure P7 parity policy.

create or replace function public.reference_graph_quick_candidate_pool_p7(
  p_filters jsonb default '{}'::jsonb
)
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
as $$
  with params as (
    select coalesce(
      nullif(p_filters->>'reference_date', '')::date,
      current_date
    ) as reference_date
  ),
  eligible_assets as (
    select
      a.*,
      coalesce(nullif(a.metadata->>'source_family', ''), s.source_family) as resolved_source_family,
      coalesce(a.metadata->>'access_status', s.metadata->>'access_status') as resolved_access_status
    from reference_graph.current_assets a
    join reference_graph.sources s on s.id = a.source_id
    cross join params p
    where nullif(trim(a.metadata->>'legacy_id'), '') is not null
      and a.provenance->>'review_status' = 'reviewed'
      and coalesce(a.metadata->>'access_status', s.metadata->>'access_status') in ('AVAILABLE', 'PAYWALLED')
      and nullif(a.provenance->>'last_verified_at', '')::date
        + coalesce(nullif(a.metadata->>'ttl_days', '')::integer, 0) >= p.reference_date
  )
  select
    a.id as asset_id,
    a.metadata->>'legacy_id' as legacy_id,
    a.metadata->>'product' as product,
    a.metadata->>'surface_family' as surface_family,
    a.metadata->>'platform' as platform,
    a.metadata->>'page_role' as page_role,
    a.metadata->>'motion' as motion,
    a.resolved_source_family as source_family,
    (
      select o.body
      from reference_graph.observations o
      where o.asset_id = a.id
        and o.observation_kind = 'topology'
      order by o.id
      limit 1
    ) as topology,
    a.resolved_access_status as access_status,
    a.metadata->>'evidence_class' as evidence_class,
    (a.metadata->>'ordinary_or_failure_prone')::boolean as ordinary_or_failure_prone,
    (a.metadata->>'multi_state_flow')::boolean as multi_state_flow,
    coalesce((
      select jsonb_agg(t.slug order by t.slug)
      from reference_graph.asset_tags at
      join reference_graph.tags t on t.id = at.tag_id
      where at.asset_id = a.id
    ), '[]'::jsonb) as tags,
    coalesce((
      select string_agg(c.content, E'\n' order by c.ordinal)
      from reference_graph.chunks c
      where c.asset_id = a.id
    ), '') as search_text
  from eligible_assets a
  order by a.id;
$$;

revoke all on function public.reference_graph_quick_candidate_pool_p7(jsonb)
  from public, anon, authenticated;
grant execute on function public.reference_graph_quick_candidate_pool_p7(jsonb)
  to service_role;
