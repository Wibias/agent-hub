create or replace function public.reference_graph_upsert_embeddings(p_embeddings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, reference_graph, extensions
as $$
declare
  v_embedding jsonb;
  v_count integer := 0;
begin
  if p_embeddings is null or jsonb_typeof(p_embeddings) <> 'array' then
    raise exception 'embeddings must be a JSON array';
  end if;

  for v_embedding in
    select value from jsonb_array_elements(p_embeddings)
  loop
    insert into reference_graph.embeddings (
      chunk_id,
      model_id,
      model_revision,
      text_hash,
      dimensions,
      embedding,
      indexed_at
    ) values (
      (v_embedding->>'chunk_id')::uuid,
      v_embedding->>'model_id',
      v_embedding->>'model_revision',
      v_embedding->>'text_hash',
      384,
      (v_embedding->'embedding')::text::extensions.vector,
      now()
    )
    on conflict (chunk_id, model_id, model_revision) do update set
      text_hash = excluded.text_hash,
      dimensions = excluded.dimensions,
      embedding = excluded.embedding,
      indexed_at = now();

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('embedding_count', v_count);
end;
$$;

revoke all on function public.reference_graph_upsert_embeddings(jsonb)
  from public, anon, authenticated;
grant execute on function public.reference_graph_upsert_embeddings(jsonb)
  to service_role;
