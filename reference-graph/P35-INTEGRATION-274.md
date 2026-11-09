# P35 integration-head preflight for PR #274 (REVIEW-ONLY, NEVER AN AUTHORITY)

**Status (2026-11-09): Draft / NO-GO for merge and NO-GO for Graph
activation.** This document records the audit of the consolidated integration
candidate; it is not an approval, not a GitHub review and not a release
decision.

## What is pinned

| Item | Value |
| --- | --- |
| Integration PR | #274 (Draft, base `main`) |
| Reviewed head | `32e4a94718a7ab3ae55c81b653a63861d2bd2203` |
| Base | `main` at `3a0055651f98eda7e8cb242cf62ee1ecde427f15` |
| Changed files | 73 (all additions except one workflow edit) |
| Reviewed content pin | 72 files, `b02001ef904095f94d06497fee3c77f970bf517fc2ab6f49303a7dbb885333d7` |
| Documentation pin | `reference-graph/P39.md`, tracked separately |
| Historical P35 lock | `79dc0eec6ef2b416cfdc52e31d6e7e62514e78528515c8afdac1c389a149e691` |
| Required workflows | the same 13 governance workflows |

The 73 files are 26 tests, 3 SQL migrations, 8 CLI entrypoints, 13
`reference-graph` modules, 17 Markdown documents, 3 PowerShell operations
scripts, the P35 lock JSON, the P38 health-snapshot SQL and one workflow edit.

`reference-graph/P39.md` is deliberately outside the content pin. Its factual
corrections below must not change the reviewed runtime surface, and separating
it keeps the pin meaningful when documentation is corrected after the pin.

## Why the historical P35 lock cannot cover PR #274

