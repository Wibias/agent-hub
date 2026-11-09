-- P52. Exact independent-of-P31 projection source check, 2026-11-09.
-- REPRODUCER: one read-only SELECT statement. Do not call P31 refresh.
-- Target: agent-hub-reference-graph / vrznfnxzlxaavpqbzbzd.
-- SHA256 is a deterministic CURRENT-STATE hash of 16 P28 candidate fields;
-- not the P33-v2 JavaScript digest, not the 2026-11-08 original source receipt.
WITH src AS MATERIALIZED (
  SELECT p.asset_id,p.legacy_id,p.search_text,p.product,p.surface_family,
    p.platform,p.page_role,p.motion,p.source_family,p.topology,p.access_status,
    p.evidence_class,COALESCE(p.ordinary_or_failure_prone,false) AS ordinary_or_failure_prone,
    COALESCE(p.multi_state_flow,false) AS multi_state_flow,p.tags,
    a.metadata->>'primary_stratum' AS primary_stratum,
    a.id IS NULL AS missing_source_asset
  FROM public.reference_graph_quick_candidate_pool_p7(
    jsonb_build_object('reference_date',(statement_timestamp() AT TIME ZONE 'UTC')::date::text)
  ) p
  LEFT JOIN reference_graph.current_assets a ON a.id=p.asset_id
), dst AS MATERIALIZED (
  SELECT asset_id,legacy_id,search_text,product,surface_family,platform,page_role,motion,
    source_family,topology,access_status,evidence_class,ordinary_or_failure_prone,
    multi_state_flow,tags,primary_stratum,snapshot_date,refreshed_at,projection_version
  FROM public.reference_graph_profile_runtime_projection_p30_v1
), pair AS (
  SELECT s.asset_id AS source_asset, d.asset_id AS destination_asset,
    (s.legacy_id,s.search_text,s.product,s.surface_family,s.platform,s.page_role,s.motion,
      s.source_family,s.topology,s.access_status,s.evidence_class,s.ordinary_or_failure_prone,
      s.multi_state_flow,s.tags,s.primary_stratum)
    IS DISTINCT FROM
    (d.legacy_id,d.search_text,d.product,d.surface_family,d.platform,d.page_role,d.motion,
      d.source_family,d.topology,d.access_status,d.evidence_class,d.ordinary_or_failure_prone,
      d.multi_state_flow,d.tags,d.primary_stratum) AS fields_differ
  FROM src s FULL JOIN dst d USING(asset_id)
), content AS (
 SELECT 'P7_source' AS source,asset_id,
    jsonb_build_array(asset_id,legacy_id,search_text,product,surface_family,platform,page_role,
      motion,source_family,topology,access_status,evidence_class,ordinary_or_failure_prone,
      multi_state_flow,tags,primary_stratum)::text AS content
 FROM src
 UNION ALL
 SELECT 'P31_projection',asset_id,
    jsonb_build_array(asset_id,legacy_id,search_text,product,surface_family,platform,page_role,
      motion,source_family,topology,access_status,evidence_class,ordinary_or_failure_prone,
      multi_state_flow,tags,primary_stratum)::text
 FROM dst
), hash_by_source AS (
 SELECT source,COUNT(*) AS records,COUNT(DISTINCT asset_id) AS unique_assets,
   encode(sha256(convert_to(string_agg(content,E'\n' ORDER BY asset_id),'UTF8')),'hex')
      AS full_candidate_sha256
 FROM content GROUP BY source
), checks AS (
 SELECT count(*) FILTER(WHERE source_asset IS NULL) AS projection_only_assets,
 count(*) FILTER(WHERE destination_asset IS NULL) AS source_only_assets,
 count(*) FILTER(WHERE source_asset IS NOT NULL AND destination_asset IS NOT NULL AND fields_differ)
   AS different_15_metadata_fields
 FROM pair
)
SELECT h.source,h.records,h.unique_assets,h.full_candidate_sha256,
  c.projection_only_assets,c.source_only_assets,c.different_15_metadata_fields,
  (SELECT count(*) FROM src WHERE missing_source_asset) AS p7_assets_not_found,
  (SELECT count(*) FROM src WHERE primary_stratum IS NULL OR primary_stratum NOT IN
    ('direct-domain','evidence-craft','adjacent-domain','outside-domain')) AS bad_strata,
  (SELECT count(DISTINCT snapshot_date) FROM dst) AS snapshot_date_count,
  (SELECT min(snapshot_date)::text FROM dst) AS snapshot_date,
  (SELECT count(DISTINCT refreshed_at) FROM dst) AS refresh_timestamp_count,
  (SELECT min(refreshed_at)::text FROM dst) AS refreshed_at,
  (SELECT count(DISTINCT projection_version) FROM dst) AS projection_version_count,
  (SELECT statement_timestamp() AT TIME ZONE 'UTC') AS observed_at_utc
FROM hash_by_source h CROSS JOIN checks c ORDER BY h.source;
