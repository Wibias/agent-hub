-- P52 membership digest exactly matches P31's source-ID hash algorithm:
-- SHA256 of newline-joined, C-collation-sorted legacy IDs.
-- This is an independent read-only aggregation for the CURRENT date only.
WITH src AS (
 SELECT legacy_id FROM public.reference_graph_quick_candidate_pool_p7(
 jsonb_build_object('reference_date',(statement_timestamp() AT TIME ZONE 'UTC')::date::text))
), dst AS (
 SELECT legacy_id FROM public.reference_graph_profile_runtime_projection_p30_v1
)
SELECT 'P7_source' AS source, count(*) AS records,
  encode(sha256(convert_to(COALESCE(string_agg(legacy_id,E'\n'
    ORDER BY legacy_id COLLATE "C"),''),'UTF8')),'hex') AS sorted_legacy_id_set_sha256
FROM src
UNION ALL
SELECT 'P31_projection', count(*),
  encode(sha256(convert_to(COALESCE(string_agg(legacy_id,E'\n'
    ORDER BY legacy_id COLLATE "C"),''),'UTF8')),'hex')
FROM dst;
