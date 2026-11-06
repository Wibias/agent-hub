# D12.3 Phase 12: read-only single Evidence-bound proposal across branches

This diagnostic is stacked on Draft PR #203. It lets the operator inspect
one open Evidence-bound proposal from ANY recorded branch of one exact
registered project, without knowing or revealing that branch's name.

This phase is **not** a project policy implementation, an approval mechanism,
or a semantic conflict clearance.

## Trust boundary

- One SQLite read-only connection and a BEGIN / ROLLBACK snapshot.
- Select one exact opaque ~p ref from ALL open project proposals (pending,
  needs_confirmation, failed). Hash collisions, missing project/table,
  closed refs, >10000 open rows and >50 linked Evidence rows block.
- Linked Evidence must exist and match the selected proposal's exact
  project and branch with normal sensitivity. If ANY source fails, the
  entire content preview is suppressed. Source authority and source kind
  are classified only, not authenticated.
- Default reports contain metadata only, no claim/proposal contents, original
  IDs, other branch names, DB paths, timestamps, session IDs or source paths.
- Only --show-local-content in an interactive terminal allows selected
  canonical_fact (max 1000 chars) and redacted linked Evidence excerpts
  (max 4000 chars each). Content SQL is executed ONLY after source metadata
  checks pass and local content is opted in. Truncation is explicitly marked.
- User_direct is a *declared* authority classification. It does NOT prove
  authenticated host-origin approval of a persistent project-wide rule.
- A redacted Evidence excerpt may still contain private information.
  Review locally before sharing; do not pipe, redirect, publish or commit.
- No model, write, apply, promotion, rejection, semantic conflict check,
  Evidence body hash authentication, or project-wide policy propagation.
- A successful selection means manual meaning review is required; it is
  NOT approval. There is no automatic recommendation.

## Windows operator workflow

Use a NEW detached worktree from the existing #203 checkout. Do not
merge, reset or mutate prior worktrees.

    $Previous = "$HOME\agent-hub-D12-3-claim-review"
    $Next = "$HOME\agent-hub-D12-3-proposal-cross-branch"
    if (-not (Test-Path $Previous)) { throw "Previous worktree missing" }
    if (Test-Path $Next) { throw "Destination already exists" }
    git -C $Previous fetch origin pull/204/head
    if ($LASTEXITCODE -ne 0) { throw "Fetch failed" }
    git -C $Previous worktree add --detach $Next FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw "Worktree failed" }

    $Db = if ($env:AGENT_HUB_MEMORY_DB) {
        $env:AGENT_HUB_MEMORY_DB
    } else {
        Join-Path $env:LOCALAPPDATA "agent-hub\memory.sqlite3"
    }
    if (-not (Test-Path $Db)) { throw "Local memory DB missing" }
    $Cli = Join-Path $Next "scripts\inspect-memory-cross-branch-proposal-evidence.mjs"
    node $Cli --db-path $Db --project-id "github.com/Wibias/streamer-content" --source-branch main --proposal-ref "~pdc4cbb9fe6a4"

Append --show-local-content for manual interactive inspection. Run one
ref at a time, verify the output has normal sensitivity, and inspect it
for secrets before sending into chat. Start with user_direct-classified
proposals from the previously inventoried other-02 group.

## Release boundary

This tool never writes to the Memory DB; all proposals retain their local
statuses. Source body integrity, authenticated consent, project-wide
Claim ownership, semantic cross-branch review, and full release checks
remain incomplete. D12.3 production remains NO-GO.
