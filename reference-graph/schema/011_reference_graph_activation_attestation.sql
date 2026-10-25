-- Reference Graph P19: read-only aggregate attestation over the private P16 ledger.
--
-- This RPC exposes only aggregate counts bound to the three public activation
-- hashes. The private P16 ledger remains directly unreadable by runtime roles.

create or replace function public.reference_graph_attest_activation_consumption_p19(
  p_grant_payload_hash text,
  p_request_hash text,
  p_authority_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, reference_graph
set statement_timeout = '5s'
as $$
declare
  v_matching_count bigint;
  v_total_count bigint;
begin
  if p_grant_payload_hash is null or p_grant_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid P19 grant payload hash' using errcode = '22023';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid P19 request hash' using errcode = '22023';
  end if;
  if p_authority_hash is null or p_authority_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid P19 authority hash' using errcode = '22023';
  end if;

  select
    count(*) filter (
      where grant_payload_hash = p_grant_payload_hash
        and request_hash = p_request_hash
        and authority_hash = p_authority_hash
    ),
    count(*)
  into v_matching_count, v_total_count
  from reference_graph.activation_grant_consumptions_p16;

  return jsonb_build_object(
    'matching_count', v_matching_count,
    'total_count', v_total_count,
    'exact_match', v_matching_count = 1
  );
end;
$$;

revoke all on function public.reference_graph_attest_activation_consumption_p19(text, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.reference_graph_attest_activation_consumption_p19(text, text, text)
  to service_role;
