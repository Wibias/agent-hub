from pathlib import Path

workflow_path = Path('.github/workflows/verify-reference-graph.yml')
workflow = workflow_path.read_text()

old = "          import { assertSecretFreeP8Receipt } from './reference-graph/p8-receipt.mjs';\n"
new = old + "          import { assertSecretFreeP9Receipt } from './reference-graph/p9-receipt.mjs';\n"
if workflow.count(old) != 1:
    raise SystemExit('unexpected P8 receipt import count')
workflow = workflow.replace(old, new)

marker = "          NODE\n\n      - name: Scan Reference Graph tree for common secrets"
p9_scan = """          for (const file of [
            'reference-graph/evidence/p9-runtime-canary-evidence.json',
          ]) {
            if (!existsSync(file)) continue;
            const value = JSON.parse(readFileSync(file, 'utf8'));
            assertSecretFreeP9Receipt(value);
            console.log(`secret-free: ${file}`);
          }

"""
if workflow.count(marker) != 1:
    raise SystemExit('unexpected secret scan marker count')
workflow = workflow.replace(marker, p9_scan + marker)

p8_marker = "      - name: Verify P8 offline quick handoff contract\n"
p8_immutable = """      - name: Verify immutable P8 runtime boundary
        run: |
          EXPECTED_QUERY_BLOB='4963cfbaf4306a03084f4513a1e324f649ce36e5'
          ACTUAL_QUERY_BLOB="$(git hash-object knowledge/design-references/scripts/query.mjs)"
          if [ "$ACTUAL_QUERY_BLOB" != "$EXPECTED_QUERY_BLOB" ]; then
            echo "P8 production query CLI changed: expected $EXPECTED_QUERY_BLOB got $ACTUAL_QUERY_BLOB" >&2
            exit 1
          fi
          node --input-type=module <<'NODE'
          import fs from 'node:fs';
          const p8 = JSON.parse(fs.readFileSync('reference-graph/evidence/p8-cutover-review-evidence.json', 'utf8'));
          if (p8.production_source !== 'legacy-control'
            || p8.activation_performed !== false
            || p8.production_activation_ready !== false
            || p8.quick_path_review_eligible !== true) {
            throw new Error(`immutable P8 runtime boundary changed: ${JSON.stringify(p8)}`);
          }
          console.log('P8 runtime boundary remains immutable');
          NODE

"""
if workflow.count(p8_marker) != 1:
    raise SystemExit('unexpected P8 offline marker count')
workflow = workflow.replace(p8_marker, p8_immutable + p8_marker)

migration7 = "          psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -f reference-graph/schema/007_reference_graph_lexical_parity.sql\n"
migration8 = migration7 + "          psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -f reference-graph/schema/008_reference_graph_runtime_canary.sql\n"
if workflow.count(migration7) != 1:
    raise SystemExit('unexpected migration 007 count')
workflow = workflow.replace(migration7, migration8)

p9_smoke = r'''

      - name: Smoke-test P9 least-privilege runtime wrapper and negative grants
        env:
          PGPASSWORD: postgres
        run: |
          psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
          select 1 / case when to_regprocedure('public.reference_graph_quick_candidate_pool_runtime_p9()') is not null then 1 else 0 end as p9_wrapper_exists;

          do $$
          declare
            runtime_oid oid := to_regprocedure('public.reference_graph_quick_candidate_pool_runtime_p9()');
          begin
            if runtime_oid is null then
              raise exception 'P9 runtime wrapper missing';
            end if;
            if not has_function_privilege('anon', runtime_oid, 'EXECUTE')
              or not has_function_privilege('authenticated', runtime_oid, 'EXECUTE')
              or not has_function_privilege('service_role', runtime_oid, 'EXECUTE') then
              raise exception 'P9 runtime wrapper execute grants are incomplete';
            end if;

            if exists (
              select 1
              from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in (
                  'reference_graph_quick_candidate_pool_p7',
                  'reference_graph_lexical_candidates_p6',
                  'reference_graph_semantic_candidates_p6',
                  'reference_graph_candidate_context_p6',
                  'reference_graph_embedding_coverage',
                  'reference_graph_ingest_capture',
                  'reference_graph_record_verifications',
                  'reference_graph_upsert_embeddings'
                )
                and has_function_privilege('anon', p.oid, 'EXECUTE')
            ) then
              raise exception 'anon unexpectedly has a historical/operator Reference Graph RPC privilege';
            end if;
          end
          $$;

          set role anon;
          select 1 / case when count(*) = 2 then 1 else 0 end as p9_anon_wrapper_ok
          from public.reference_graph_quick_candidate_pool_runtime_p9()
          where legacy_id in ('ref-p7-a', 'ref-p7-b');
          reset role;

          set role authenticated;
          select 1 / case when count(*) = 2 then 1 else 0 end as p9_authenticated_wrapper_ok
          from public.reference_graph_quick_candidate_pool_runtime_p9()
          where legacy_id in ('ref-p7-a', 'ref-p7-b');
          reset role;

          set role service_role;
          select 1 / case when count(*) >= 2 then 1 else 0 end as p9_service_wrapper_ok
          from public.reference_graph_quick_candidate_pool_runtime_p9();
          select 1 / case when count(*) >= 2 then 1 else 0 end as historical_p7_service_access_unchanged
          from public.reference_graph_quick_candidate_pool_p7('{"reference_date":"2026-10-23"}'::jsonb);
          reset role;
          SQL

          if psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "set role anon; select public.reference_graph_quick_candidate_pool_p7('{}'::jsonb);"; then
            echo "anon unexpectedly executed P7 candidate-pool RPC" >&2
            exit 1
          fi
          if psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "set role anon; select public.reference_graph_lexical_candidates_p6('x','{}'::jsonb,1);"; then
            echo "anon unexpectedly executed P6 lexical RPC" >&2
            exit 1
          fi
          if psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "set role anon; select public.reference_graph_embedding_coverage('m','r','2026-10-23');"; then
            echo "anon unexpectedly executed embedding coverage RPC" >&2
            exit 1
          fi
          if psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "set role anon; select count(*) from reference_graph.assets;"; then
            echo "anon unexpectedly selected reference_graph.assets" >&2
            exit 1
          fi
'''
if 'Smoke-test P9 least-privilege runtime wrapper and negative grants' in workflow:
    raise SystemExit('P9 smoke already present')
