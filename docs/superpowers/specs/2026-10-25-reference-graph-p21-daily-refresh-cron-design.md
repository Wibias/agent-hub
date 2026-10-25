# Reference Graph P21 Daily Projection Refresh Cron Design

## Intent

P21 removes the operational requirement to manually refresh the P10 Quick runtime projection after the UTC date changes. The production incident proved that a healthy activated Quick path can fail closed to `legacy-control` when the materialized P10 projection still contains the previous `snapshot_date`. P20 fixed the refresh RPC itself; P21 makes that already-governed refresh happen automatically.

P21 does not change activation, routing semantics, repository-default state, candidate selection, or the P10 refresh implementation.

## Starting point

- Implementation base: `72e36083375ee28287306bc23405da7b80d48b91`.
- P20 migration 012 is deployed to the dedicated production project and the current-date refresh succeeded with `snapshot_date = 2026-10-25` and `candidate_count = 275`.
- The first post-P20 P19 soak sample is healthy: Quick -> `reference-graph` exact, Standard/Deep -> `legacy-control`, repository default disabled.
- `public.reference_graph_refresh_quick_runtime_projection_p10()` remains `SECURITY DEFINER`, bounded by a 5-second statement timeout, and callable only by `service_role` plus its owner/superuser administrative context.
- Supabase Cron uses `pg_cron`, stores jobs in `cron.job`, run history in `cron.job_run_details`, and can execute database functions directly without HTTP or API credentials.

## Goals

1. Ensure the P10 projection is refreshed automatically at the UTC day boundary.
2. Run the governed database refresh directly inside Postgres with no Supabase API key, Vault secret, Edge Function, or external host scheduler.
3. Provide one immediate midnight run and one idempotent retry five minutes later.
4. Keep the scheduler definition idempotent and source-controlled.
5. Preserve all P10/P18/P19 privilege and routing boundaries.
6. Make the scheduled job observable through standard Supabase Cron / `cron.job_run_details` history.

## Non-goals

- No repository-default promotion.
- No new activation grant, nonce, authority material, or P17 state mutation.
- No change to P7/P10 candidate semantics or refresh response shape.
- No public/anon/authenticated access to the refresh RPC.
- No HTTP callback, Edge Function, or credential-bearing scheduler.
- No general-purpose cron framework.

## Approaches considered

### A. Windows Task Scheduler / host automation

Rejected. It would couple production freshness to one workstation, require a runtime credential, and add a host availability dependency.

### B. Scheduled Edge Function or HTTP request

Rejected. It adds network and secret-management failure modes for a task that is entirely database-local.

### C. Supabase Cron / `pg_cron` calling the existing P10 refresh function directly

Selected. The job executes inside Postgres with zero network hop, requires no API key, reuses the already-governed refresh function, and is natively observable in Supabase Cron history.

## Migration 013

Create `reference-graph/schema/013_reference_graph_daily_refresh_cron.sql`.

The migration must:

1. Enable `pg_cron` idempotently with `create extension if not exists pg_cron`.
2. Schedule exactly one named job: `reference-graph-p10-daily-refresh`.
3. Use cron expression `0,5 0 * * *`, which runs at 00:00 UTC and retries at 00:05 UTC.
4. Execute only `select public.reference_graph_refresh_quick_runtime_projection_p10();`.
5. Use no URL, API key, Vault secret, `pg_net`, HTTP request, or external function.
6. Not alter grants on the P10 refresh RPC.

Supabase Cron documents cron schedules in GMT/UTC and named jobs are replaced when scheduled again with the same name. Reapplying the migration therefore must leave exactly one active job with the exact schedule and command.

## Runtime behavior

At UTC midnight, `pg_cron` invokes the existing P10 refresh function. That function clears and rebuilds the projection using P7 with `reference_date = current_date`, and writes the new `snapshot_date`.

At 00:05 UTC, the same job invokes the refresh again. The operation is idempotent for the same date and acts as a bounded retry if the first invocation failed transiently. No caller-visible routing state changes are performed by P21 itself.

If both scheduled executions fail, existing P10/P17 logic continues to fail closed to `legacy-control`; P21 does not weaken that safety behavior.

## Observability

Operators verify:

- one active `cron.job` row named `reference-graph-p10-daily-refresh`;
- schedule exactly `0,5 0 * * *`;
- command calls only the P10 refresh function;
- successful runs appear in `cron.job_run_details`;
- the current projection `snapshot_date` equals `current_date` after the scheduled window.

No custom secret-bearing logging is added.

## CI and governance

Add `Reference graph P21 governance` on pull requests and `main` pushes. It must:

- run `node --test tests/reference-graph/p21-*.test.mjs`;
- scan the Reference Graph tree for common secrets;
- verify public release safety;
- execute migrations through 013 in a Supabase Postgres 17 disposable database with `pg_cron` available;
- prove migration 013 can be applied again without creating a second named job;
- assert the job is active with the exact name, schedule, and command;
- execute the P10 refresh directly and validate its receipt;
- prove `anon` and `authenticated` still lack P10 refresh EXECUTE while `service_role` retains it;
- prove CI contains no production project ref or Supabase production credentials.

## Live deployment boundary

Migration 013 may be deployed only after the exact P21 implementation SHA passes all PR governance, is merged, and the resulting real `main` SHA passes all post-merge governance.

Live deployment must use a Supabase CLI dry-run first and require exactly one pending migration. After deployment, verify the remote migration history and Cron job definition before treating P21 as active.

## Safety invariants

- Quick remains the only Reference Graph production profile.
- Standard and Deep remain `legacy-control`.
- Repository default remains disabled.
- P16 durable activation ledger is untouched.
- No new grant or nonce is created or consumed.
- No production credential is stored in the cron job or repository.
- P10 refresh privileges are not widened.
- Scheduler failure never promotes or bypasses fail-closed routing.