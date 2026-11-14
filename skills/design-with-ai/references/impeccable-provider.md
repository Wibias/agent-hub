# Impeccable source detector adapter (phase 2)

This adapter is **not** the separately invokable Impeccable skill and does not import its workflow instructions. `design-with-ai` remains the default UI workflow owner.

## Explicit pilot

```shell
node skills/design-with-ai/scripts/providers/scan.mjs --provider impeccable --path src --route /settings --project-root .
```

The command writes a normalized JSON report. Exit codes: `0` for a scoped detector `PASS`, `1` for `FINDINGS` needing review, `2` for `ERROR` / `BLOCKED` / `UNAVAILABLE`. These are **provider-only** statuses, not a DWA iteration receipt or product acceptance. Continue to run the canonical `taste-gate.mjs`, `taste-evidence-receipt.mjs`, ledger sync and `run-iteration-gate.mjs` before making completion claims.

## Execution and provenance

The default adapter executes `node skills/impeccable/scripts/detect.mjs --json --dwa-scan-proof <local-target>` and reads its JSON findings array. The opt-in `--dwa-scan-proof` emits a separate, versioned receipt on stderr; ordinary Impeccable CLI output is unchanged. This is the **vendored JS detector** from the Agent Hub skill distribution, not the separately published Rust engine. Agent Hub's `skills/impeccable/UPSTREAM.md` records the released skill 4.9.1 / engine 0.1.24 candidate at commit `acb4cfe14470b1fdf51e855431af618d936b7db8` and separately documents its verification gate. The vendored standalone engine is distinct from this adapter's JS detector. **Do not treat these as identical detector implementations or claim full engine parity.** A later upgrade needs an independently verified engine/provenance path.

This opt-in source scan uses only local files and directories. It rejects URLs, CDP and path escape. It never invokes `npx`, the vendored `scripts/impeccable` launcher, a binary auto-download, Impeccable `live`, or agent-spawning commands. The child uses the foundation process runner's `shell: false`, explicit environment allowlist, 120-second timeout and output cap. This timeout is a bounded allowance for large source trees, not a performance guarantee. The child is **not sandboxed**; run against trusted projects with a reviewed vendored detector. Project-local config can affect findings and must be treated as task data.

The CLI reports an array with `antipattern`, `name`, `severity`, `file`, `line`, `description`, `snippet`, and optional `advisory`. Primary findings normally give exit `2`; no primary findings gives `0`; any incomplete scan/operational failure (`1` or unexpected exit) is `ERROR`, never a pass. An advisory-only scan is `FINDINGS` evidence, not a quality pass. The provider preserves rule IDs, locations, advisory classification and source references. Upstream `error` maps to review priority `P1`, warnings/advisories to `P2`. **No external finding automatically becomes a DWA P0 or a historical ledger event.** Findings require project-aware adjudication and rendered checks.

## Scan coverage and configuration evidence

The scanner issues its receipt only after processing each eligible source file. It records candidate, eligible, ignored, degraded and fully scanned file counts, plus the elapsed time and whether inline suppressions and DESIGN.md interpretation were enabled. An HTML file that falls back to regex because the parser dependencies (`htmlparser2`, `css-select`, `css-tree`, `domutils`) are unavailable is **degraded**, not fully scanned. The DWA adapter rejects every degraded scan as `ERROR`, even if the fallback emitted no findings. The adapter rejects a missing, malformed, contradictory or empty receipt as `ERROR`, even if the detector emitted `[]`. A successful receipt is a **completed walker pass**, not a claim that static regex analysis can discover every visual defect or that rendered gameplay loaded. Linked CSS inspected from HTML may add work beyond the listed input-file count.

The normal CLI honors `impeccable-disable-line` directives. To isolate their effect in a diagnostic scan, use `--no-inline-ignores` while leaving other configuration and the design system enabled. `--no-config` disables both inline suppressions and DESIGN.md, so differences versus that mode must **not** be attributed solely to one source. Per-finding suppressions are not reconstructed or counted by the receipt; its mode flags are evidence of the policy in effect, not proof of every exception applied.

The 2026-11-06 Phase 6.2 case study showed a synthetic positive control (2/2), an empty negative control, 0 configured findings, and 1 raw `overused-font` finding in Streamer Content with an inline waiver. The independently enumerated 3,284 source-eligible files were **not** proof of actual detector coverage. The new receipt addresses that missing operational evidence without changing source rules. A single project does not establish detection sensitivity or false-positive rates across projects.

## Rollout limits

The detector's internal audit receipt remains opt-in; public routing, hook installation, ordinary Impeccable CLI output and the durable ledger schema are unchanged. The integrated `quality-audit.mjs` selects the bundled Impeccable detector by default for **standard** and **deep** profiles (unless `--no-impeccable` is supplied); **quick** remains native-only. Taste browser evidence can be included in standard/deep only with explicit `--with-taste` and the required local browser inputs. Provider selection and successful synthetic checks do **not** imply authenticated product acceptance; cross-provider deduplication and durable ledger migration remain separately gated.

The scanner source-extension and excluded-directory policy is mirrored in the adapter preflight, with a CI regression checking parity against the vendored helper module. A missing Impeccable install cannot make the `quick` native-only workflow module fail during import; the optional detector is loaded only when selected.
