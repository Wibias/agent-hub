# Database expand / backfill / contract

Adapted from `addyosmani/agent-skills` `deprecation-and-migration` (MIT).

Production schema changes must tolerate the deployment window in which old and new code may run at the same time.

## Sequence

1. **Expand** - add the new nullable/compatible column, table, index or representation alongside the old shape. Old code must remain valid.
2. **Dual-write or compatibility write** - when required, begin populating both forms from authoritative writes.
3. **Backfill** - migrate existing rows in bounded batches outside latency-sensitive request paths. Measure progress and failure/retry behavior.
4. **Verify parity** - prove the new representation is complete/correct enough for the read switch. Sample/diff or invariant checks should match the data risk.
5. **Switch reads** - deploy code that reads the new shape while the old one still exists. Keep rollback possible.
6. **Stop old writes** - only after the read switch is proven and no old writer still requires the old shape.
7. **Contract** - drop/rename/destructively transform the old shape in a later change after static and runtime evidence show no remaining dependency.

## Rules

- Additive first, destructive last.
- A destructive migration should not share the same deploy as the first code that depends on the new shape when rolling deployment/mixed versions are possible.
- Backfills over large tables are batched/throttled and restartable; do not assume one giant update is operationally safe.
- Build large indexes using the database's non-blocking/concurrent mechanism where available and verify the actual product/version documentation through `source-driven-development` when syntax/semantics matter.
- Every rollback claim must match reality. Some destructive/data transformations are not reversible by a simple `down`; when true, use cut-forward/restore strategy and state that explicitly rather than inventing a false rollback.
- Data migrations require backup/recovery and integrity considerations proportional to the data's value.
