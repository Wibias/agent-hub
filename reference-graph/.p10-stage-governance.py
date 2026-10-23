from pathlib import Path

workflow = Path('.github/workflows/verify-reference-graph.yml')
text = workflow.read_text()

old = "          import { assertSecretFreeP9Receipt } from './reference-graph/p9-receipt.mjs';\n"
new = old + "          import { assertSecretFreeP10Receipt } from './reference-graph/p10-receipt.mjs';\n"
if text.count(old) != 1:
    raise SystemExit('unexpected P9 receipt import count')
text = text.replace(old, new, 1)

marker = "\n          NODE\n\n      - name: Scan Reference Graph tree for common secrets"
p10_scan = """
          for (const file of [
            'reference-graph/evidence/p10-runtime-projection-evidence.json',
          ]) {
            if (!existsSync(file)) continue;
            const value = JSON.parse(readFileSync(file, 'utf8'));
            assertSecretFreeP10Receipt(value);
            console.log(`secret-free: ${file}`);
          }
"""
if text.count(marker) != 1:
    raise SystemExit('unexpected secret-scan NODE marker count')
text = text.replace(marker, '\n' + p10_scan + marker, 1)

current_control = "      - name: Measure current P5 legacy control health\n"
immutable_p9 = r'''      - name: Verify immutable P9 runtime canary evidence
        run: |
          node --input-type=module <<'NODE'
          import fs from 'node:fs';
          const p9 = JSON.parse(fs.readFileSync('reference-graph/evidence/p9-runtime-canary-evidence.json', 'utf8'));
          const security = p9.runtime_security;
          const pool = p9.candidate_pool;
          const canary = p9.canary;
          if (p9.schema_version !== 'reference-graph.p9-runtime-canary.v1'
            || p9.base_sha !== '619e0b490420f5292dd4bf16ae36cded4013f7d5'
            || p9.git_sha !== 'a5458ee322e459aea114d242d243ded9e027c4d4'
            || p9.production_source !== 'legacy-control'
            || p9.activation_performed !== false
            || p9.least_privilege_transport_ready !== false
            || p9.quick_shadow_canary_ready !== false
            || p9.production_activation_ready !== false
            || security?.anon_wrapper_execute !== true
            || security?.authenticated_wrapper_execute !== true
            || security?.service_role_used_by_canary !== false
            || security?.security_advisor_p9_warn_error_count !== 2
            || pool?.candidate_count !== 275
            || pool?.complete_metadata_count !== 275
            || pool?.unique_legacy_id_count !== 275
            || pool?.live_hash !== 'd489261eb810d8e27ed32bc774cf173f'
            || pool?.offline_hash !== 'd489261eb810d8e27ed32bc774cf173f'
            || pool?.equivalent !== true
            || canary?.case_count !== 24
            || canary?.exact_record_count !== 24
            || canary?.exact_pattern_count !== 24
            || canary?.mismatch_count !== 0
            || canary?.legacy_authoritative_count !== 24) {
            throw new Error(`immutable P9 evidence changed: ${JSON.stringify(p9)}`);
          }
          console.log(JSON.stringify({
            base_sha: p9.base_sha,
            git_sha: p9.git_sha,
            production_source: p9.production_source,
            runtime_security: security,
            candidate_pool: pool,
            canary,
          }, null, 2));
          NODE

'''
if text.count(current_control) != 1:
    raise SystemExit('unexpected current-control marker count')
text = text.replace(current_control, immutable_p9 + current_control, 1)

migration8 = "          psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -f reference-graph/schema/008_reference_graph_runtime_canary.sql\n"
migration9 = migration8 + "          psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -f reference-graph/schema/009_reference_graph_runtime_projection.sql\n"
if text.count(migration8) != 1:
    raise SystemExit('unexpected migration 008 count')
text = text.replace(migration8, migration9, 1)

p9_marker = "      - name: Smoke-test P9 least-privilege runtime wrapper and negative grants\n"
if p9_marker not in text:
    raise SystemExit('P9 smoke marker missing')
