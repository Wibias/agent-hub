-- Reference Graph P16: durable one-shot activation grant consumption.
--
-- The private ledger is the serialization point for P15 grant replay protection.
-- It stores only the nonce and canonical public hashes required to bind the
-- consumption event. Raw grants, signatures, keys, credentials, and caller
-- authorization claims are intentionally not persisted.

create table if not exists reference_graph.activation_grant_consumptions_p16 (
  nonce text primary key
    check (nonce ~ '^[0-9a-f]{64}$'),
  consumption_id uuid not null unique default gen_random_uuid(),
  grant_payload_hash text not null
    check (grant_payload_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null
    check (request_hash ~ '^[0-9a-f]{64}$'),
  authority_hash text not null
    check (authority_hash ~ '^[0-9a-f]{64}$'),
  consumed_at timestamptz not null default clock_timestamp()
);

revoke all on table reference_graph.activation_grant_consumptions_p16
  from public, anon, authenticated, service_role;

create or replace function public.reference_graph_consume_activation_grant_nonce_p16(
  p_nonce text,
  p_grant_payload_hash text,
  p_request_hash text,
  p_authority_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, reference_graph
set statement_timeout = '5s'
as $$
declare
  v_consumption_id uuid;
begin
  if p_nonce is null or p_nonce !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid P16 activation grant nonce' using errcode = '22023';
  end if;
  if p_grant_payload_hash is null or p_grant_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid P16 grant payload hash' using errcode = '22023';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid P16 request hash' using errcode = '22023';
  end if;
  if p_authority_hash is null or p_authority_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid P16 authority hash' using errcode = '22023';
  end if;

  insert into reference_graph.activation_grant_consumptions_p16 (
    nonce,
    grant_payload_hash,
    request_hash,
    authority_hash
  )
  values (
    p_nonce,
    p_grant_payload_hash,
    p_request_hash,
    p_authority_hash
  )
  on conflict (nonce) do nothing
  returning consumption_id into v_consumption_id;

  if v_consumption_id is null then
    return jsonb_build_object(
      'consumed', false,
      'consumption_id', null
    );
  end if;

  return jsonb_build_object(
    'consumed', true,
    'consumption_id', v_consumption_id::text
  );
end;
$$;

revoke all on function public.reference_graph_consume_activation_grant_nonce_p16(text, text, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.reference_graph_consume_activation_grant_nonce_p16(text, text, text, text)
  to service_role;
