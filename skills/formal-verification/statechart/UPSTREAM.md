# Statechart upstream

Agent Hub vendors the statechart runtime from `cursor/plugins` pstack.

## Current pin

- Upstream commit: `076f4b2f57844ff9eb4ada914d4763884d40146e`
- Source: `pstack/skills/statechart/scripts/`
- Refreshed: `2026-10-24`

## Sync contract

Files under `scripts/` are byte-identical to the pinned upstream
`pstack/skills/statechart/scripts/` files. Agent Hub intentionally excludes
the upstream `test/` directory and its large test corpus.

`UPSTREAM.md`, `LICENSE`, the formal-verification integration reference, local
evaluation cases, and Agent Hub tests are local assets and do not count as
vendor drift.

Refresh by comparing the pinned source tree, replacing shared runtime files
byte-for-byte, then rerunning
`skills/formal-verification/tests/statechart-runtime.test.mjs` and the catalog
tests.
