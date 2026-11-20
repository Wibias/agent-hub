# Statechart upstream

Agent Hub vendors the statechart compiler runtime from `cursor/plugins` pstack.

## Current pin

- Upstream runtime snapshot: `aaeb0ea3a0584995aa8f55ce44c6c5259414b896`
- Previous pinned runtime: `93b916d4a1e806507e22f4716b352fa91f2b227e` (before that: `c742dd61706fbacc1b95f1a20b7b988cf096ce6c`)
- Compiler port: `34b1b7c96f09f81a21a6c78f65b7833f7dcb5b24` (`#977`)
- Qualified-action trace fix: `740d2c0786246cafac41906198f656b135194d3b` (`#982`)
- Source runtime: `pstack/skills/statechart/scripts/`
- Source render reference: `pstack/skills/statechart/references/render.md`
- Refreshed: `2026-11-20`

## November 2026 scoped refresh

Compared all 29 existing vendored runtime paths against the upstream snapshot.
Only `scripts/run.ts` and `scripts/backends/mermaid.ts` changed; these two
files are copied byte-for-byte. `run.ts` extracts SANY parsing diagnostics
when XML export fails. Mermaid rendering routes transitions into a nested
composite through its parent while preserving the individual child choices.

The upstream repository also changed unrelated pstack workflows. The broad
`pstack` review checkpoint in `upstream-sources.json` remains independent;
this runtime refresh does not claim those unrelated changes were reviewed or
adopted. Execution, renderer, and integration CI evidence is required before
this refreshed runtime is considered qualified.

## November 20 targeted process-lifecycle refresh

Compared `93b916d4a1e806507e22f4716b352fa91f2b227e` with `aaeb0ea3a0584995aa8f55ce44c6c5259414b896` within
`pstack/skills/statechart/scripts/`, excluding upstream `scripts/test/`.
Updated the three existing files `run.ts`, `frontends/dot.ts`,
`statechart.ts`, and added `kill.ts` and `janitor.ts`, copied
byte-for-byte from `aaeb0ea3a0584995aa8f55ce44c6c5259414b896`. The existing render reference did not change.

The new entrypoint runs a detached worker and janitor, sends an explicit
completion message to the janitor, and cleans up the worker process group.
The cleanup behavior differs on Windows and POSIX. The DOT frontend also
normalizes line boundaries. These are runtime-behavior changes, not just
documentation changes.

**Qualification:** Byte parity and structural tests alone do not establish
correct TLC execution, interruption handling or child-process cleanup on each
OS. Verify successful, failing and interrupted checks with real child
processes before declaring the runtime qualified for production use.

The wider `pstack/` changes since the registry's
`reviewedCommit` are **not** accepted or reviewed by this runtime
refresh. The broad `upstream-sources.json` checkpoint is unchanged;
only its separate `localPin` reflects the vendored runtime snapshot.

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
