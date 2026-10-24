create table reference_graph.source_verifications (
  decision_hash text primary key,
  legacy_id text not null,
  verdict text not null check (verdict in ('confirm', 'stale', 'archive')),
  verified_at date not null,
  verifier text not null,
  access_status text not null check (access_status in ('AVAILABLE', 'PAYWALLED', 'BLOCKED', 'UNAVAILABLE')),
  notes text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index reference_graph_source_verifications_legacy_idx
  on reference_graph.source_verifications (legacy_id, verified_at desc);

alter table reference_graph.source_verifications enable row level security;
revoke all on reference_graph.source_verifications from public, anon, authenticated;

create or replace view reference_graph.current_assets as
with ranked as (
  select
    a.*,
    nullif(trim(a.metadata->>'legacy_id'), '') as legacy_id,
    row_number() over (partition by nullif(trim(a.metadata->>'legacy_id'), '') order by a.captured_at desc, a.id desc) as current_rank
  from reference_graph.assets a
)
select *
from ranked
where legacy_id is null or current_rank = 1;

revoke all on reference_graph.current_assets from public, anon, authenticated;

create or replace function public.reference_graph_record_verifications(p_verifications jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, reference_graph
as $$
declare
  v_row jsonb;
  v_inserted integer := 0;
  v_seen integer := 0;
  v_affected integer := 0;
begin
  if p_verifications is null or jsonb_typeof(p_verifications) <> 'array' then
    raise exception 'verifications must be a JSON array';
  end if;

  for v_row in select value from jsonb_array_elements(p_verifications)
  loop
    if coalesce(trim(v_row->>'decision_hash'), '') = ''
      or coalesce(trim(v_row->>'legacy_id'), '') = ''
      or coalesce(trim(v_row->>'verdict'), '') = ''
      or coalesce(trim(v_row->>'verified_at'), '') = ''
      or coalesce(trim(v_row->>'verifier'), '') = ''
      or coalesce(trim(v_row->>'access_status'), '') = ''
      or coalesce(trim(v_row->>'notes'), '') = '' then
      raise exception 'verification rows require decision_hash, legacy_id, verdict, verified_at, verifier, access_status, and notes';
    end if;

    insert into reference_graph.source_verifications (
      decision_hash,
      legacy_id,
      verdict,
      verified_at,
      verifier,
      access_status,
      notes,
      metadata
    ) values (
      v_row->>'decision_hash',
      v_row->>'legacy_id',
      v_row->>'verdict',
      (v_row->>'verified_at')::date,
      v_row->>'verifier',
      v_row->>'access_status',
      v_row->>'notes',
      coalesce(v_row->'metadata', '{}'::jsonb)
    )
    on conflict (decision_hash) do nothing;

    get diagnostics v_affected = row_count;
    v_inserted := v_inserted + v_affected;
    v_seen := v_seen + 1;
  end loop;

  return jsonb_build_object(
    'verification_count', v_seen,
    'inserted_count', v_inserted,
    'duplicate_count', v_seen - v_inserted
  );
end;
$$;

revoke all on function public.reference_graph_record_verifications(jsonb)
  from public, anon, authenticated;
grant execute on function public.reference_graph_record_verifications(jsonb)
  to service_role;

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
  with params as (
    select coalesce(nullif(p_filters->>'reference_date', '')::date, current_date) as reference_date
  ),
  query_tokens as (
    select distinct token
    from regexp_split_to_table(lower(coalesce(p_query, '')), '[^a-z0-9]+') as token
    where length(token) > 1
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
  where scored.score > 0
  order by scored.score desc, scored.asset_id
  limit greatest(1, least(coalesce(p_limit, 48), 100));
$$;

revoke all on function public.reference_graph_lexical_candidates(text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.reference_graph_lexical_candidates(text, jsonb, integer)
  to service_role;

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

revoke all on function public.reference_graph_semantic_candidates(text, text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.reference_graph_semantic_candidates(text, text, text, jsonb, integer)
  to service_role;

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
    select a.*
    from reference_graph.current_assets a
    join reference_graph.sources s on s.id = a.source_id
    cross join params p
    where a.id in (select id from candidate_ids)
      and a.provenance->>'review_status' = 'reviewed'
      and coalesce(a.metadata->>'access_status', s.metadata->>'access_status') in ('AVAILABLE', 'PAYWALLED')
      and nullif(a.provenance->>'last_verified_at', '')::date
        + coalesce(nullif(a.metadata->>'ttl_days', '')::integer, 0) >= p.reference_date
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

revoke all on function public.reference_graph_candidate_context(uuid[], jsonb)
  from public, anon, authenticated;
grant execute on function public.reference_graph_candidate_context(uuid[], jsonb)
  to service_role;

create or replace function public.reference_graph_embedding_coverage(
  p_model_id text,
  p_model_revision text,
  p_reference_date date
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, reference_graph
as $$
  with eligible_chunks as (
    select
      c.id as chunk_id,
      c.metadata->>'text_hash' as expected_text_hash
    from reference_graph.chunks c
    join reference_graph.current_assets a on a.id = c.asset_id
    join reference_graph.sources s on s.id = a.source_id
    where a.provenance->>'review_status' = 'reviewed'
      and coalesce(a.metadata->>'access_status', s.metadata->>'access_status') in ('AVAILABLE', 'PAYWALLED')
      and nullif(a.provenance->>'last_verified_at', '')::date
        + coalesce(nullif(a.metadata->>'ttl_days', '')::integer, 0) >= coalesce(p_reference_date, current_date)
  ),
  coverage as (
    select
      ec.chunk_id,
      ec.expected_text_hash,
      e.chunk_id is not null as has_embedding,
      e.text_hash as persisted_text_hash
    from eligible_chunks ec
    left join reference_graph.embeddings e
      on e.chunk_id = ec.chunk_id
      and e.model_id = p_model_id
      and e.model_revision = p_model_revision
  ),
  totals as (
    select
      count(*)::integer as eligible_chunk_count,
      count(*) filter (
        where has_embedding
          and expected_text_hash is not null
          and persisted_text_hash = expected_text_hash
      )::integer as compatible_count,
      count(*) filter (where not has_embedding)::integer as missing_count,
      count(*) filter (
        where has_embedding
          and (expected_text_hash is null or persisted_text_hash is distinct from expected_text_hash)
      )::integer as text_hash_mismatch_count
    from coverage
  )
  select jsonb_build_object(
    'eligible_chunk_count', eligible_chunk_count,
    'compatible_count', compatible_count,
    'missing_count', missing_count,
    'text_hash_mismatch_count', text_hash_mismatch_count,
    'coverage_rate', case
      when eligible_chunk_count = 0 then 0::double precision
      else compatible_count::double precision / eligible_chunk_count::double precision
    end
  )
  from totals;
$$;

revoke all on function public.reference_graph_embedding_coverage(text, text, date)
  from public, anon, authenticated;
grant execute on function public.reference_graph_embedding_coverage(text, text, date)
  to service_role;