prefix = text.split(p9_marker, 1)[0]
tail = r'''      - name: Smoke-test P9 least-privilege runtime wrapper and negative grants
        env:
          PGPASSWORD: postgres
        run: |
          psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
          select 1 / case when to_regprocedure('public.reference_graph_quick_candidate_pool_runtime_p9()') is not null then 1 else 0 end as p9_wrapper_exists;
          select 1 / case when not has_function_privilege('anon', 'public.reference_graph_quick_candidate_pool_runtime_p9()', 'EXECUTE') then 1 else 0 end as p9_anon_closed_after_p10;
          select 1 / case when not has_function_privilege('authenticated', 'public.reference_graph_quick_candidate_pool_runtime_p9()', 'EXECUTE') then 1 else 0 end as p9_authenticated_closed_after_p10;
          select 1 / case when has_function_privilege('service_role', 'public.reference_graph_quick_candidate_pool_runtime_p9()', 'EXECUTE') then 1 else 0 end as p9_service_access_preserved;

          set role service_role;
          select 1 / case when count(*) >= 2 then 1 else 0 end as p9_service_wrapper_ok
          from public.reference_graph_quick_candidate_pool_runtime_p9();
          select 1 / case when count(*) >= 2 then 1 else 0 end as historical_p7_service_access_unchanged
          from public.reference_graph_quick_candidate_pool_p7('{"reference_date":"2026-10-23"}'::jsonb);
          reset role;
          SQL

          if psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "set role anon; select public.reference_graph_quick_candidate_pool_runtime_p9();"; then
            echo "anon unexpectedly executed closed P9 runtime wrapper" >&2
            exit 1
          fi
          if psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "set role authenticated; select public.reference_graph_quick_candidate_pool_runtime_p9();"; then
            echo "authenticated unexpectedly executed closed P9 runtime wrapper" >&2
            exit 1
          fi
          if psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "set role anon; select public.reference_graph_quick_candidate_pool_p7('{}'::jsonb);"; then
            echo "anon unexpectedly executed P7 candidate-pool RPC" >&2
            exit 1
          fi
          if psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "set role authenticated; select public.reference_graph_quick_candidate_pool_p7('{}'::jsonb);"; then
            echo "authenticated unexpectedly executed P7 candidate-pool RPC" >&2
            exit 1
          fi
          if psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "set role anon; select count(*) from reference_graph.assets;"; then
            echo "anon unexpectedly selected reference_graph.assets" >&2
            exit 1
          fi

      - name: Smoke-test P10 runtime projection RLS, refresh grants, and P9 closure
        env:
          PGPASSWORD: postgres
        run: |
          psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
          select 1 / case when exists (
            select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname = 'reference_graph_quick_runtime_projection_p10'
              and c.relrowsecurity is true
          ) then 1 else 0 end as p10_projection_rls_ok;

          select 1 / case when has_table_privilege('anon', 'public.reference_graph_quick_runtime_projection_p10', 'SELECT') then 1 else 0 end as p10_anon_select_ok;
          select 1 / case when has_table_privilege('authenticated', 'public.reference_graph_quick_runtime_projection_p10', 'SELECT') then 1 else 0 end as p10_authenticated_select_ok;
          select 1 / case when not has_table_privilege('anon', 'public.reference_graph_quick_runtime_projection_p10', 'INSERT') then 1 else 0 end as p10_anon_insert_denied;
          select 1 / case when not has_table_privilege('authenticated', 'public.reference_graph_quick_runtime_projection_p10', 'UPDATE') then 1 else 0 end as p10_authenticated_update_denied;
          select 1 / case when not has_table_privilege('anon', 'public.reference_graph_quick_runtime_projection_p10', 'DELETE') then 1 else 0 end as p10_anon_delete_denied;

          select 1 / case when not has_function_privilege('anon', 'public.reference_graph_refresh_quick_runtime_projection_p10()', 'EXECUTE') then 1 else 0 end as p10_refresh_anon_closed;
          select 1 / case when not has_function_privilege('authenticated', 'public.reference_graph_refresh_quick_runtime_projection_p10()', 'EXECUTE') then 1 else 0 end as p10_refresh_authenticated_closed;
          select 1 / case when has_function_privilege('service_role', 'public.reference_graph_refresh_quick_runtime_projection_p10()', 'EXECUTE') then 1 else 0 end as p10_refresh_service_ok;

          set role service_role;
          select public.reference_graph_refresh_quick_runtime_projection_p10();
          reset role;

          set role anon;
          select 1 / case when count(*) >= 2 then 1 else 0 end as p10_anon_current_snapshot_ok
          from public.reference_graph_quick_runtime_projection_p10
          where snapshot_date = current_date and legacy_id in ('ref-p7-a', 'ref-p7-b');
          reset role;

          set role authenticated;
          select 1 / case when count(*) >= 2 then 1 else 0 end as p10_authenticated_current_snapshot_ok
          from public.reference_graph_quick_runtime_projection_p10
          where snapshot_date = current_date and legacy_id in ('ref-p7-a', 'ref-p7-b');
          reset role;

          update public.reference_graph_quick_runtime_projection_p10
          set snapshot_date = current_date - 1;

          set role anon;
          select 1 / case when count(*) = 0 then 1 else 0 end as p10_stale_snapshot_hidden_ok
          from public.reference_graph_quick_runtime_projection_p10;
          reset role;

          set role service_role;
          select public.reference_graph_refresh_quick_runtime_projection_p10();
          reset role;
          SQL

          if psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "set role anon; insert into public.reference_graph_quick_runtime_projection_p10(asset_id,legacy_id,ordinary_or_failure_prone,multi_state_flow,tags,search_text,snapshot_date,refreshed_at) values ('a0000000-0000-5000-8000-000000000099','forbidden',false,false,'[]','x',current_date,now());"; then
            echo "anon unexpectedly inserted into P10 projection" >&2
            exit 1
          fi
          if psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "set role authenticated; update public.reference_graph_quick_runtime_projection_p10 set search_text='forbidden';"; then
            echo "authenticated unexpectedly updated P10 projection" >&2
            exit 1
          fi
          if psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "set role anon; delete from public.reference_graph_quick_runtime_projection_p10;"; then
            echo "anon unexpectedly deleted from P10 projection" >&2
            exit 1
          fi
          if psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -c "set role authenticated; select public.reference_graph_refresh_quick_runtime_projection_p10();"; then
            echo "authenticated unexpectedly executed P10 refresh" >&2
            exit 1
          fi
'''
text = prefix + tail
Path('reference-graph/.p10-fixed-governance.yml').write_text(text)

