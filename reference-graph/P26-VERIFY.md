# P26 frozen P25 evidence verification (offline, read-only)

## Purpose

The P25 production collector stays on pinned implementation SHA
`8bd9eeec1ab84ca816bb6238702d88ebba9cf0c9`.
Its P26 archival script produced a private folder containing `manifest.json`,
`p25-samples.jsonl`, `p19-attestation.json` and
`p19-frozen-evaluation.json`; optionally
`p25-earlier-evaluation.json`.

The P26 verifier independently checks the *actual archived bytes* against
the operator-supplied manifest SHA-256, verifies all per-file SHA-256 hashes,
requires P25 diagnostic event coverage, and re-runs the official P19
`evaluateP19PromotionReadiness` on the copied files. It prints only
aggregate status and never writes to the archive, network, local activation
state, scheduler, or Supabase.

## Operator command (after this implementation is reviewed and merged)

Run from an isolated checkout of the **approved P26 verifier commit**, not
from the live P25 checkout. Use the digest obtained independently from the
2026-11-07 freeze output:

```powershell
$Root = Join-Path $env:LOCALAPPDATA 'agent-hub\reference-graph'
$Archive = Join-Path $Root 'archive\p25-passed-freeze-20261107T052258Z-fa686176'
$ExpectedManifest = 'dd1dc64f3eb064b9a3bbc9be99a04013a3395887a4fd542f899d5a5f9f37ca3e'

# Run this from the separately pinned, reviewed P26 verifier checkout:
node reference-graph/cli/p26-verify-frozen-evidence.mjs $Archive $ExpectedManifest
if ($LASTEXITCODE -ne 0) { throw 'P26 archive verification failed' }
```

Before executing, record the P26 verifier checkout HEAD and confirm that
it equals the separately reviewed merge SHA. Do not move the P25 collector
checkout or rewrite the frozen archive.

## Required evidence and limits

- The manifest digest supplied at the CLI must be independently known. A
  digest read from the same untrusted archive does not establish trust.
- Archived file names are allowlisted and fixed; manifest entries cannot
  select arbitrary paths.
- All P25 samples must have nonempty P25 diagnostic events and a canonical
  Node process start timestamp.
- Every sample must be healthy, Quick must be `reference-graph` with exact
  record/pattern parity, and Standard/Deep must stay `legacy-control`.
- The frozen official P19 receipt must match a freshly computed evaluation,
  including duration, gaps, attestation and all blockers.
- Summary values stored in the manifest must match that new evaluation.
- Success means the **frozen P25 Quick soak evidence is internally verified**.
  It does not prove real-user relevance improvement, authorize default-on
  routing, re-attest the P16 private ledger online, or certify that the
  Windows Task Scheduler will never miss a future trigger.

No repository-default promotion or P16 grant consumption is implemented
by this verifier. A separate default-off control plane, rollback procedure,
post-change health gate, independent review and explicit future approval
remain necessary.
