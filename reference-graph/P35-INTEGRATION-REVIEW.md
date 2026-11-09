# P35: safe integration and independent review checklist

**State: REVIEW-ONLY / NO MERGE PERFORMED / NO DEPLOYMENT OR ACTIVATION AUTHORIZED.**

The P26 review branches #223 and #225 are independent, based on main at
313c5504aee23569d4ce3acab78cfffb9fa60e53. They touch different files from
the P27-P35 code stack. This is **only a changed-file overlap check**, not
security approval or proof that a later merge will be conflict-free.

## Dependency stack, checked 2026-11-07

- P26 side documents: #223 -> main, #225 -> main, independently.
- Standard/Deep: #226 P27 -> #227 P28 -> #228 P29 -> #229 P30 ->
  #230 P31 -> #231 P32 -> #232 P33 -> #233 P34 -> #234 P35.
- All eleven were open and unmerged. All eleven had zero independent
  GitHub review submissions. Every PR was marked mergeable, but that
  flag is not a security review or release authorization.

## Independent review gates

Each PR requires review by a different actual GitHub user on the current
HEAD, including test changes and migration/configuration access surfaces.
Author self-review or another casing of the author login is not independent.
A later COMMENTED review cannot dismiss CHANGES_REQUESTED. Two different
review dispositions for the same canonical reviewer at precisely the same
timestamp are ambiguous and must be rejected.

For #230 and #231, independently audit grants, RLS, anonymous Data API
exposure, SECURITY DEFINER function placement and search_path, source
integrity, UTC snapshot freshness and rollback. Disposable HTTP
PostgREST proof is not real Supabase gateway/TLS attestation.

**P35 PR #234 requires separate independent review**. Its own review
is not among the ten upstream PRs frozen in the P35 lock.

## Safe integration sequence (instructions, NOT an automated merge)

1. Independently review P26 #223/#225. Their paths are disjoint from
   the P27-P35 stack. Recheck current main, branch protection and CI
   before merging either; permission to merge must be explicit.
2. Review #226 against current main and integrate it only after
   independent review and operator approval. Its historical base SHA
   is not proof that its base is still current.
3. For each successor #227 -> #228 -> #229 -> #230 -> #231 -> #232 ->
   #233 -> #234, do NOT merge into the now-historical feature branch
   merely because GitHub marks it mergeable. Deliberately select a
   reviewed integration strategy (merge commit, rebase or cherry-pick)
   targeting the intended mainline.
4. Inspect updated merge bases, changed files and diffs relative to
   current main. Re-run required CI on exact integration HEAD. New
   commits, retargeting or rewritten ancestry may invalidate review
   evidence, even when GitHub still displays a green earlier job.
   Obtain a fresh independent review for changed code or new commits.
5. The frozen P35 lock MUST detect SHA/base drift after a restack or
   retarget. Do not remove its checks to permit integration. Prepare
   a new separately reviewed lock and evidence snapshot representing
   the new topology, while retaining previous pins as history.
6. Do not modify P35 to merge PRs automatically. Its exit code 2 and
   permanently false deployment_authorized are intentional.

## Production remains a distinct, separately approved operation

No code review, CI state or merge can authorize migration 014 or a
Standard/Deep cutover. The connected Supabase inventory currently shows
only Streamer Content, not the dedicated AgentHub Reference Graph
target. Never apply any Graph migration to Streamer Content.

Before any future authorized target deployment: verify the actual
AgentHub project identity and role, inspect migration history, audit
real Data API grants and RLS, review a rollback plan, obtain an
operator-side P31 source receipt and current-date independently pinned
P27/P34 baselines. Perform real full-population P30/P33/P34 parity,
latency/quality/error/fallback probes and a separate post-change
health acceptance gate.

Keep Standard/Deep legacy-only. Preserve the productive Quick P25 path
and its Windows collector.

**Decision: NO-GO for merging without independent review and operator
approval; NO-GO for any production migration or activation.**
