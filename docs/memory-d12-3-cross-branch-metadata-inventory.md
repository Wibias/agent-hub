# D12.3 Phase 10: cross-branch Memory metadata inventory (read-only)

This is a private LOCAL diagnostic, stacked on Draft #201. It is an index
for subsequent manual source/meaning review, NOT a semantic conflict checker
and NOT authorization to ignore/promote any proposal or Claim.

## What it inventories

For one exactly registered project, across ALL branches present in the local
database:
- Claims in states active, candidate, stale, conflicted.
- Legacy Memory candidates in pending, needs_confirmation, failed.
- Evidence-bound proposals in pending, needs_confirmation, failed.
- Source Evidence presence, authority, normal sensitivity and exact row scope.
- Branches are grouped under ephemeral slots (source, other-01, ...). No
  other branch name, original ID, content, source path or token is emitted.
- Each category shows a bounded list of opaque refs, e.g. ~c (Claim),
  ~m (legacy candidate) and ~p (Evidence-bound proposal). These are SHA-256
  digests truncated to 12 hex chars; they are local identifiers, not security
  credentials or a substitute for an authenticated approval.
- Category summary emits only totals and branch slot counts; categories
  claims, candidates, proposals enumerate only that type.

All three ledgers are scanned in one SQLite read transaction. If ANY ledger
exceeds 1000 scoped rows, the entire inventory blocks rather than silently
truncating. A missing mandatory ledger or unknown project also blocks.
The source branch need not have any records; branchesWithRows counts only
branches that actually have rows.

## Windows instructions

Use a NEW detached worktree from the existing Draft #201 worktree. Do not
reset the existing branches or merge:

    $Previous = "$HOME\agent-hub-D12-3-project-scope-audit"
    $Next = "$HOME\agent-hub-D12-3-cross-branch-inventory"
    if (-not (Test-Path $Previous)) { throw "Missing previous worktree" }
    if (Test-Path $Next) { throw "Destination exists; do not overwrite" }
    git -C $Previous fetch origin pull/202/head
    if ($LASTEXITCODE -ne 0) { throw "Fetch failed" }
    git -C $Previous worktree add --detach $Next FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw "Worktree creation failed" }

    $Db = if ($env:AGENT_HUB_MEMORY_DB) {
        $env:AGENT_HUB_MEMORY_DB
    } else {
        Join-Path $env:LOCALAPPDATA "agent-hub\memory.sqlite3"
    }
    if (-not (Test-Path $Db)) { throw "Missing local database" }
    $Cli = Join-Path $Next "scripts\inspect-memory-cross-branch-metadata.mjs"
    node $Cli --db-path $Db --project-id "github.com/Wibias/streamer-content" --source-branch main --category claims

Use --category summary for scoped counts, --category candidates for all
pending/needs_confirmation/failed legacy candidates, or --category proposals
for Evidence-bound proposals. The first useful action is reviewing the opaque
metadata of the two active Claims from the previous project-level audit.

## Security and interpretation

- Opens SQLite with readOnly:true, executes BEGIN then ROLLBACK and closes.
- Has NO apply flags, no writes, no LLM, no source text preview, no Claim
  promotion and no project-wide policy activation.
- Branch slots are local per-snapshot ordinal labels. They are not stable
  identifiers and do NOT reveal a trusted repository branch identity.
- Source presence and normal sensitivity are merely metadata, not proof
  that a Claim is true, current, safe, normative, or semantically unrelated.
- No source BODY digests, user consent authentication, semantic comparison,
  cross-branch relation judgment, or production GO can be inferred.
- Even if claims are absent, pending and failed candidates/proposals must
  still undergo separate human review before a project-wide policy.
- Different scope/branch and different source authority do not by themselves
  establish semantic conflict or lack of conflict.
- Every run is a read snapshot; concurrent writes may invalidate later
  planning, requiring re-audit immediately before any future authorized apply.

D12.3 remains NO-GO; every PR in this read-only chain stays Draft/unmerged.
