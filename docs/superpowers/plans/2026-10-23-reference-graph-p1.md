# Reference Graph P1 Delivery

**Goal:** Make the P0 Reference Graph deploy-ready on Supabase/PostgreSQL, import the existing 600-reference catalog deterministically, and measure the challenger in shadow mode without changing production selection.

**Spec:** `docs/superpowers/specs/2026-10-23-reference-graph-p1-design.md`

## Delivery status

- [x] Create P1 branch from the completed P0 head.
- [x] Convert deterministic capture identities to PostgreSQL-compatible UUIDs.
- [x] Add service-role-only capture, batch import, lexical, semantic, context, and stats RPCs.
- [x] Add provider-neutral service-role embedding persistence.
- [x] Add a raw PostgREST/Supabase store adapter without a client-library or embedding-provider dependency.
- [x] Add deterministic planning for all 600 reviewed design references.
- [x] Add bounded batch import through an explicit `--apply` path.
- [x] Add a credential-free `--plan` path and fail closed when write intent is not explicit.
- [x] Add a fixed 24-case shadow evaluation suite.
- [x] Add a credential-free offline lexical challenger and a deployed Supabase lexical mode.
- [x] Keep the legacy design-reference selector as production control.
- [x] Preserve the legacy freshness/TTL contract during shadow evaluation.
- [x] Add incomparable-control semantics so empty legacy controls are not scored as zero overlap/failed top-1.
- [x] Execute migrations `001` / `002` / `003` successfully on disposable PostgreSQL 16 + pgvector in CI.
- [x] Verify `service_role` can call the Reference Graph RPC surface and `anon` cannot.
- [x] Upgrade permanent Reference Graph CI to run contracts, import planning, offline shadow evidence, migrations, and permission smoke tests.
- [x] Record the corrected 24-case offline lexical shadow baseline on run `39878538203` / job `120170025207`:
  - 24 total and 24 comparable cases;
  - legacy empty rate `0`;
  - graph empty rate `0`;
  - exact requested surface rate `1.0`;
  - exact requested platform rate `1.0`;
  - average overlap-at-k `0`;
  - legacy top-1 retention `0`;
  - `cutover_ready: false`, blocked by overlap and top-1 thresholds.
- [x] Confirm the same run passes 26/26 Reference Graph tests, the 600-record import plan (`576` unique sources, `600` assets, `0` asset deduplications), all three migrations, and service-role/anonymous permission smoke tests.
- [ ] Run broad Agent Hub governance on the final P1 revision, allowing only separately identified pre-existing `main` baseline mismatches to continue.
- [ ] Confirm final P1 diff contains no `skills/design-with-ai/**` changes and no credentials.
- [ ] Remove the temporary branch-only P1 workflow after final broad evidence.

## Shadow conclusion

P1 is deploy-ready but not cutover-ready.

The offline lexical challenger is deliberately simpler than the legacy selector. The legacy selector combines token overlap with surface/platform bonuses, evidence/availability/visual signals, and diversity penalties. P1 does not copy those policy heuristics into the challenger merely to improve agreement metrics.

The current offline evidence therefore establishes infrastructure correctness and a weak lexical baseline, not replacement quality. Semantic quality remains unevaluated until real compatible embeddings are generated and persisted.

## Live Supabase deployment

Not performed in P1 yet.

The connected Supabase account currently exposes a project whose name does not unambiguously identify it as the Agent Hub Reference Graph target. Migrations and the 600-record import must not be applied to that project without explicit project identification/authorization.

This does not block deploy-ready P1 acceptance because migration execution and access control are exercised against disposable pgvector/PostgreSQL in CI.

## Production cutover

Not part of P1.

Switching production selection away from the legacy design-reference selector remains a separate decision and delivery. `design-with-ai` stays unchanged here.
