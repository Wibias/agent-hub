# Statechart upstream

Agent Hub vendors the statechart compiler runtime from `cursor/plugins` pstack.

## Current pin

- Upstream snapshot: `c742dd61706fbacc1b95f1a20b7b988cf096ce6c`
- Compiler port: `34b1b7c96f09f81a21a6c78f65b7833f7dcb5b24` (`#977`)
- Qualified-action trace fix: `740d2c0786246cafac41906198f656b135194d3b` (`#982`)
- Source runtime: `pstack/skills/statechart/scripts/`
- Source render reference: `pstack/skills/statechart/references/render.md`
- Refreshed: `2026-10-28`

## Sync contract

Production files under `scripts/` and `references/render.md` are byte-identical
to the pinned upstream snapshot. Agent Hub intentionally excludes the upstream
`scripts/test/` directory and its large corpus.

The compiler port replaced the previous MJS multi-command runtime with the
single TypeScript command `statechart SPEC.tla`. The removed `from-chart`,
`--against`, and `--fixed` surfaces are not preserved as downstream-only APIs.

`UPSTREAM.md`, `LICENSE`, the formal-verification integration references, local
evaluation cases, and Agent Hub tests are local assets and do not count as
vendor drift.

Refresh by comparing the pinned source tree, replacing shared runtime and render
reference files byte-for-byte, then rerunning
`skills/formal-verification/tests/statechart-runtime.test.mjs` and the catalog
tests.
