-- P40: read-only current-transaction source-versus-projection witness.
-- Operator-only. Execute against the dedicated project
-- vrznfnxzlxaavpqbzbzd via a separately authenticated, read-only connection.
-- No refresh function, DDL, cron or routing changes. Do not expose raw rows.
-- This is NOT the lost original P31 refresh-function receipt.
WITH t AS (
  SELECT statement_timestamp() AS observed_at,
         (statement_timestamp() AT TIME ZONE 'UTC')::date AS snapshot_date
), source_rows AS (
  SELECT p.asset_id, p.legacy_id, p.search_text, p.product,
         p.surface_family, p.platform, p.page_role, p.motion,
         p.source_family, p.topology, p.access_status, p.evidence_class,
         COALESCE(p.ordinary_or_failure_prone, false) AS ordinary_or_failure_prone,
         COALESCE(p.multi_state_flow, false) AS multi_state_flow,
         p.tags, a.metadata->>'primary_stratum' AS primary_stratum
  FROM public.reference_graph_quick_candidate_pool_p7(
    jsonb_build_object('reference_date', (SELECT snapshot_date::text FROM t))
  ) p
  JOIN reference_graph.current_assets a ON a.id = p.asset_id
), published_rows AS (
  SELECT *
  FROM public.reference_graph_profile_runtime_projection_p30_v1
  WHERE snapshot_date = (SELECT snapshot_date FROM t)
), paired AS (
  SELECT s.asset_id AS source_asset_id, p.asset_id AS published_asset_id,
    (s.legacy_id, s.search_text, s.product, s.surface_family,
     s.platform, s.page_role, s.motion, s.source_family,
     s.topology, s.access_status, s.evidence_class,
     s.ordinary_or_failure_prone, s.multi_state_flow,
     s.tags, s.primary_stratum)
    IS DISTINCT FROM
    (p.legacy_id, p.search_text, p.product, p.surface_family,
     p.platform, p.page_role, p.motion, p.source_family,
     p.topology, p.access_status, p.evidence_class,
     p.ordinary_or_failure_prone, p.multi_state_flow,
     p.tags, p.primary_stratum) AS metadata_diff
  FROM source_rows s FULL OUTER JOIN published_rows p
    ON s.asset_id = p.asset_id
), summary AS (
  SELECT
    (SELECT COUNT(*)::int FROM source_rows) AS expected_candidate_count,
    (SELECT COUNT(*)::int FROM published_rows) AS published_candidate_count,
    (SELECT ENCODE(SHA256(CONVERT_TO(COALESCE(
      STRING_AGG(legacy_id, E'\n' ORDER BY legacy_id COLLATE "C"), ''
    ), 'UTF8')), 'hex') FROM source_rows) AS source_hash,
    (SELECT ENCODE(SHA256(CONVERT_TO(COALESCE(
      STRING_AGG(legacy_id, E'\n' ORDER BY legacy_id COLLATE "C"), ''
    ), 'UTF8')), 'hex') FROM published_rows) AS published_hash,
    COUNT(*) FILTER (
      WHERE source_asset_id IS NULL OR published_asset_id IS NULL
    )::int AS membership_mismatches,
    COUNT(*) FILTER (
      WHERE metadata_diff AND source_asset_id IS NOT NULL
        AND published_asset_id IS NOT NULL
    )::int AS metadata_mismatches,
    (SELECT COUNT(DISTINCT refreshed_at)::int FROM published_rows) AS refreshed_instants,
    (SELECT MAX(refreshed_at) FROM published_rows) AS refreshed_at
  FROM paired
)
SELECT jsonb_build_object(
  'schema_version', 'reference-graph.p40-readonly-source-witness.v1',
  'source_method', 'p7-vs-p31-read-only',
  'project_ref', 'vrznfnxzlxaavpqbzbzd',
  'projection_version', 'reference-graph.profile-runtime.p30.v1',
  'snapshot_date', (SELECT snapshot_date::text FROM t),
  'refreshed_at', to_char(refreshed_at AT TIME ZONE 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'observed_at', to_char((SELECT observed_at FROM t) AT TIME ZONE 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'expected_candidate_count', expected_candidate_count,
  'expected_candidate_id_set_sha256', source_hash,
  'published_candidate_count', published_candidate_count,
  'published_candidate_id_set_sha256', published_hash,
  'membership_mismatch_count', membership_mismatches,
  'metadata_mismatch_count', metadata_mismatches,
  'refresh_instant_count', refreshed_instants,
  'activation_authorized', false,
  'repository_default_graph_enabled', false
) AS p40_witness
FROM summary;
