create or replace function public.reference_graph_lexical_candidates(
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
  with query_tokens as (
    select distinct token
    from regexp_split_to_table(
      lower(coalesce(p_query, '')),
      '[^a-z0-9]+'
    ) as token
    where length(token) > 1
  ),
  scored as (
    select
      c.asset_id,
      count(distinct qt.token)::double precision as score
    from reference_graph.chunks c
    join reference_graph.assets a on a.id = c.asset_id
    join query_tokens qt
      on c.search_vector @@ plainto_tsquery('simple', qt.token)
    where (
        coalesce(p_filters->>'platform', '') = ''
        or a.metadata->>'platform' = p_filters->>'platform'
      )
      and (
        coalesce(p_filters->>'surface_family', p_filters->>'surfaceFamily', '') = ''
        or a.metadata->>'surface_family' = coalesce(p_filters->>'surface_family', p_filters->>'surfaceFamily')
      )
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

revoke all on function public.reference_graph_lexical_candidates(text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.reference_graph_lexical_candidates(text, jsonb, integer)
  to service_role;
