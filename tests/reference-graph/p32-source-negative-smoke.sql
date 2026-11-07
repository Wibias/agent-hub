-- P32: disposable source-validation negative matrix. NEVER run on production.
\set ON_ERROR_STOP on

create temporary table p32_before as
select count(*) as n,
       encode(sha256(convert_to(coalesce(
         string_agg(legacy_id, E'\n' order by legacy_id collate "C"), ''
       ), 'UTF8')), 'hex') as fingerprint
from public.reference_graph_profile_runtime_projection_p30_v1;

-- Invalid surface ('auth' is a P7 test convention but not a P28 taxonomy value).
begin;
update reference_graph.assets
set metadata = jsonb_set(metadata, '{surface_family}', '"auth"'::jsonb, true)
where metadata->>'legacy_id' = 'ref-p7-a';
do $$
declare blocked boolean := false;
begin
  begin
    perform public.reference_graph_refresh_profile_runtime_projection_p31();
  exception when raise_exception then blocked := true;
  end;
  if not blocked then
    raise exception 'P32 invalid surface was published';
  end if;
end $$;
rollback;

-- Invalid platform.
begin;
update reference_graph.assets
set metadata = jsonb_set(metadata, '{platform}', '"unsupported-platform"'::jsonb, true)
where metadata->>'legacy_id' = 'ref-p7-a';
do $$
declare blocked boolean := false;
begin
  begin
    perform public.reference_graph_refresh_profile_runtime_projection_p31();
  exception when raise_exception then blocked := true;
  end;
  if not blocked then
    raise exception 'P32 invalid platform was published';
  end if;
end $$;
rollback;

-- Invalid evidence class.
begin;
update reference_graph.assets
set metadata = jsonb_set(metadata, '{evidence_class}', '"UNVERIFIED"'::jsonb, true)
where metadata->>'legacy_id' = 'ref-p7-a';
do $$
declare blocked boolean := false;
begin
  begin
    perform public.reference_graph_refresh_profile_runtime_projection_p31();
  exception when raise_exception then blocked := true;
  end;
  if not blocked then
    raise exception 'P32 invalid evidence class was published';
  end if;
end $$;
rollback;

-- Invalid primary_stratum is also rejected before publication.
begin;
update reference_graph.assets
set metadata = jsonb_set(metadata, '{primary_stratum}', '"broken-stratum"'::jsonb, true)
where metadata->>'legacy_id' = 'ref-p7-a';
do $
declare blocked boolean := false;
begin
  begin
    perform public.reference_graph_refresh_profile_runtime_projection_p31();
  exception when raise_exception then blocked := true;
  end;
  if not blocked then
    raise exception 'P32 invalid primary stratum was published';
  end if;
end $;
rollback;

-- No rejected source may replace the healthy projection.
select 1 / case when
  (select count(*) from public.reference_graph_profile_runtime_projection_p30_v1)
    = (select n from p32_before)
  and (select encode(sha256(convert_to(coalesce(
    string_agg(legacy_id, E'\n' order by legacy_id collate "C"), ''
  ), 'UTF8')), 'hex') from public.reference_graph_profile_runtime_projection_p30_v1)
    = (select fingerprint from p32_before)
then 1 else 0 end as p32_failed_refreshes_preserve_snapshot;
