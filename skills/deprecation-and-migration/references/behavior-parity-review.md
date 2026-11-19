# Behavioral parity and deliberate-delta review (conditional)

Load when a migration replaces **existing executed behavior** and the promised contract is the same, or when a rewrite risks silently changing output/error/side-effect behavior. This is an implementation-migration lens inspired by the behavioral verification emphasis of Anthropic's `claude-plugins-official/plugins/code-modernization`. It is not a generic code-review requirement, and it does not replace `migration-patterns.md` or live consumer verification.

## Establish the baseline contract first

- Name the old and new entrypoints, consumer-facing boundary, representative workloads and the exact old revision/build. Read current code and actual tests, not only the rewrite proposal.
- Record observations with `file:line`, test reference or executable evidence. Distinguish `OBSERVED` runtime behavior, `SOURCE_INFERRED` behavior needing a test and `UNKNOWN` behavior. A trace from one happy path does not prove an entire contract.
- Identify the expected differences **before** comparing. Each intentional delta needs explicit approval, consumer impact and migration/rollback treatment; do not quietly relabel a regression as desired modernization.

## Compare only meaningful observable dimensions

Choose the applicable contract axes; do not demand every item for every migration:

| Axis | Question |
| --- | --- |
| Successful results | Do output values, data formats, units, ordering, ID semantics and defaults match? |
| Errors and partial success | Are error classes/codes, retries, permission failures, invalid inputs, fallback visibility and partial-commit semantics preserved? |
| Side effects | Are emitted events, write order, notification count, idempotency, cancellation and cleanup equivalent? |
| Lifecycle | Are timeouts, concurrency/locking, restart recovery, cache invalidation, and persistence boundaries preserved? |
| Consumers and versions | Do older and newer callers survive the overlap window; are feature flags and rollbacks real? |
| Nonfunctional guarantees | Only compare latency/cost/performance when measured on comparable workloads; do not infer improvement from refactoring style. |

Use existing stable-boundary tests, a read-only replay of stored fixtures, or a **bounded** side-by-side comparison. Compare representative normal, adverse and edge inputs; record coverage holes. For effectful operations, do **not** run old and new writers against production for parity. Use simulation, read-only shadow computation, isolated storage or explicitly approved idempotent test environments.

## Distinguish mismatch from tolerated change

Each difference gets a small ledger row:

| Old behavior + evidence | New behavior + evidence | Consumer impact | Verdict | Decision/owner |
| --- | --- | --- | --- | --- |
| stable error code on denied write | new catch returns success | client cannot retry, false success | REGRESSION | fix new error path |
| pagination sort revised by approved spec | different order, versioned API | client must opt in | APPROVED_DELTA | migration owner |

Allowed verdicts: `PARITY_SUPPORTED` for the **checked axes and cases only**, `APPROVED_DELTA` for explicit authorized changes, `REGRESSION` for contradicted locked behavior, `UNKNOWN` when evidence is insufficient. Never collapse all axes into a global green verdict because one set of snapshots matches. Unexpected differences block removal of the old system until repaired or explicitly authorized.

## Close with a consumer proof

Map each significant behavior to at least one real consumer or independently meaningful contract test. Combine this parity review with the existing migration packet, measured zero-use rule, compatibility window and rollback test. If a live surface cannot be run, report `NOT_VERIFIED`. The chosen verification method does not create a new permanent test harness unless that harness protects an ongoing contract.
