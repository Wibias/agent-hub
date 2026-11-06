# D12.3 Phase 7: local, read-only Evidence/Claim review

This is an opt-in local inspection, stacked on independent inventory Draft PR #193.
It does not depend on or activate the write-capable Draft stack #187-#192.

## Security boundary

- Opens actual SQLite DB with DatabaseSync in read-only mode and uses a read transaction.
- Requires exact project, branch, and an opaque proposal reference from the inventory.
- Resolves only pending, needs_confirmation or failed proposals within the specified scope.
- No exact match or an opaque-ref collision fails closed.
- Default JSON contains metadata only. No proposal fact, Evidence text,
  Claim text, internal IDs, paths, sessions, timestamps or source refs.
- Only --show-local-content in an interactive terminal reveals the selected
  proposal fact, redacted source Evidence, and matching scoped Claim text.
- Text previews are bounded (Evidence 4000 characters, each Claim field
  1000) and mark truncation explicitly.
- Missing, cross-scope or non-normal linked Evidence suppresses ALL original
  content, even in explicit local mode. Claim text is suppressed unless its
  own source Evidence is normal and in scope.
- Source authority classification is not proof of host-authenticated consent.
- Comparison Claims include active, candidate, stale and conflicted states
  for the exact branch. This is NOT a semantic conflict detector. A stored
  unrelated relation is not a conflict clearance.
- No model, no apply, no decision, no Claim creation and no source writes.

## How to run on Windows

First obtain a current opaque reference with PR #193's inventory.
Create a separate detached worktree from the existing read-only audit
worktree (do not reset the existing branch or merge anything).

    $Audit = "$HOME\agent-hub-D12-3-proposal-audit"
    $Review = "$HOME\agent-hub-D12-3-evidence-review"
    if (-not (Test-Path $Audit)) { throw "Audit worktree missing" }
    if (Test-Path $Review) { throw "Review worktree already exists" }
    git -C $Audit fetch origin pull/194/head
    if ($LASTEXITCODE -ne 0) { throw "Fetch failed" }
    git -C $Audit worktree add --detach $Review FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw "Review worktree creation failed" }

Then select a single currently open proposal with its opaque ref:

    $Db = if ($env:AGENT_HUB_MEMORY_DB) { $env:AGENT_HUB_MEMORY_DB } else { Join-Path $env:LOCALAPPDATA "agent-hub\memory.sqlite3" }
    if (-not (Test-Path $Db)) { throw "Memory database missing" }
    node "$Review\scripts\inspect-memory-proposal-evidence.mjs" --db-path $Db --project-id github.com/Wibias/streamer-content --branch main --proposal-ref "~p72cc39ed74bf"

For your own terminal only, add:

    --show-local-content

The CLI refuses content output if stdout is not an interactive TTY.
Do not copy, redirect, log or paste its text into shared chats, GitHub or CI.
Even redacted Evidence may contain private information. Terminal transcripts
or screen recordings might still capture it.

For each proposal, review factual meaning, source authority, user approval,
project/branch scope, duration, current Claims, duplicates and conflicts.
Record only a sanitized rationale via a separate, explicitly approved process.

Do not mass-promote, ignore, re-evaluate closed records or write decisions
using this script.

## Release boundary

No merges, live confirmations, production schema migrations, canonical
Claims, or production data writes are authorized by this diagnostic.
The project-vs-branch and canonical atomic provenance blockers remain open.
