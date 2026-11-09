# P31/P33/P34/P37 evidence and provenance audit (2026-11-09)

**Status: BLOCKED.** This audit records what is reproducible from the local
freeze, what is only operator-reported, and what cannot be established at all.
It creates no attestation, no approval and no activation authority.

## What was checked

The local freeze at
`.cache/p39-final/freeze-2026-11-08/` (outside Git, read-only) was hashed on
2026-11-09 and compared with `manifest.json` and with the numbers recorded in
[the 2026-11-09 reconciliation receipt](https://github.com/Wibias/agent-hub/issues/244#issuecomment-6733447662).
Every artifact hash matches the manifest, and the manifest hash matches the
recorded value:

| Artifact | SHA-256 | Bytes |
| --- | --- | --- |
| `manifest.json` | `3de3ad39a76b75bb2b6c602f57f32f50268c2f1fb4e013732b24ab5d400211c8` | 13123 |
| `templates.json` | `cc7ac1abd1183bb9c63e167a4fe9f11e477add5f02111df0851fa737e347a6d7` | 5588 |
| `records.json` | `d5469d1fc72a073aa2aa39037f690cbf8861e202dbd42ccb0b15ddb762dc7840` | 1495765 |
| `patterns.json` | `c71c3eb5c8d5c5df7ef38d14fa36d397386fbaeba8236a38df22f45cb5c41b98` | 26334 |
| `p27-baseline.json` | `c15e3c14af946a3ea1d469b0372a83eac44cdeb95973fba7edc03be318cce868` | 17951 |
| `p34-public-baseline.json` | `3d292752515073e12c77742c31c71571fed1bcb782bd1b89382cc249d83bd3f2` | 8937 |
| `source-receipt.json` | `1cc3ffa9bc9a80199969c9f07fba3ce506b203449a3ac3e4f19f628001535abe` | 655 |
| `runs/p33-report.json` | `1481b2f476355c973858650bfc10d333d0a41714bc0d87fe1146bc25ebd696d8` | 719 |
| `runs/p37-report.json` | `93bebaebf8f75e09987e387ced2671de8b8497ac16c91150289c963ea22d0bef` | 1672 |

The freeze is derived from legacy source commit
`9d31825542a1aa9531f4bd1da2ac041681f43a77` and tested code commit
`0fb1e28267f5ae7e4e99bcd7d864e2e8d93d8f04`. The manifest states that the
legacy source artifacts are unchanged between those two commits, and it records
each source file's Git blob SHA-1 and content SHA-256.

## What the reports say

- **P33** (`reference-graph.p33-pinned-profile-parity.v2`): 275 candidates,
  ID-set `b3037425ff08c7822f695ce28c6e5fb1dbd3e245255ab33a614e96995cf2a6a2`,
  content `d6925ab05c570a4e160bacf68ab0c4c593c7771c2d5e6531a07b16961f049193`,
  48 evaluated cases, 48 exact-order, 0 mismatches, pattern and live-graph
  parity still false.
- **P37** (`reference-graph.p37-single-snapshot-public-audit.v1`): one HTTP
  request, P33 pin matched, P34 48/48 records, 48/48 patterns, 48/48 complete
  public outputs, 0 mismatches, live-graph parity and deployment false.

The P37 report embedded the P33 report and marked `p33_report_pin_matched:
true`. That proves the two files were bound by the hash the runner was given.
It does not prove that a human independently reviewed that hash before it was
entered; the runbook asks for that, but the archive cannot show it happened.

## P31 source receipt: permanently lost original

The original return value of the privileged P31 refresh was **not archived**.
The stored `source-receipt.json` is a read-only reconstruction from
`reference_graph_quick_candidate_pool_p7` and
`reference_graph_profile_runtime_projection_p30_v1`; its provenance file says
`original_refresh_receipt_bytes: false`. It must never be described as the
original receipt.

The reconstruction is bound to snapshot 2026-11-08 and refresh instant
`2026-11-08T02:05:00.179Z`. It records 275 expected and 275 published
candidates with the same ID-set hash on both sides.

## The 2026-11-09 read-only P7-vs-P31 cross-check

At 2026-11-09 06:01:09 UTC a separate read-only query on the dedicated project
compared the P7 candidate source with the P31 projection for the current UTC
date: 275/275 rows, identical legacy-ID-set hash, zero missing or extra IDs and
zero metadata-field mismatches, with a single refresh instant of
`2026-11-09T06:00:00.301897Z`. The same receipt records a Security Advisor
check at 06:02 UTC with 0 ERROR and 0 WARN.

**Limitation that matters:** that observation is for a *later* snapshot than
the one P33 consumed. The P33/P37 run used the 2026-11-08 02:05Z receipt and
its 2026-11-08 snapshot. A cross-check performed on a 2026-11-09 06:00Z
snapshot cannot retroactively authenticate the 2026-11-08 input. It corroborates
that the source and projection agree structurally on a later refresh, and it
shows the P38 refresh is producing consistent snapshots. It does not repair the
lost original receipt, and any statement that the 11-08 P33 run had a
source-side receipt remains unsupported.

## Attestation status

Everything above is reproducible locally or is an attributed operator
observation. None of it carries an independent human signature, an external
archive receipt, or a GitHub review. Specifically:

- No independent party has confirmed the freeze manifest.
- No independent party has confirmed the P33 or P37 report hashes.
- No independent party has confirmed the P34 legacy public baseline.
- The P31 original receipt does not exist in any form.
- P35 approval is absent.

## What would be needed to unblock

1. An independent party re-hashes the freeze directory on a separate machine
   and records the manifest hash through a channel the operator does not
   control.
2. An independent party confirms the P33 and P37 report hashes before either is
   used as an input pin.
3. The P34 baseline is regenerated or confirmed from a separately pinned
   legacy-control checkout, with its own provenance record.
4. The production refresh function is left as is; if a future receipt is
   needed, capture the next refresh return value through an approved
   read-only path. Do not call the production refresh function to manufacture
   one.

Until those exist, P31/P33/P34/P37 evidence is **BLOCKED for activation**, and
for a default-off code merge it is disclosure-only.