`reference-graph/p35-pr-stack-lock.json` pins **ten** PRs at 2026-11-07
commits: the two independent P26 releases (#223/#225) and the P27-P34 stack
(#226-#233), with an explicit base-branch chain through
`feat/reference-graph-p33-pinned-transport-parity`.

That scope does not describe #274:

- #234 (P35 itself) is intentionally not in its own lock and still needs a
  separate review by a different person.
- #235-#237, #250, #263, #267, #269 and #270 are not covered at all.
- Its ancestry rules assert a linear stack of PR bases. #274 is a merge commit
  whose parents are `main` and #270; that shape cannot satisfy the lock.
- Its pins are historical SHAs. Reusing them for the integration head would
  present an old approval as a new one.

Running `p35-release-preflight.mjs` against #274 therefore cannot validate
#274, and its output must not be cited as approval of this head. The historical
lock remains a valid artifact **for its own scope only**. Its presence in the
integration diff does not extend that scope.

## The integration preflight

`reference-graph/p35-integration-preflight.mjs` with
`reference-graph/cli/p35-integration-274-preflight.mjs` verifies:

1. Lock schema, PR number, head/base SHA formats, 13 unique workflow names and
   19 superseded PR numbers.
2. The canonical manifest digest over the 72 content-pinned files, recomputed
   from committed blobs, so line-ending filters cannot produce a false match.
3. The historical P35 lock bytes, to prove that the old lock is unchanged and
   still has its historical scope.
4. Post-pin changes: the reviewed head must be an ancestor of `HEAD` and every
   later change must be in the explicit metadata-only allowlist. A shallow CI
   checkout cannot prove ancestry; the gate then reports
   `pin-history-unavailable` instead of assuming success.
5. Optional GitHub evidence for #274: all 13 workflows on the exact reviewed
   head, independent approvals on that exact commit, change requests and
   unresolved threads. A `COMMENTED` review never counts, and the author's own
   approval never counts.

It always reports `github_snapshot_independently_attested: false`,
`code_merge_authorized: false`, `deployment_authorized: false`,
`activation_authorized: false` and
`repository_default_graph_enabled: false`, and the CLI always exits 2. A
synthetic evidence file with a perfect independent approval is still not an
authorization; tests assert exactly that.

```powershell
node reference-graph/cli/p35-integration-274-preflight.mjs
node reference-graph/cli/p35-integration-274-preflight.mjs --evidence C:\audit\p274.json --sha256 <sha256> --as-of 2026-11-09T06:30:00.000Z
```

Exit 1 is malformed, stale or mismatched input; exit 2 is a valid analysis
whose release decision is still blocked. There is no success code.

## 73-file diff review

Scope reviewed by reading the diff, the migrations, the transports and the
existing P11 router.

**Security and credentials.** No credential, token or candidate row is added.
P30 keeps publishable and server modes separate: server mode requires a
`service_role`-shaped credential, never puts it in the URL, and the P33/P37
runners forward it without logging. The public freshness monitor reads only
`SUPABASE_PUBLISHABLE_KEY`. The webhook sink requires `https:` and sends only
aggregate alert fields. The added CI steps use the disposable local Postgres and
a local PostgREST container; the global workflow permission remains
`contents: read`.

**SQL and permissions.** Migration 014 creates the P31 projection with RLS
enabled, revokes broad access, then grants `SELECT` on the whole base table to
`anon`/`authenticated` and a current-UTC RLS policy. Migration 016, which is
already installed in the dedicated project and is **not reapplied here**,
revokes that table access from `public`, `anon`, `authenticated` and
`service_role`, then grants only `projection_version`, `snapshot_date` and
`refreshed_at` to the public roles. The full 19-column
`reference_graph_profile_candidates_server_p30_v1` view is
`security_barrier` + `security_invoker` and `service_role`-only; the public
view exposes the three freshness columns only. The refresh function stays
`SECURITY DEFINER` with a pinned `search_path`, and execute is revoked from
every role except `service_role`. Both views use `security_invoker`, which is
the least-privilege answer to the Supabase `security_definer_view` ERROR class;
no owner-rights view remains.

**P11 fallback.** No P11 file is part of this diff. The existing router derives
`graphMode` from `REFERENCE_GRAPH_QUICK_RUNTIME || "legacy"`, attempts Graph
only for `graphMode === "graph"` and `profile === "quick"`, and returns the
already-sanitised legacy selection whenever the transport throws, the payload
is invalid, or record/pattern order differs. Diagnostics are allowlisted and
cannot affect the response. That behaviour is unchanged by #274.

**Default-off.** The diff contains no routing switch. `repository_default_graph_enabled`
and `activation_performed` are false constants in every added report and
transport. `P38` refresh runs as an internal SQL function and does not touch
P10/P11.

**Findings corrected in this change.**

- `P39.md` claimed the local `AgentHub Reference Graph P38 Monitor` task was
  not registered or activated. Observed on 2026-11-09: the task is registered,
  enabled and running every five minutes (last result 0) on the public freshness
  probe only. The text now states that, and states that this PR neither created
  nor modified it.
- `P39.md` described the soak as two successful two-hour cycles. The
  operator-reported read-only `cron.job_run_details` check on 2026-11-09
  05:45 UTC recorded 30/30 successful invocations and 15 consecutive healthy
  two-hour windows. That observation is attributed and explicitly not
  independently attested here.

**Residual risks, not corrected.**

- After 016, P30 publishable mode fails closed because the base table is no
  longer publicly readable. Any client still on publishable mode must move to
  server mode before the migration is treated as complete. This is documented,
  not enforced by a test against production.
- The P30 server path necessarily holds a privileged credential. The guard is
  process isolation and the explicit view filter, not RLS containment for
  `service_role` (which has `BYPASSRLS` in Supabase). Direct service-role base
  reads can see historical rows by design.
- Migration 016 is only exercised against disposable Postgres in CI. Its live
  grant state is a separate read-only verification step, not a code-review
  result.

## Code merge versus activation

These are separate decisions with different evidence.

A **default-off code merge** needs an independent human code review on the
exact head, CI on that head and a deliberate merge authorization. It does not
need P35's release preflight, and P35 explicitly must not be wired into an
automated merge. A merge also does not need the P31/P33/P34/P37 provenance
audit, because those artifacts justify activating the Graph path, not compiling
it into the repository.

A **Graph activation** additionally needs the versioned default-off authority,
the independent source/projection evidence, a soak and monitoring receipt, a
rollback rehearsal and explicit operator authorization. P35's historical lock,
this preflight and any CI run are all insufficient on their own.

## Current decisions

**Code merge: NO-GO.** The technical pin and CI pass, but #274 has zero
submitted GitHub reviews. Merging would rely on a self-assessment, and the
repository's P35 design requires independent review by a different person. P26
#223/#225 content is included byte-for-byte, but copying it into #250 never
created an independent review. P35 #234 remains unrelated to this head.

**Graph activation: NO-GO.** P35 approval is absent; the P31 original receipt
is lost; P33/P34/P37 provenance has no independent human attestation; and the
default-off authority for this head does not exist.

## Next actions

1. Obtain an independent human review of #274 on `32e4a947` (or on a later
   head with a re-pinned manifest) by a reviewer who is not the author.
2. Decide the P35 governance question explicitly for the consolidated head:
   either a new, reviewed integration lock becomes the release artifact, or the
   policy states that a default-off code merge is exempt from P35. Do not
   relabel the historical lock.
3. Record the P26 review separately; content copying is not review.
4. Keep the provenance audit's BLOCKED items open until an independent party
   confirms the pins; do not regenerate the lost P31 original receipt.
5. Re-run the preflight after any new commit and update the pin, the manifest
   and the PR body in one step.
