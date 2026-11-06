# Impeccable design-root lookup memoization

## Evidence from Phase 6.2

A read-only two-round Windows benchmark of the same 3,284-source-file Streamer Content snapshot showed:

| Mode | Mean (2 runs) | Findings |
| --- | ---: | ---: |
| Configured | 6.450 s | 0 |
| Inline ignores disabled, design system still enabled | 6.336 s | 1 (`overused-font`) |
| Design system disabled, inline ignores still enabled | 1.601 s | 0 |
| All config disabled | 1.595 s | 1 (`overused-font`) |

The before/after source SHA-256 fingerprints matched. This suggests that *the design-system path* accounts for most of the observed overhead; the source scan's per-file root resolution is a concrete optimization candidate. It does **not** establish that root resolution is the entire cause. The previously recorded ~54.9 s configured scan was not reproduced in these two rounds.

## Implementation

The vendored Impeccable source scanner already cached a parsed `DESIGN.md` by resolved root, but still executed `findDesignRoot()` separately for every source file and walked upward through repeated filesystem probes. The new optional `resolve:<directory>` entries in the same **per-scanner-invocation** cache memoize resolved root/boundary results for the directories visited.

Existing `root:<directory>` values continue to hold the parsed design contract. The change does **not** turn off DESIGN.md rules, inline exemptions, project marker boundaries, or fallback design locations. Uncached direct `findDesignRoot()` calls retain their prior behavior. Tests assert that repeated files in one directory make no additional `existsSync` root probes, while nested DESIGN.md and a nested `package.json` project boundary stay isolated.

## Verification limits

The cache assumes that filesystem project markers and DESIGN.md locations remain stable **during one CLI source scan**. It is not a persistent cache and must not be shared across independent scans. DWA's snapshot validation remains the guard against ordinary source changes during a run. This optimization does not prove full detector sensitivity, rendered coverage, correct gameplay state or acceptance.

After CI, re-run the same Windows four-mode benchmark on an isolated snapshot with a detector version containing this patch. Compare per-mode distributions, exact source fingerprints, and finding counts; do not claim a runtime gain from a mock test or from this document alone.
