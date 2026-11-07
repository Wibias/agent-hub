-- Disposable PostgreSQL smoke only. Never point this test at production.
-- Invoked after 001-009 and P4/P6/P7/P9/P10 fixture tests.
\set ON_ERROR_STOP on

select 1 / case when exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'reference_graph_profile_runtime_projection_p30_v1'
    and c.relrowsecurity
) then 1 else 0 end as p31_rls_enabled;

select 1 / case when exists (
  select 1 from pg_policies where schemaname = 'public'
    and tablename = 'reference_graph_profile_runtime_projection_p30_v1'
    and policyname = 'reference_graph_profile_runtime_p31_utc_snapshot'
    and cmd = 'SELECT' and qual like '%statement_timestamp()%'
    and qual like '%UTC%'
) then 1 else 0 end as p31_utc_policy;

select 1 / case when has_table_privilege(
  'anon', 'public.reference_graph_profile_runtime_projection_p30_v1', 'SELECT'
) and has_table_privilege(
  'authenticated', 'public.reference_graph_profile_runtime_projection_p30_v1', 'SELECT'
) then 1 else 0 end as p31_public_select_only;

select 1 / case when
  not has_table_privilege('anon', 'public.reference_graph_profile_runtime_projection_p30_v1', 'INSERT')
  and not has_table_privilege('anon', 'public.reference_graph_profile_runtime_projection_p30_v1', 'UPDATE')
  and not has_table_privilege('anon', 'public.reference_graph_profile_runtime_projection_p30_v1', 'DELETE')
  and not has_table_privilege('authenticated', 'public.reference_graph_profile_runtime_projection_p30_v1', 'INSERT')
  and not has_table_privilege('authenticated', 'public.reference_graph_profile_runtime_projection_p30_v1', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.reference_graph_profile_runtime_projection_p30_v1', 'DELETE')
then 1 else 0 end as p31_mutations_denied;

select 1 / case when
  not has_function_privilege('anon', 'public.reference_graph_refresh_profile_runtime_projection_p31()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.reference_graph_refresh_profile_runtime_projection_p31()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.reference_graph_refresh_profile_runtime_projection_p31()', 'EXECUTE')
then 1 else 0 end as p31_refresh_service_only;

-- Record the already populated P10 Quick projection fingerprint before P31.
create temporary table p31_p10_before as
select count(*) as candidate_count,
       encode(sha256(convert_to(coalesce(
         string_agg(legacy_id, E'\n' order by legacy_id collate "C"), ''
       ), 'UTF8')), 'hex') as id_set_sha256
from public.reference_graph_quick_runtime_projection_p10;

select 1 / case when (select candidate_count from p31_p10_before) >= 2
  then 1 else 0 end as p10_fixture_present;

-- The source fixture is deliberately missing primary_stratum. Refresh MUST
-- refuse, without publishing a partial snapshot.
do $$
declare blocked boolean := false;
begin
  begin
    perform public.reference_graph_refresh_profile_runtime_projection_p31();
  exception when raise_exception or check_violation or not_null_violation then
    blocked := true;
  end;
  if not blocked then
    raise exception 'P31 missing source stratum unexpectedly refreshed';
  end if;
end;
$$;

select 1 / case when count(*) = 0 then 1 else 0 end as p31_failed_refresh_no_publish
from public.reference_graph_profile_runtime_projection_p30_v1;

-- CI-only fixture repair: source metadata is not modified in production.
-- Use exact P7 IDs; P31 must not manufacture stratum values from text.
update reference_graph.assets a
set metadata = jsonb_set(a.metadata, '{primary_stratum}', '"direct-domain"'::jsonb, true)
where a.id in (
  select p.asset_id from public.reference_graph_quick_candidate_pool_p7(
    jsonb_build_object('reference_date',
      (statement_timestamp() at time zone 'UTC')::date::text)
  ) p
);

update reference_graph.assets
set metadata = jsonb_set(metadata, '{primary_stratum}', '"evidence-craft"'::jsonb, true)
where metadata->>'legacy_id' = 'ref-p7-b';

set role service_role;
select 1 / case when
  (public.reference_graph_refresh_profile_runtime_projection_p31()->>'expected_candidate_count')::bigint >= 2
then 1 else 0 end as p31_service_refresh_success;
reset role;

create temporary table p31_service_receipt as
select public.reference_graph_refresh_profile_runtime_projection_p31() as receipt;

-- The refresh receipt is source-derived from P7 before public publication;
-- compare it independently against P7 and against the published snapshot.
select 1 / case when
  (receipt->>'expected_candidate_count')::bigint = (
    select count(*) from public.reference_graph_quick_candidate_pool_p7(
      jsonb_build_object('reference_date',
        (statement_timestamp() at time zone 'UTC')::date::text)
    )
  )
  and receipt->>'expected_candidate_id_set_sha256' = (
    select encode(sha256(convert_to(coalesce(
      string_agg(p.legacy_id, E'\n' order by p.legacy_id collate "C"), ''
    ), 'UTF8')), 'hex')
    from public.reference_graph_quick_candidate_pool_p7(
      jsonb_build_object('reference_date',
        (statement_timestamp() at time zone 'UTC')::date::text)
    ) p
  )
  and receipt->>'expected_candidate_id_set_sha256' =
      receipt->>'published_candidate_id_set_sha256'
  and receipt->>'expected_candidate_count' =
      receipt->>'published_candidate_count'
  and receipt->>'live_graph_parity_verified' = 'false'
  and receipt->>'activation_performed' = 'false'
then 1 else 0 end as p31_source_receipt_bound
from p31_service_receipt;

select 1 / case when count(*) >= 2 and count(*) = count(primary_stratum)
  and every(primary_stratum in ('direct-domain','evidence-craft','adjacent-domain','outside-domain'))
  and count(distinct refreshed_at) = 1
  and count(distinct snapshot_date) = 1
  and count(distinct projection_version) = 1
then 1 else 0 end as p31_projection_consistent
from public.reference_graph_profile_runtime_projection_p30_v1;

set role anon;
set time zone 'Pacific/Honolulu';
select 1 / case when count(*) >= 2
  then 1 else 0 end as p31_anon_utc_snapshot_visible
from public.reference_graph_profile_runtime_projection_p30_v1;
reset time zone;
reset role;

set role authenticated;
select 1 / case when count(*) >= 2
  then 1 else 0 end as p31_authenticated_current_snapshot_visible
from public.reference_graph_profile_runtime_projection_p30_v1;
reset role;

-- RLS negative: stale rows remain physically present but invisible to anon.
update public.reference_graph_profile_runtime_projection_p30_v1
set snapshot_date = (statement_timestamp() at time zone 'UTC')::date - 1
where legacy_id = 'ref-p7-a';

set role anon;
select 1 / case when count(*) = 0 then 1 else 0 end as p31_anon_stale_snapshot_hidden
from public.reference_graph_profile_runtime_projection_p30_v1
where legacy_id = 'ref-p7-a';
reset role;

-- Replace the test-only stale modification before checking rollback.
select public.reference_graph_refresh_profile_runtime_projection_p31();

create temporary table p31_before_failed_refresh as
select count(*) as candidate_count,
       encode(sha256(convert_to(coalesce(
         string_agg(legacy_id, E'\n' order by legacy_id collate "C"), ''
       ), 'UTF8')), 'hex') as id_set_sha256
from public.reference_graph_profile_runtime_projection_p30_v1;

-- Source-invalid scenario: source metadata changes, refresh rejects it.
update reference_graph.assets
set metadata = jsonb_set(metadata, '{primary_stratum}', '"not-a-stratum"'::jsonb, true)
where metadata->>'legacy_id' = 'ref-p7-b';

do $$
declare blocked boolean := false;
begin
  begin
    perform public.reference_graph_refresh_profile_runtime_projection_p31();
  exception when raise_exception or check_violation then
    blocked := true;
  end;
  if not blocked then
    raise exception 'P31 invalid source stratum unexpectedly refreshed';
  end if;
end;
$$;

select 1 / case when
  (select count(*) from public.reference_graph_profile_runtime_projection_p30_v1) =
    (select candidate_count from p31_before_failed_refresh)
  and (select encode(sha256(convert_to(coalesce(
         string_agg(legacy_id, E'\n' order by legacy_id collate "C"), ''
       ), 'UTF8')), 'hex') from public.reference_graph_profile_runtime_projection_p30_v1) =
    (select id_set_sha256 from p31_before_failed_refresh)
then 1 else 0 end as p31_failed_source_refresh_preserves_snapshot;

-- Test rollback even on a *late* exception after DELETE, during INSERT.
update reference_graph.assets
set metadata = jsonb_set(metadata, '{primary_stratum}', '"evidence-craft"'::jsonb, true)
where metadata->>'legacy_id' = 'ref-p7-b';

create function public.p31_test_reject_insert()
returns trigger language plpgsql as $$
begin
  raise exception 'P31 test-only forced write failure';
end;
$$;
create trigger p31_test_abort
before insert on public.reference_graph_profile_runtime_projection_p30_v1
for each row execute function public.p31_test_reject_insert();

do $$
declare blocked boolean := false;
begin
  begin
    perform public.reference_graph_refresh_profile_runtime_projection_p31();
  exception when raise_exception then
    blocked := true;
  end;
  if not blocked then
    raise exception 'P31 forced mid-refresh error unexpectedly succeeded';
  end if;
end;
$$;

drop trigger p31_test_abort on public.reference_graph_profile_runtime_projection_p30_v1;
drop function public.p31_test_reject_insert();

select 1 / case when
  (select count(*) from public.reference_graph_profile_runtime_projection_p30_v1) =
    (select candidate_count from p31_before_failed_refresh)
  and (select encode(sha256(convert_to(coalesce(
         string_agg(legacy_id, E'\n' order by legacy_id collate "C"), ''
       ), 'UTF8')), 'hex') from public.reference_graph_profile_runtime_projection_p30_v1) =
    (select id_set_sha256 from p31_before_failed_refresh)
then 1 else 0 end as p31_atomic_rollback_preserved_snapshot;

-- P10 remains structurally and materially unchanged by P31.
select 1 / case when
  current_snapshot.candidate_count = before.candidate_count
  and current_snapshot.id_set_sha256 = before.id_set_sha256
then 1 else 0 end as p31_p10_quick_unchanged
from p31_p10_before before cross join (
  select count(*) as candidate_count,
         encode(sha256(convert_to(coalesce(
           string_agg(legacy_id, E'\n' order by legacy_id collate "C"), ''
         ), 'UTF8')), 'hex') as id_set_sha256
  from public.reference_graph_quick_runtime_projection_p10
) current_snapshot;

-- No persistent activation, schedules or collector changes.
