# Impeccable source detector adapter (phase 2)

This adapter is **not** the separately invokable Impeccable skill and does not import its workflow instructions. `design-with-ai` remains the default UI workflow owner.

## Explicit pilot

```shell
node skills/design-with-ai/scripts/providers/scan.mjs --provider impeccable --path src --route /settings --project-root .
```

The command writes a normalized JSON report. Exit codes: `0` for a scoped detector `PASS`, `1` for `FINDINGS` needing review, `2` for `ERROR` / `BLOCKED` / `UNAVAILABLE`. These are **provider-only** statuses, not a DWA iteration receipt or product acceptance. Continue to run the canonical `taste-gate.mjs`, `taste-evidence-receipt.mjs`, ledger sync and `run-iteration-gate.mjs` before making completion claims.

## Execution and provenance

The default adapter executes `node skills/impeccable/scripts/detect.mjs --json <local-target>` and reads its JSON findings array. This is the **vendored JS detector** from the Agent Hub skill distribution, not the separately published Rust engine. Agent Hub's `skills/impeccable/UPSTREAM.md` pins upstream skill 4.8.0 at commit `9fadc41729c38fd47d7ae622b501558653f9d2e9` and documents later partial patch adoption. The released binary engine is separately pinned to 0.1.18. **Do not treat these as identical detector implementations or claim full engine parity.** A later upgrade needs an independently verified engine/provenance path.

This opt-in source scan uses only local files and directories. It rejects URLs, CDP and path escape. It never invokes `npx`, the vendored `scripts/impeccable` launcher, a binary auto-download, Impeccable `live`, or agent-spawning commands. The child uses the foundation process runner's `shell: false`, explicit environment allowlist, timeout and output cap. The child is **not sandboxed**; run against trusted projects with a reviewed vendored detector. Project-local config can affect findings and must be treated as task data.

The CLI reports an array with `antipattern`, `name`, `severity`, `file`, `line`, `description`, `snippet`, and optional `advisory`. Primary findings normally give exit `2`; no primary findings gives `0`; any incomplete scan/operational failure (`1` or unexpected exit) is `ERROR`, never a pass. An advisory-only scan is `FINDINGS` evidence, not a quality pass. The provider preserves rule IDs, locations, advisory classification and source references. Upstream `error` maps to review priority `P1`, warnings/advisories to `P2`. **No external finding automatically becomes a DWA P0 or a historical ledger event.** Findings require project-aware adjudication and rendered checks.

## Rollout limits

This phase does not change public routing, hook installation, `skills/impeccable` files, or durable ledger schema. The adapter is enabled only when selected through `scan.mjs` or the internal registry. Integration with normal DWA workflows, browser evidence, cross-provider deduplication, and ledger migration remain separate, test-gated PRs.
