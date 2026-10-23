-- P6 retrieval quality keeps historical P5 RPCs intact.
-- Hard eligibility remains current + reviewed + accessible + fresh.
-- Requested surface/platform are intentionally evaluated later as policy preferences.

create or replace function public.reference_graph_lexical_candidates_p6(
  p_query text,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 48
)
returns table(asset_id uuid, rank integer, score double precision)
language sql
stable
security definer
set search_path = pg_catalog, public, reference_graph
as $$
  with params as (
    select coalesce(nullif(p_filters->>'reference_date', '')::date, current_date) as reference_date
  ),
  query_tokens as (
    select distinct token
    from regexp_split_to_table(lower(coalesce(p_query, '')), '[^[:alnum:]_]+') token
    where length(token) >= 2
  ),
  scored as (
    select
      c.asset_id,
      count(distinct qt.token)::double precision as score
    from reference_graph.chunks c
    join reference_graph.current_assets a on a.id = c.asset_id
    join reference_graph.sources s on s.id = a.source_id
    cross join params p
    join query_tokens qt on c.search_vector @@ plainto_tsquery('simple', qt.token)
    where a.provenance->>'review_status' = 'reviewed'
      and coalesce(a.metadata->>'access_status', s.metadata->>'access_status') in ('AVAILABLE', 'PAYWALLED')
      and nullif(a.provenance->>'last_verified_at', '')::date
        + coalesce(nullif(a.metadata->>'ttl_days', '')::integer, 0) >= p.reference_date
    group by c.asset_id
  )
  select
    scored.asset_id,
    row_number() over (order by scored.score desc, scored.asset_id)::integer as rank,
    scored.score
  from scored
  where scored.score > 0
  order by scored.score desc, scored.asset_id
  limit greatest(1, least(coalesce(p_limit, 48), 100));
$$;

revoke all on function public.reference_graph_lexical_candidates_p6(text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.reference_graph_lexical_candidates_p6(text, jsonb, integer)
  to service_role;

create or replace function public.reference_graph_semantic_candidates_p6(
  p_embedding_text text,
  p_model_id text,
  p_model_revision text,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 48
)
returns table(asset_id uuid, rank integer, score double precision)
language sql
stable
security definer
set search_path = pg_catalog, public, reference_graph, extensions
as $$
  with params as (
    select coalesce(nullif(p_filters->>'reference_date', '')::date, current_date) as reference_date
  ),
  scored as (
    select
      c.asset_id,
      1 - (e.embedding <=> p_embedding_text::extensions.vector) as score,
      e.embedding <=> p_embedding_text::extensions.vector as distance
    from reference_graph.embeddings e
    join reference_graph.chunks c on c.id = e.chunk_id
    join reference_graph.current_assets a on a.id = c.asset_id
    join reference_graph.sources s on s.id = a.source_id
    cross join params p
    where e.model_id = p_model_id
      and e.model_revision = p_model_revision
      and a.provenance->>'review_status' = 'reviewed'
      and coalesce(a.metadata->>'access_status', s.metadata->>'access_status') in ('AVAILABLE', 'PAYWALLED')
      and nullif(a.provenance->>'last_verified_at', '')::date
        + coalesce(nullif(a.metadata->>'ttl_days', '')::integer, 0) >= p.reference_date
  )
  select
    scored.asset_id,
    row_number() over (order by scored.distance asc, scored.asset_id)::integer as rank,
    scored.score::double precision
  from scored
  order by scored.distance asc, scored.asset_id
  limit greatest(1, least(coalesce(p_limit, 48), 100));
$$;

revoke all on function public.reference_graph_semantic_candidates_p6(text, text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.reference_graph_semantic_candidates_p6(text, text, text, jsonb, integer)
  to service_role;

create or replace function public.reference_graph_candidate_context_p6(
  p_asset_ids uuid[],
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, reference_graph
as $$
  with params as (
    select coalesce(nullif(p_filters->>'reference_date', '')::date, current_date) as reference_date
  ),
  seed_ids as (
    select unnest(coalesce(p_asset_ids, array[]::uuid[])) as id
  ),
  one_hop as (
    select distinct
      case
        when r.from_asset_id in (select id from seed_ids) then r.to_asset_id
        else r.from_asset_id
      end as id
    from reference_graph.relations r
    where r.from_asset_id in (select id from seed_ids)
       or r.to_asset_id in (select id from seed_ids)
  ),
  candidate_ids as (
    select id from seed_ids
    union
    select id from one_hop
  ),
  eligible_assets as (
    select
      a.*,
      s.source_family,
      (
        select o.body
        from reference_graph.observations o
        where o.asset_id = a.id
          and o.observation_kind = 'topology'
        order by o.id
        limit 1
      ) as topology
    from reference_graph.current_assets a
    join reference_graph.sources s on s.id = a.source_id
    cross join params p
    where a.id in (select id from candidate_ids)
      and a.provenance->>'review_status' = 'reviewed'
      and coalesce(a.metadata->>'access_status', s.metadata->>'access_status') in ('AVAILABLE', 'PAYWALLED')
      and nullif(a.provenance->>'last_verified_at', '')::date
        + coalesce(nullif(a.metadata->>'ttl_days', '')::integer, 0) >= p.reference_date
  )
  select jsonb_build_object(
    'assets', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'source_id', a.source_id,
          'asset_kind', a.asset_kind,
          'canonical_locator', a.canonical_locator,
          'title', a.title,
          'media_type', a.media_type,
          'captured_at', a.captured_at,
          'content_hash', a.content_hash,
          'storage_policy', a.storage_policy,
          'provenance', a.provenance,
          'metadata', a.metadata,
          'surface_family', a.metadata->>'surface_family',
          'platform', a.metadata->>'platform',
          'source_family', a.source_family,
          'topology', a.topology,
          'tags', coalesce((
            select jsonb_agg(t.slug order by t.slug)
            from reference_graph.asset_tags at
            join reference_graph.tags t on t.id = at.tag_id
            where at.asset_id = a.id
          ), '[]'::jsonb)
        ) order by a.id
      )
      from eligible_assets a
    ), '[]'::jsonb),
    'relations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'from', r.from_asset_id,
          'to', r.to_asset_id,
          'type', r.relation_type,
          'weight', r.weight,
          'metadata', r.metadata
        ) order by r.id
      )
      from reference_graph.relations r
      where r.from_asset_id in (select id from eligible_assets)
        and r.to_asset_id in (select id from eligible_assets)
        and (
          r.from_asset_id in (select id from seed_ids)
          or r.to_asset_id in (select id from seed_ids)
        )
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.reference_graph_candidate_context_p6(uuid[], jsonb)
  from public, anon, authenticated;
grant execute on function public.reference_graph_candidate_context_p6(uuid[], jsonb)
  to service_role;
