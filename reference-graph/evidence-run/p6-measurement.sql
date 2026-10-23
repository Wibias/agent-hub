CREATE TEMP TABLE p6_measurement_result ON COMMIT DROP AS
WITH RECURSIVE
input_files(url, expected_md5) AS (
  VALUES
    ('https://raw.githubusercontent.com/Wibias/agent-hub/8db756e69dfce9b3d781ac43f11becdcc130858d/reference-graph/evidence-run/p6-query-input-00.tsv','6a316f099e1986b9bfb01059df4a68ec'),
    ('https://raw.githubusercontent.com/Wibias/agent-hub/8db756e69dfce9b3d781ac43f11becdcc130858d/reference-graph/evidence-run/p6-query-input-01.tsv','d792394d5ff1b93fb7a66155998f3b3e'),
    ('https://raw.githubusercontent.com/Wibias/agent-hub/8db756e69dfce9b3d781ac43f11becdcc130858d/reference-graph/evidence-run/p6-query-input-02.tsv','76454a86931bb3267fba04238cbc42d2'),
    ('https://raw.githubusercontent.com/Wibias/agent-hub/8db756e69dfce9b3d781ac43f11becdcc130858d/reference-graph/evidence-run/p6-query-input-03.tsv','5f25d3d9aceac05c9fa8f881ed5a307d'),
    ('https://raw.githubusercontent.com/Wibias/agent-hub/8db756e69dfce9b3d781ac43f11becdcc130858d/reference-graph/evidence-run/p6-query-input-04.tsv','7ccdb4437e6b3424763e1270c82a3771'),
    ('https://raw.githubusercontent.com/Wibias/agent-hub/8db756e69dfce9b3d781ac43f11becdcc130858d/reference-graph/evidence-run/p6-query-input-05.tsv','d0e92d87a13fcb71adb6878452947d1e'),
    ('https://raw.githubusercontent.com/Wibias/agent-hub/8db756e69dfce9b3d781ac43f11becdcc130858d/reference-graph/evidence-run/p6-query-input-06.tsv','42cf5e33b1baa67fb5c01395bd687042'),
    ('https://raw.githubusercontent.com/Wibias/agent-hub/8db756e69dfce9b3d781ac43f11becdcc130858d/reference-graph/evidence-run/p6-query-input-07.tsv','a67822a5ab27579ee6349d554a335571'),
    ('https://raw.githubusercontent.com/Wibias/agent-hub/8db756e69dfce9b3d781ac43f11becdcc130858d/reference-graph/evidence-run/p6-query-input-08.tsv','c2ddf669f13bd466af6891103a4c47fe'),
    ('https://raw.githubusercontent.com/Wibias/agent-hub/8db756e69dfce9b3d781ac43f11becdcc130858d/reference-graph/evidence-run/p6-query-input-09.tsv','269c17aedf3c8e6904da940935725169'),
    ('https://raw.githubusercontent.com/Wibias/agent-hub/8db756e69dfce9b3d781ac43f11becdcc130858d/reference-graph/evidence-run/p6-query-input-10.tsv','41223cca6718865fa24762286a2067a0'),
    ('https://raw.githubusercontent.com/Wibias/agent-hub/8db756e69dfce9b3d781ac43f11becdcc130858d/reference-graph/evidence-run/p6-query-input-11.tsv','3a0a9b30214d9ca2944c4e684f427f33')
),
raw_files AS MATERIALIZED (
  SELECT url, expected_md5, (extensions.http_get(url)).content AS content
  FROM input_files
),
checked_files AS MATERIALIZED (
  SELECT content,
         CASE WHEN md5(content)=expected_md5 THEN 1
              ELSE 1/0 END AS integrity_ok
  FROM raw_files
),
input_lines AS (
  SELECT line
  FROM checked_files
  CROSS JOIN LATERAL regexp_split_to_table(content, E'\\n') AS line
  WHERE integrity_ok=1 AND line <> ''
),
cases(case_id,surface,platform,max_items,query,embedding_text,expected_legacy_ids) AS (
  SELECT
    split_part(line,E'\\t',1),
    split_part(line,E'\\t',2),
    split_part(line,E'\\t',3),
    split_part(line,E'\\t',4)::int,
    split_part(line,E'\\t',5),
    split_part(line,E'\\t',7),
    string_to_array(split_part(line,E'\\t',6),'|')
  FROM input_lines
)
lex AS (
  SELECT c.case_id, r.asset_id, r.rank, r.score,
         a.metadata->>'legacy_id' AS legacy_id,
         nullif(a.metadata->>'product','') AS product,
         a.metadata->>'surface_family' AS surface,
         a.metadata->>'platform' AS platform,
         nullif(s.source_family,'') AS source_family,
         nullif((SELECT o.body FROM reference_graph.observations o
                 WHERE o.asset_id=a.id AND o.observation_kind='topology'
                 ORDER BY o.id LIMIT 1),'') AS topology
  FROM cases c
  CROSS JOIN LATERAL public.reference_graph_lexical_candidates_p6(
    c.query,'{"reference_date":"2026-10-23"}'::jsonb,24
  ) r
  JOIN reference_graph.current_assets a ON a.id=r.asset_id
  JOIN reference_graph.sources s ON s.id=a.source_id
),
sem AS (
  SELECT c.case_id, r.asset_id, r.rank, r.score,
         a.metadata->>'legacy_id' AS legacy_id,
         nullif(a.metadata->>'product','') AS product,
         a.metadata->>'surface_family' AS surface,
         a.metadata->>'platform' AS platform,
         nullif(s.source_family,'') AS source_family,
         nullif((SELECT o.body FROM reference_graph.observations o
                 WHERE o.asset_id=a.id AND o.observation_kind='topology'
                 ORDER BY o.id LIMIT 1),'') AS topology
  FROM cases c
  CROSS JOIN LATERAL public.reference_graph_semantic_candidates_p6(
    c.embedding_text,'ollama/snowflake-arctic-embed:33m','e8db018629b4',
    '{"reference_date":"2026-10-23"}'::jsonb,24
  ) r
  JOIN reference_graph.current_assets a ON a.id=r.asset_id
  JOIN reference_graph.sources s ON s.id=a.source_id
),
lex_init AS (
  SELECT c.case_id,
         (SELECT count(*) FROM lex x WHERE x.case_id=c.case_id) >= c.max_items
         AND (
           SELECT EXISTS (
             SELECT 1
             FROM generate_series(0, least(z.both_count,c.max_items)) chosen_both
             WHERE greatest(0,z.surface_deficit-chosen_both) <= z.surface_only
               AND greatest(0,z.platform_deficit-chosen_both) <= z.platform_only
               AND chosen_both
                 + greatest(0,z.surface_deficit-chosen_both)
                 + greatest(0,z.platform_deficit-chosen_both) <= c.max_items
           )
           FROM (
             SELECT
               CASE WHEN c.surface IS NULL THEN 0 ELSE 1 END AS surface_deficit,
               CASE WHEN c.platform IS NULL THEN 0 ELSE ceil(c.max_items/2.0)::int END AS platform_deficit,
               count(*) FILTER (WHERE x.surface=c.surface AND x.platform=c.platform)::int AS both_count,
               count(*) FILTER (WHERE x.surface=c.surface AND x.platform IS DISTINCT FROM c.platform)::int AS surface_only,
               count(*) FILTER (WHERE x.surface IS DISTINCT FROM c.surface AND x.platform=c.platform)::int AS platform_only
             FROM lex x WHERE x.case_id=c.case_id
           ) z
         ) AS feasible
  FROM cases c
),
sem_init AS (
  SELECT c.case_id,
         (SELECT count(*) FROM sem x WHERE x.case_id=c.case_id) >= c.max_items
         AND (
           SELECT EXISTS (
             SELECT 1
             FROM generate_series(0, least(z.both_count,c.max_items)) chosen_both
             WHERE greatest(0,z.surface_deficit-chosen_both) <= z.surface_only
               AND greatest(0,z.platform_deficit-chosen_both) <= z.platform_only
               AND chosen_both
                 + greatest(0,z.surface_deficit-chosen_both)
                 + greatest(0,z.platform_deficit-chosen_both) <= c.max_items
           )
           FROM (
             SELECT
               CASE WHEN c.surface IS NULL THEN 0 ELSE 1 END AS surface_deficit,
               CASE WHEN c.platform IS NULL THEN 0 ELSE ceil(c.max_items/2.0)::int END AS platform_deficit,
               count(*) FILTER (WHERE x.surface=c.surface AND x.platform=c.platform)::int AS both_count,
               count(*) FILTER (WHERE x.surface=c.surface AND x.platform IS DISTINCT FROM c.platform)::int AS surface_only,
               count(*) FILTER (WHERE x.surface IS DISTINCT FROM c.surface AND x.platform=c.platform)::int AS platform_only
             FROM sem x WHERE x.case_id=c.case_id
           ) z
         ) AS feasible
  FROM cases c
),
lex_state AS (
  SELECT c.case_id, 0 AS step, array[]::uuid[] AS selected
  FROM cases c
  UNION ALL
  SELECT st.case_id, st.step+1, st.selected || choice.asset_id
  FROM lex_state st
  JOIN cases c USING(case_id)
  JOIN lex_init init USING(case_id)
  JOIN LATERAL (
    SELECT x.asset_id
    FROM lex x
    CROSS JOIN LATERAL (
      SELECT (
        CASE WHEN init.feasible THEN (
          SELECT EXISTS (
            SELECT 1
            FROM generate_series(0, least(z.both_count,z.slots)) chosen_both
            WHERE greatest(0,z.surface_deficit-chosen_both) <= z.surface_only
              AND greatest(0,z.platform_deficit-chosen_both) <= z.platform_only
              AND chosen_both
                + greatest(0,z.surface_deficit-chosen_both)
                + greatest(0,z.platform_deficit-chosen_both) <= z.slots
          )
          FROM (
            SELECT
              c.max_items-(st.step+1) AS slots,
              greatest(0,(CASE WHEN c.surface IS NULL THEN 0 ELSE 1 END)
                - (SELECT count(*) FROM lex q WHERE q.case_id=st.case_id AND q.asset_id=ANY(st.selected || x.asset_id) AND q.surface=c.surface))::int AS surface_deficit,
              greatest(0,(CASE WHEN c.platform IS NULL THEN 0 ELSE ceil(c.max_items/2.0)::int END)
                - (SELECT count(*) FROM lex q WHERE q.case_id=st.case_id AND q.asset_id=ANY(st.selected || x.asset_id) AND q.platform=c.platform))::int AS platform_deficit,
              count(*) FILTER (WHERE q.surface=c.surface AND q.platform=c.platform)::int AS both_count,
              count(*) FILTER (WHERE q.surface=c.surface AND q.platform IS DISTINCT FROM c.platform)::int AS surface_only,
              count(*) FILTER (WHERE q.surface IS DISTINCT FROM c.surface AND q.platform=c.platform)::int AS platform_only,
              count(*)::int AS remaining_count
            FROM lex q
            WHERE q.case_id=st.case_id AND NOT (q.asset_id=ANY(st.selected || x.asset_id))
          ) z
          WHERE z.remaining_count >= z.slots
        ) ELSE true END
      ) AS preserves
    ) f
    WHERE x.case_id=st.case_id AND NOT (x.asset_id=ANY(st.selected))
    ORDER BY
      f.preserves DESC,
      (
        x.score*5
        + CASE WHEN x.surface=c.surface THEN 60 ELSE 0 END
        + CASE WHEN x.platform=c.platform THEN 15 ELSE 0 END
        - 20*(SELECT count(*) FROM lex q WHERE q.case_id=st.case_id AND q.asset_id=ANY(st.selected) AND x.product IS NOT NULL AND q.product=x.product)
        - 8*(SELECT count(*) FROM lex q WHERE q.case_id=st.case_id AND q.asset_id=ANY(st.selected) AND x.source_family IS NOT NULL AND q.source_family=x.source_family)
        - 6*(SELECT count(*) FROM lex q WHERE q.case_id=st.case_id AND q.asset_id=ANY(st.selected) AND x.topology IS NOT NULL AND q.topology=x.topology)
      ) DESC,
      x.asset_id
    LIMIT 1
  ) choice ON st.step < c.max_items
),
sem_state AS (
  SELECT c.case_id, 0 AS step, array[]::uuid[] AS selected
  FROM cases c
  UNION ALL
  SELECT st.case_id, st.step+1, st.selected || choice.asset_id
  FROM sem_state st
  JOIN cases c USING(case_id)
  JOIN sem_init init USING(case_id)
  JOIN LATERAL (
    SELECT x.asset_id
    FROM sem x
    CROSS JOIN LATERAL (
      SELECT (
        CASE WHEN init.feasible THEN (
          SELECT EXISTS (
            SELECT 1
            FROM generate_series(0, least(z.both_count,z.slots)) chosen_both
            WHERE greatest(0,z.surface_deficit-chosen_both) <= z.surface_only
              AND greatest(0,z.platform_deficit-chosen_both) <= z.platform_only
              AND chosen_both
                + greatest(0,z.surface_deficit-chosen_both)
                + greatest(0,z.platform_deficit-chosen_both) <= z.slots
          )
          FROM (
            SELECT
              c.max_items-(st.step+1) AS slots,
              greatest(0,(CASE WHEN c.surface IS NULL THEN 0 ELSE 1 END)
                - (SELECT count(*) FROM sem q WHERE q.case_id=st.case_id AND q.asset_id=ANY(st.selected || x.asset_id) AND q.surface=c.surface))::int AS surface_deficit,
              greatest(0,(CASE WHEN c.platform IS NULL THEN 0 ELSE ceil(c.max_items/2.0)::int END)
                - (SELECT count(*) FROM sem q WHERE q.case_id=st.case_id AND q.asset_id=ANY(st.selected || x.asset_id) AND q.platform=c.platform))::int AS platform_deficit,
              count(*) FILTER (WHERE q.surface=c.surface AND q.platform=c.platform)::int AS both_count,
              count(*) FILTER (WHERE q.surface=c.surface AND q.platform IS DISTINCT FROM c.platform)::int AS surface_only,
              count(*) FILTER (WHERE q.surface IS DISTINCT FROM c.surface AND q.platform=c.platform)::int AS platform_only,
              count(*)::int AS remaining_count
            FROM sem q
            WHERE q.case_id=st.case_id AND NOT (q.asset_id=ANY(st.selected || x.asset_id))
          ) z
          WHERE z.remaining_count >= z.slots
        ) ELSE true END
      ) AS preserves
    ) f
    WHERE x.case_id=st.case_id AND NOT (x.asset_id=ANY(st.selected))
    ORDER BY f.preserves DESC, x.score DESC, x.rank, x.asset_id
    LIMIT 1
  ) choice ON st.step < c.max_items
),
union_rows AS (
  SELECT coalesce(l.case_id,s.case_id) case_id,
         coalesce(l.asset_id,s.asset_id) asset_id,
         CASE WHEN l.asset_id IS NOT NULL THEN 'lexical' ELSE 'semantic-only' END channel,
         l.score lex_score,
         coalesce(s.score,l.score) sem_score,
         coalesce(s.rank,2147483647) sem_rank,
         coalesce(l.legacy_id,s.legacy_id) legacy_id,
         coalesce(l.product,s.product) product,
         coalesce(l.surface,s.surface) surface,
         coalesce(l.platform,s.platform) platform,
         coalesce(l.source_family,s.source_family) source_family,
         coalesce(l.topology,s.topology) topology
  FROM lex l FULL OUTER JOIN sem s USING(case_id,asset_id)
),
hyb_init AS (
  SELECT c.case_id,
         (SELECT count(*) FROM union_rows x WHERE x.case_id=c.case_id) >= c.max_items
         AND (
           SELECT EXISTS (
             SELECT 1 FROM generate_series(0,least(z.both_count,c.max_items)) chosen_both
             WHERE greatest(0,z.surface_deficit-chosen_both) <= z.surface_only
               AND greatest(0,z.platform_deficit-chosen_both) <= z.platform_only
               AND chosen_both+greatest(0,z.surface_deficit-chosen_both)+greatest(0,z.platform_deficit-chosen_both) <= c.max_items
           )
           FROM (
             SELECT CASE WHEN c.surface IS NULL THEN 0 ELSE 1 END surface_deficit,
                    CASE WHEN c.platform IS NULL THEN 0 ELSE ceil(c.max_items/2.0)::int END platform_deficit,
                    count(*) FILTER (WHERE x.surface=c.surface AND x.platform=c.platform)::int both_count,
                    count(*) FILTER (WHERE x.surface=c.surface AND x.platform IS DISTINCT FROM c.platform)::int surface_only,
                    count(*) FILTER (WHERE x.surface IS DISTINCT FROM c.surface AND x.platform=c.platform)::int platform_only
             FROM union_rows x WHERE x.case_id=c.case_id
           ) z
         ) AS feasible
  FROM cases c
),
hyb_state AS (
  SELECT c.case_id, 0 AS step, array[]::uuid[] AS selected
  FROM cases c
  UNION ALL
  SELECT st.case_id, st.step+1, st.selected || choice.asset_id
  FROM hyb_state st
  JOIN cases c USING(case_id)
  JOIN lex_init lc USING(case_id)
  JOIN hyb_init init USING(case_id)
  JOIN LATERAL (
    SELECT x.asset_id
    FROM union_rows x
    CROSS JOIN LATERAL (
      SELECT (
        CASE WHEN (CASE WHEN lc.feasible THEN true ELSE init.feasible END) THEN (
          SELECT EXISTS (
            SELECT 1 FROM generate_series(0,least(z.both_count,z.slots)) chosen_both
            WHERE greatest(0,z.surface_deficit-chosen_both) <= z.surface_only
              AND greatest(0,z.platform_deficit-chosen_both) <= z.platform_only
              AND chosen_both+greatest(0,z.surface_deficit-chosen_both)+greatest(0,z.platform_deficit-chosen_both) <= z.slots
          )
          FROM (
            SELECT c.max_items-(st.step+1) slots,
                   greatest(0,(CASE WHEN c.surface IS NULL THEN 0 ELSE 1 END)
                    - (SELECT count(*) FROM union_rows q WHERE q.case_id=st.case_id AND q.asset_id=ANY(st.selected || x.asset_id) AND q.surface=c.surface))::int surface_deficit,
                   greatest(0,(CASE WHEN c.platform IS NULL THEN 0 ELSE ceil(c.max_items/2.0)::int END)
                    - (SELECT count(*) FROM union_rows q WHERE q.case_id=st.case_id AND q.asset_id=ANY(st.selected || x.asset_id) AND q.platform=c.platform))::int platform_deficit,
                   count(*) FILTER (WHERE q.surface=c.surface AND q.platform=c.platform)::int both_count,
                   count(*) FILTER (WHERE q.surface=c.surface AND q.platform IS DISTINCT FROM c.platform)::int surface_only,
                   count(*) FILTER (WHERE q.surface IS DISTINCT FROM c.surface AND q.platform=c.platform)::int platform_only,
                   count(*)::int remaining_count
            FROM union_rows q
            WHERE q.case_id=st.case_id
              AND NOT (q.asset_id=ANY(st.selected || x.asset_id))
              AND (NOT lc.feasible OR q.channel='lexical')
          ) z
          WHERE z.remaining_count >= z.slots
        ) ELSE true END
      ) preserves
    ) f
    WHERE x.case_id=st.case_id
      AND NOT (x.asset_id=ANY(st.selected))
      AND (NOT lc.feasible OR x.channel='lexical')
    ORDER BY
      f.preserves DESC,
      CASE WHEN x.channel='lexical' THEN 0 ELSE 1 END,
      CASE WHEN x.channel='lexical' THEN
        -(
          x.lex_score*5
          + CASE WHEN x.surface=c.surface THEN 60 ELSE 0 END
          + CASE WHEN x.platform=c.platform THEN 15 ELSE 0 END
          - 20*(SELECT count(*) FROM union_rows q WHERE q.case_id=st.case_id AND q.asset_id=ANY(st.selected) AND q.channel='lexical' AND x.product IS NOT NULL AND q.product=x.product)
          - 8*(SELECT count(*) FROM union_rows q WHERE q.case_id=st.case_id AND q.asset_id=ANY(st.selected) AND q.channel='lexical' AND x.source_family IS NOT NULL AND q.source_family=x.source_family)
          - 6*(SELECT count(*) FROM union_rows q WHERE q.case_id=st.case_id AND q.asset_id=ANY(st.selected) AND q.channel='lexical' AND x.topology IS NOT NULL AND q.topology=x.topology)
        )
        ELSE -x.sem_score END,
      x.sem_rank,
      x.asset_id
    LIMIT 1
  ) choice ON st.step < c.max_items
),
final_states AS (
  SELECT DISTINCT ON (case_id) 'lexical'::text AS mode, case_id, selected
  FROM lex_state ORDER BY case_id, step DESC
),
final_sem AS (
  SELECT DISTINCT ON (case_id) 'semantic'::text AS mode, case_id, selected
  FROM sem_state ORDER BY case_id, step DESC
),
final_hyb AS (
  SELECT DISTINCT ON (case_id) 'hybrid'::text AS mode, case_id, selected
  FROM hyb_state ORDER BY case_id, step DESC
),
all_final AS (
  SELECT * FROM final_states UNION ALL SELECT * FROM final_sem UNION ALL SELECT * FROM final_hyb
)
SELECT f.case_id,f.mode,
       ARRAY(SELECT coalesce(l.legacy_id,s.legacy_id)
             FROM unnest(f.selected) WITH ORDINALITY u(id,ord)
             LEFT JOIN lex l ON l.case_id=f.case_id AND l.asset_id=u.id
             LEFT JOIN sem s ON s.case_id=f.case_id AND s.asset_id=u.id
             ORDER BY ord) AS selected_legacy_ids,
       cardinality(f.selected) AS graph_count,
       (SELECT count(*) FROM unnest(c.expected_legacy_ids) e(id)
        WHERE e.id=ANY(ARRAY(SELECT coalesce(l.legacy_id,s.legacy_id)
             FROM unnest(f.selected) u(id)
             LEFT JOIN lex l ON l.case_id=f.case_id AND l.asset_id=u.id
             LEFT JOIN sem s ON s.case_id=f.case_id AND s.asset_id=u.id))) AS overlap_count,
       (c.expected_legacy_ids[1]=ANY(ARRAY(SELECT coalesce(l.legacy_id,s.legacy_id)
             FROM unnest(f.selected) u(id)
             LEFT JOIN lex l ON l.case_id=f.case_id AND l.asset_id=u.id
             LEFT JOIN sem s ON s.case_id=f.case_id AND s.asset_id=u.id))) AS top1,
       (SELECT count(*) FROM unnest(f.selected) u(id)
        JOIN union_rows x ON x.case_id=f.case_id AND x.asset_id=u.id WHERE x.surface=c.surface) AS exact_surface,
       (SELECT count(*) FROM unnest(f.selected) u(id)
        JOIN union_rows x ON x.case_id=f.case_id AND x.asset_id=u.id WHERE x.platform=c.platform) AS exact_platform,
       (SELECT count(*) FROM lex x WHERE x.case_id=f.case_id) AS lexical_candidate_count,
       (SELECT count(*) FROM sem x WHERE x.case_id=f.case_id) AS semantic_candidate_count,
       (SELECT count(*) FROM union_rows x WHERE x.case_id=f.case_id) AS union_candidate_count,
       li.feasible AS lexical_coverage_feasible,
       si.feasible AS semantic_coverage_feasible,
       hi.feasible AS union_coverage_feasible,
       (SELECT count(*) FROM unnest(f.selected) u(id)
        JOIN union_rows x ON x.case_id=f.case_id AND x.asset_id=u.id WHERE x.channel='lexical') AS selected_lexical_count,
       (SELECT count(*) FROM unnest(f.selected) u(id)
        JOIN union_rows x ON x.case_id=f.case_id AND x.asset_id=u.id WHERE x.channel='semantic-only') AS selected_semantic_only_count
FROM all_final f
JOIN cases c USING(case_id)
JOIN lex_init li USING(case_id)
JOIN sem_init si USING(case_id)
JOIN hyb_init hi USING(case_id)
ORDER BY c.case_id, CASE f.mode WHEN 'lexical' THEN 1 WHEN 'semantic' THEN 2 ELSE 3 END;
