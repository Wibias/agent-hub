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

## Validated PR #200 before/after benchmark (2026-11-06)

A separate Windows comparison used two rounds with alternating order, the
same frozen 3,284-file snapshot and the unchanged CLI arguments. It verified
the canonical baseline module from Agent Hub `3e0f5ffed8a8966e19370424bfeb66d0b8da2090`
(Git blob `5c9a949e6f07d95255c564c8a73780a956708f22`) and the
memoized module from PR #200 head `b8d5fc51b0a388c61188c3a9d6d8d771908ef5f8`
(Git blob `ac77f947828651d0c043ca918a12374ba8fe36ac`).
The original Windows checkout required only `CRLF_TO_LF` normalization
before canonical Git-blob comparison.

| Mode | Baseline (rounds 1, 2) | Memoized (rounds 1, 2) | Baseline mean | Memoized mean | Wall-time reduction |
| --- | ---: | ---: | ---: | ---: | ---: |
| Configured | 6.879 s, 6.217 s | 2.307 s, 2.055 s | 6.548 s | 2.181 s | **66.7%** |
| No inline ignores | 5.775 s, 6.000 s | 1.972 s, 1.978 s | 5.888 s | 1.975 s | **66.5%** |
| No design system | 1.543 s, 1.546 s | 1.625 s, 1.688 s | 1.545 s | 1.657 s | **7.3% longer** |
| No config | 1.635 s, 1.723 s | 1.662 s, 1.584 s | 1.679 s | 1.623 s | **3.3% lower** |

**Result:** `COMPLETE_EQUIVALENT`. All 8 paired comparisons had byte-equal
stdout and stderr SHA-256, identical exit codes, finding counts and rule
distribution. Both configured scans reported 0 findings; the no-inline
and no-config scans reported the same one `overused-font` finding in
both versions. The before/after source fingerprint matched:
`2ad18501ad3d836022b258f05b7061fc677e5725e658e0e3f16ef0b7357d93ad`.

**Interpretation:** The optimization has a measured ~3.00× throughput
advantage (66.7% less elapsed time) on this particular configured
source scan. The `--no-design-system` control confirms that the gain
is concentrated in the DESIGN.md resolution path. It does not establish
an across-project speedup, a full detector-coverage count, runtime-state
readiness or design-quality accuracy. There are only two rounds per mode;
file caches and process scheduling can affect wall-clock results.
An earlier ~54.9 s configured run was not reproduced.

## Implementation

The vendored Impeccable source scanner already cached a parsed `DESIGN.md` by resolved root, but still executed `findDesignRoot()` separately for every source file and walked upward through repeated filesystem probes. The new optional `resolve:<directory>` entries in the same **per-scanner-invocation** cache memoize resolved root/boundary results for the directories visited.

Existing `root:<directory>` values continue to hold the parsed design contract. The change does **not** turn off DESIGN.md rules, inline exemptions, project marker boundaries, or fallback design locations. Uncached direct `findDesignRoot()` calls retain their prior behavior. Tests assert that repeated files in one directory make no additional `existsSync` root probes, while nested DESIGN.md and a nested `package.json` project boundary stay isolated.

## Verification limits

The cache assumes that filesystem project markers and DESIGN.md locations remain stable **during one CLI source scan**. It is not a persistent cache and must not be shared across independent scans. DWA's snapshot validation remains the guard against ordinary source changes during a run. This optimization does not prove full detector sensitivity, rendered coverage, correct gameplay state or acceptance.

The above Windows comparison is now complete and matches the pinned PR #200 source hashes. Do not extrapolate this one project's observed speedup to other repositories or release a production claim before independent review and integration validation.
