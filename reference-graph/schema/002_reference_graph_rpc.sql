create or replace function public.reference_graph_ingest_capture(p_capture jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, reference_graph, extensions
as $$
declare
  v_source_id uuid;
  v_asset_id uuid;
  v_chunk jsonb;
  v_observation jsonb;
  v_tag text;
  v_tag_id bigint;
  v_relation jsonb;
begin
  if p_capture is null or jsonb_typeof(p_capture) <> 'object' then
    raise exception 'capture must be a JSON object';
  end if;

  v_source_id := (p_capture #>> '{source,id}')::uuid;
  v_asset_id := (p_capture #>> '{asset,id}')::uuid;

  insert into reference_graph.sources (
    id,
    canonical_url,
    source_kind,
    title,
    source_family,
    metadata,
    updated_at
  ) values (
    v_source_id,
    p_capture #>> '{source,canonical_url}',
    p_capture #>> '{source,source_kind}',
    nullif(p_capture #>> '{source,title}', ''),
    nullif(p_capture #>> '{source,source_family}', ''),
    coalesce(p_capture #> '{source,metadata}', '{}'::jsonb),
    now()
  )
  on conflict (id) do update set
    canonical_url = excluded.canonical_url,
    source_kind = excluded.source_kind,
    title = excluded.title,
    source_family = excluded.source_family,
    metadata = excluded.metadata,
    updated_at = now();

  insert into reference_graph.assets (
    id,
    source_id,
    asset_kind,
    canonical_locator,
    title,
    media_type,
    captured_at,
    content_hash,
    storage_policy,
    provenance,
    metadata
  ) values (
    v_asset_id,
    v_source_id,
    p_capture #>> '{asset,asset_kind}',
    p_capture #>> '{asset,canonical_locator}',
    nullif(p_capture #>> '{asset,title}', ''),
    nullif(p_capture #>> '{asset,media_type}', ''),
    (p_capture #>> '{asset,captured_at}')::timestamptz,
    nullif(p_capture #>> '{asset,content_hash}', ''),
    nullif(p_capture #>> '{asset,storage_policy}', ''),
    coalesce(p_capture #> '{asset,provenance}', '{}'::jsonb),
    coalesce(p_capture #> '{asset,metadata}', '{}'::jsonb)
  )
  on conflict (id) do update set
    source_id = excluded.source_id,
    asset_kind = excluded.asset_kind,
    canonical_locator = excluded.canonical_locator,
    title = excluded.title,
    media_type = excluded.media_type,
    captured_at = excluded.captured_at,
    content_hash = excluded.content_hash,
    storage_policy = excluded.storage_policy,
    provenance = excluded.provenance,
    metadata = excluded.metadata;

  for v_chunk in
    select value from jsonb_array_elements(coalesce(p_capture->'chunks', '[]'::jsonb))
  loop
    insert into reference_graph.chunks (
      id,
      asset_id,
      ordinal,
      content,
      metadata
    ) values (
      (v_chunk->>'id')::uuid,
      v_asset_id,
      (v_chunk->>'ordinal')::integer,
      v_chunk->>'content',
      coalesce(v_chunk->'metadata', '{}'::jsonb) ||
        jsonb_build_object('content_role', v_chunk->>'content_role')
    )
    on conflict (id) do update set
      asset_id = excluded.asset_id,
      ordinal = excluded.ordinal,
      content = excluded.content,
      metadata = excluded.metadata;
  end loop;

  for v_observation in
    select value from jsonb_array_elements(coalesce(p_capture->'observations', '[]'::jsonb))
  loop
    insert into reference_graph.observations (
      id,
      asset_id,
      observation_kind,
      body,
      evidence_class,
      observed_at,
      metadata
    ) values (
      (v_observation->>'id')::uuid,
      v_asset_id,
      v_observation->>'observation_kind',
      v_observation->>'body',
      v_observation->>'evidence_class',
      nullif(v_observation->>'observed_at', '')::timestamptz,
      coalesce(v_observation->'metadata', '{}'::jsonb)
    )
    on conflict (id) do update set
      asset_id = excluded.asset_id,
      observation_kind = excluded.observation_kind,
      body = excluded.body,
      evidence_class = excluded.evidence_class,
      observed_at = excluded.observed_at,
      metadata = excluded.metadata;
  end loop;

  for v_tag in
    select value #>> '{}' from jsonb_array_elements(coalesce(p_capture->'tags', '[]'::jsonb))
  loop
    insert into reference_graph.tags (slug, label)
    values (v_tag, v_tag)
    on conflict (slug) do update set label = excluded.label
    returning id into v_tag_id;

    insert into reference_graph.asset_tags (asset_id, tag_id)
    values (v_asset_id, v_tag_id)
    on conflict do nothing;
  end loop;

  for v_relation in
    select value from jsonb_array_elements(coalesce(p_capture->'relations', '[]'::jsonb))
  loop
    if (v_relation ? 'from_asset_id') and (v_relation ? 'to_asset_id') then
      insert into reference_graph.relations (
        id,
        from_asset_id,
        to_asset_id,
        relation_type,
        weight,
        metadata
      ) values (
        coalesce(
          nullif(v_relation->>'id', '')::uuid,
          gen_random_uuid()
        ),
        (v_relation->>'from_asset_id')::uuid,
        (v_relation->>'to_asset_id')::uuid,
        v_relation->>'relation_type',
        coalesce((v_relation->>'weight')::double precision, 1),
        coalesce(v_relation->'metadata', '{}'::jsonb)
      )
      on conflict (id) do update set
        relation_type = excluded.relation_type,
        weight = excluded.weight,
        metadata = excluded.metadata;
    end if;
  end loop;

  return jsonb_build_object(
    'source_id', v_source_id,
    'asset_id', v_asset_id,
    'chunk_count', jsonb_array_length(coalesce(p_capture->'chunks', '[]'::jsonb)),
    'tag_count', jsonb_array_length(coalesce(p_capture->'tags', '[]'::jsonb)),
    'observation_count', jsonb_array_length(coalesce(p_capture->'observations', '[]'::jsonb))
  );
end;
$$;

revoke all on function public.reference_graph_ingest_capture(jsonb) from public, anon, authenticated;
grant execute on function public.reference_graph_ingest_capture(jsonb) to service_role;

create or replace function public.reference_graph_ingest_captures(p_captures jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, reference_graph, extensions
as $$
declare
  v_capture jsonb;
  v_count integer := 0;
begin
  if p_captures is null or jsonb_typeof(p_captures) <> 'array' then
    raise exception 'captures must be a JSON array';
  end if;

  for v_capture in select value from jsonb_array_elements(p_captures)
  loop
    perform public.reference_graph_ingest_capture(v_capture);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('capture_count', v_count);
end;
$$;

revoke all on function public.reference_graph_ingest_captures(jsonb) from public, anon, authenticated;
grant execute on function public.reference_graph_ingest_captures(jsonb) to service_role;

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
  with query_input as (
    select websearch_to_tsquery('simple', coalesce(p_query, '')) as query
  ),
  scored as (
    select
      c.asset_id,
      max(ts_rank_cd(c.search_vector, q.query))::double precision as score
    from reference_graph.chunks c
    join reference_graph.assets a on a.id = c.asset_id
    cross join query_input q
    where coalesce(trim(p_query), '') <> ''
      and c.search_vector @@ q.query
      and (
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
  order by scored.score desc, scored.asset_id
  limit greatest(1, least(coalesce(p_limit, 48), 100));
$$;

revoke all on function public.reference_graph_lexical_candidates(text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.reference_graph_lexical_candidates(text, jsonb, integer) to service_role;

create or replace function public.reference_graph_semantic_candidates(
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
  with scored as (
    select
      c.asset_id,
      1 - (e.embedding <=> p_embedding_text::extensions.vector) as score,
      e.embedding <=> p_embedding_text::extensions.vector as distance
    from reference_graph.embeddings e
    join reference_graph.chunks c on c.id = e.chunk_id
    join reference_graph.assets a on a.id = c.asset_id
    where e.model_id = p_model_id
      and e.model_revision = p_model_revision
      and (
        coalesce(p_filters->>'platform', '') = ''
        or a.metadata->>'platform' = p_filters->>'platform'
      )
      and (
        coalesce(p_filters->>'surface_family', p_filters->>'surfaceFamily', '') = ''
        or a.metadata->>'surface_family' = coalesce(p_filters->>'surface_family', p_filters->>'surfaceFamily')
      )
  )
  select
    scored.asset_id,
    row_number() over (order by scored.distance asc, scored.asset_id)::integer as rank,
    scored.score::double precision
  from scored
  order by scored.distance asc, scored.asset_id
  limit greatest(1, least(coalesce(p_limit, 48), 100));
$$;

revoke all on function public.reference_graph_semantic_candidates(text, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.reference_graph_semantic_candidates(text, text, text, jsonb, integer) to service_role;

create or replace function public.reference_graph_candidate_context(
  p_asset_ids uuid[],
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, reference_graph
as $$
  with seed_ids as (
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
    select a.*
    from reference_graph.assets a
    where a.id in (select id from candidate_ids)
      and (
        coalesce(p_filters->>'platform', '') = ''
        or a.metadata->>'platform' = p_filters->>'platform'
      )
      and (
        coalesce(p_filters->>'surface_family', p_filters->>'surfaceFamily', '') = ''
        or a.metadata->>'surface_family' = coalesce(p_filters->>'surface_family', p_filters->>'surfaceFamily')
      )
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

revoke all on function public.reference_graph_candidate_context(uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.reference_graph_candidate_context(uuid[], jsonb) to service_role;

create or replace function public.reference_graph_stats()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, reference_graph
as $$
  select jsonb_build_object(
    'sources', (select count(*) from reference_graph.sources),
    'assets', (select count(*) from reference_graph.assets),
    'chunks', (select count(*) from reference_graph.chunks),
    'observations', (select count(*) from reference_graph.observations),
    'tags', (select count(*) from reference_graph.tags),
    'relations', (select count(*) from reference_graph.relations),
    'embeddings', (select count(*) from reference_graph.embeddings)
  );
$$;

revoke all on function public.reference_graph_stats() from public, anon, authenticated;
grant execute on function public.reference_graph_stats() to service_role;
