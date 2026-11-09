-- P51, observed 2026-11-09 21:12:24 UTC through the connected Supabase
-- PostgreSQL management connection. READ-ONLY SELECT. No candidate rows are
-- returned. Run on the specified reference-graph project only.
--
-- This compares 15 shared fields (including asset_id) in a deterministic
-- JSONB-array order, with one newline per asset_id-sorted row. It deliberately
-- EXCLUDES refreshed_at, projection_version, and profile-only fields.
-- Equal hashes do NOT prove matching refresh times or historical provenance.
WITH fingerprint_rows AS (
  SELECT 'P10 Quick' AS source, asset_id,
    jsonb_build_array(asset_id, legacy_id, search_text, product, surface_family,
      platform, page_role, motion, source_family, topology, access_status,
      evidence_class, ordinary_or_failure_prone, multi_state_flow, tags)::text AS canonical_row
  FROM public.reference_graph_quick_runtime_projection_p10
  UNION ALL
  SELECT 'P30 Profiles', asset_id,
    jsonb_build_array(asset_id, legacy_id, search_text, product, surface_family,
      platform, page_role, motion, source_family, topology, access_status,
      evidence_class, ordinary_or_failure_prone, multi_state_flow, tags)::text
  FROM public.reference_graph_profile_runtime_projection_p30_v1
), summarized AS (
  SELECT source, count(*) AS row_count,
    encode(sha256(convert_to(string_agg(canonical_row, E'\n' ORDER BY asset_id),'UTF8')),
      'hex') AS shared_fields_sha256
  FROM fingerprint_rows
  GROUP BY source
)
SELECT source, row_count, shared_fields_sha256, now() AT TIME ZONE 'UTC'
  AS checked_at_utc
FROM summarized ORDER BY source;
