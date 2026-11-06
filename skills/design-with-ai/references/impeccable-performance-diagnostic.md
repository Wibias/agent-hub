# Impeccable source-scan performance diagnostic

This read-only diagnostic compares **four** fixed modes of Agent Hub's **vendored JS** Impeccable static detector. It does not install tools, call a remote URL, edit source, run a browser, or issue a Design-With-AI completion verdict.

## Usage

From the trusted `agent-hub` checkout, with Node.js 22+:

```sh
node skills/design-with-ai/scripts/providers/impeccable-performance-diagnostic.mjs --target /absolute/path/to/source/src --project-root /absolute/path/to/source > impeccable-performance.json
```

Specify `--rounds 2` to run the four modes twice with the second pass in reverse order, making large cold-cache effects easier to spot. Values must be 1, 2 or 3. The tool prints a single JSON report and exits with 0 on complete scans, 1 on an incomplete comparison, and 2 on invalid invocation. Do not redirect output into the scanned source subtree.

| Mode | Relevant behavior |
| --- | --- |
| `configured` | Honors project filters, inline suppressions, and design-system context |
| `no-inline-ignores` | Keeps project filters and DESIGN.md, disables only inline suppressions |
| `no-design-system` | Keeps project filters and inline suppressions, disables only DESIGN.md analysis |
| `no-config` | Disables project filters, inline suppressions **and** design-system context |

This separation matters because `--no-config` alone cannot identify the cause of a configured-vs-raw duration difference.

Each scan is a fresh local Node process with fixed arguments, bounded execution (120 seconds per mode) and a bounded output buffer. Output contains **counts grouped by rule**, durations and explicit completion status; no source snippets, file contents or detector stdout are copied into the summary.

## Reading the results

- An empty findings array is not proof of design quality.
- Compare the per-mode durations **within and across rounds**, not just one pair. OS file-cache warming, JIT compilation, build activity and file system scanning can affect wall time.
- A mode that fails or times out makes the whole comparison `INCOMPLETE`. Do not compare successful rows to a failed row as if it were a valid benchmark.
- This diagnostic measures the vendored detector, not the DWA provider itself. Its output is **not** a provider PASS or a measured count of scanned files. The separate optional proof mechanism introduced in PR #195 addresses completed-file reporting.
- Compare results from the same immutable source snapshot. Do not compare unrelated commits or live branches.

## Phase 6.2 rationale

On the independent Windows read-only snapshot of `Wibias/streamer-content`, the configured Impeccable run took about 54.9 seconds while `--no-config` took about 2.2 seconds. The probe also found an explicit inline waiver explaining a single `overused-font` finding. The **cause of the time difference is not yet established**. This tool captures the missing controlled comparisons without modifying Streamer Content.