readme = Path('reference-graph/README.md')
docs = readme.read_text()
if '009_reference_graph_runtime_projection.sql' not in docs:
    docs = docs.replace(
        '008_reference_graph_runtime_canary.sql\n',
        '008_reference_graph_runtime_canary.sql\n009_reference_graph_runtime_projection.sql\n',
        1,
    )
p9_paragraph = "Historical/operator RPC surfaces live in `public` for PostgREST but remain service-role-only. P9 adds one deliberate exception: the zero-argument `reference_graph_quick_candidate_pool_runtime_p9()` wrapper may be executed by `anon`, `authenticated`, and `service_role`. It exposes only the already-certified current-date quick candidate pool; underlying `reference_graph` tables/views and all P7/P6/write/operator RPCs remain closed to runtime roles."
p10_paragraph = "Historical/operator RPC surfaces live in `public` for PostgREST but remain service-role-only. P9 historically exposed one narrow publishable-key `SECURITY DEFINER` wrapper. P10 closes that wrapper to `anon` and `authenticated` and replaces runtime access with the RLS-backed `reference_graph_quick_runtime_projection_p10` table. Runtime roles receive SELECT only, and Row Level Security exposes only rows whose `snapshot_date = current_date`; a stale or missing snapshot is therefore invisible and the canary falls back to `legacy-control`. The service-role-only `reference_graph_refresh_quick_runtime_projection_p10()` function refreshes the projection from the certified P7 quick pool. Standard and deep remain legacy-only, and P10 performs no production activation; activation is deferred to a later explicit phase."
if p9_paragraph in docs:
    docs = docs.replace(p9_paragraph, p10_paragraph, 1)
if '## P10 least-privilege runtime projection' not in docs:
    docs += """

## P10 least-privilege runtime projection

P10 removes the publishable-key `SECURITY DEFINER` entry point introduced for the P9 shadow canary. The public runtime surface is now `reference_graph_quick_runtime_projection_p10`, a read-only projection protected by RLS. `anon` and `authenticated` have SELECT only; INSERT, UPDATE, and DELETE remain denied. RLS requires `snapshot_date = current_date`, so a stale or missing snapshot returns no usable graph candidates and runtime behavior fails closed to `legacy-control`.

Only the service-role-only `reference_graph_refresh_quick_runtime_projection_p10()` function may rebuild the projection, and it always copies the current-date certified P7 quick pool. The P10 publishable-key client performs a PostgREST GET against the projection and has no service-role or write path. Standard and deep remain legacy-only and make no graph network call. P10 proves least-privilege transport and shadow-canary readiness only: there is **no production activation** in P10, and any activation decision plus refresh operations belong to a later phase.
"""
readme.write_text(docs)