workflow = workflow.rstrip() + p9_smoke + '\n'
Path('reference-graph/.p9-staged-governance.yml').write_text(workflow)

readme_path = Path('reference-graph/README.md')
readme = readme_path.read_text()
deploy_old = "005_reference_graph_freshness.sql\n```"
deploy_new = "005_reference_graph_freshness.sql\n006_reference_graph_retrieval_quality.sql\n007_reference_graph_lexical_parity.sql\n008_reference_graph_runtime_canary.sql\n```"
if readme.count(deploy_old) != 1:
    raise SystemExit('unexpected deployment block')
readme = readme.replace(deploy_old, deploy_new)

grants_old = "The exposed RPC surface lives in `public` so PostgREST can reach it, but execute permission is revoked from `public`, `anon`, and `authenticated` and granted only to `service_role`. The underlying `reference_graph` schema and `current_assets` view remain closed to exposed client roles."
grants_new = "Historical/operator RPC surfaces live in `public` for PostgREST but remain service-role-only. P9 adds one deliberate exception: the zero-argument `reference_graph_quick_candidate_pool_runtime_p9()` wrapper may be executed by `anon`, `authenticated`, and `service_role`. It exposes only the already-certified current-date quick candidate pool; underlying `reference_graph` tables/views and all P7/P6/write/operator RPCs remain closed to runtime roles."
if readme.count(grants_old) != 1:
    raise SystemExit('unexpected grants paragraph')
readme = readme.replace(grants_old, grants_new)

p9_docs = r'''

## P9 least-privilege runtime canary boundary

P9 is **shadow-only**. It proves that the already-certified `quick` candidate pool can be read through a narrow publishable/anon Supabase transport without putting `SUPABASE_SERVICE_ROLE_KEY` into a runtime process. There is **no production activation** in P9: `production_source` remains `legacy-control`, `production_activation_ready` stays `false`, and `activation_performed` stays `false` even when every P9 canary gate is green.

- `reference_graph_quick_candidate_pool_runtime_p9()` is zero-argument and always evaluates the current date server-side. Runtime callers cannot choose arbitrary historical dates or filters.
- `anon` and `authenticated` may execute only that narrow wrapper. P7/P6 retrieval RPCs, embedding coverage, ingest, verification writes, embedding writes, and direct Reference Graph table access remain denied.
- The P9 runtime client accepts a Supabase publishable key (or compatibility anon key) only. It has no service-role credential path and does not construct `ReferenceGraphSupabaseStore`.
- `quick` computes the legacy result first and keeps it authoritative. The graph result is diagnostic/shadow evidence only.
- Transport failure, timeout, malformed payload, unknown identities, or order/pattern mismatch fails closed to the legacy result.
- `standard` and `deep` remain legacy-only and perform no graph network request.
- Usage recording remains attached only to the authoritative legacy records and occurs once.

This phase certifies a reversible least-privilege canary boundary. A later, separately authorized phase would still be required to change production routing.
'''
if '## P9 least-privilege runtime canary boundary' in readme:
    raise SystemExit('P9 docs already present')
readme_path.write_text(readme.rstrip() + p9_docs + '\n')

p8_test_path = Path('tests/reference-graph/p8-ci-contract.test.mjs')
p8_test = p8_test_path.read_text()
old_title = "test('P8 governance keeps P7 receipt semantics immutable and does not introduce migration 008', () => {"
new_title = "test('P8 governance keeps P7 receipt semantics immutable while later phases preserve the P8 boundary', () => {"
if p8_test.count(old_title) != 1:
    raise SystemExit('unexpected P8 historical test title')
p8_test = p8_test.replace(old_title, new_title)
old_assert = "  assert.equal(/008_reference_graph/.test(WORKFLOW), false);"
new_assert = "  assert.match(WORKFLOW, /Verify immutable P8 runtime boundary/);"
if p8_test.count(old_assert) != 1:
    raise SystemExit('unexpected P8 migration assertion')
p8_test_path.write_text(p8_test.replace(old_assert, new_assert))
