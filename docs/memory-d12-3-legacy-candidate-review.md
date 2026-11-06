# D12.3 Phase 14: bounded read-only legacy Candidate Evidence review

This Draft PR is stacked on the all-project proposal reconciliation Draft #209.
It does not merge, modify the local SQLite DB, make any memory decision,
authenticate consent, or implement project-wide policy inheritance.

## Context
The current user-provided metadata inventory for
github.com/Wibias/streamer-content contains **67** pending legacy Candidates,
not 62. They are on 13 of the 14 project branch slots and are classified
user_direct. All 67 source rows are structurally present, have normal
sensitivity, agree with the declared authority, and match the project/branch.
This is NOT an authenticated user-origin guarantee; the discrepancy of five
cannot be resolved from these metadata alone.

## Safety
- Use a locally opened DB with readOnly:true inside BEGIN/ROLLBACK.
- Resolve only selected opaque ~m refs among ALL pending/needs_confirmation/
  failed Candidates in exactly the specified registered project.
- Require 1 to 8 distinct refs, fail closed on stale/missing refs,
  collision, linked Evidence mismatch, authority disagreement and unsafe
  sensitivity.
- Default output is metadata ONLY. Opt-in candidate proposed_value and
  evidence.content_redacted excerpts require --show-local-content AND
  an interactive stdout TTY.
- Truncation is explicit (1000 proposed-value chars, 3000 Evidence chars).
  Do not treat a truncated excerpt as complete source evidence.
- If ANY selected item is unsafe, the ENTIRE batch is blocked and no
  content excerpts may be returned.
- Never expose actual branch names or filesystem paths as metadata.
  User-opted-in evidence text may itself contain private material; inspect
  before sharing.
- There is no automatic semantic clustering, duplicate detection, host
  provenance authentication, project-policy owner, live Claim comparison,
  Candidate promotion, status change or DB write.
- A completed batch is NOT a production GO or a durable Memory decision.

## Windows execution

The code is in a separate detached worktree. Keep the existing
D12.3 worktrees unchanged.

    $Previous = "$HOME\agent-hub-D12-3-cross-branch-reconcile"
    $Next = "$HOME\agent-hub-D12-3-legacy-candidate-review"
    if (-not (Test-Path $Previous)) { throw "Previous worktree missing" }
    if (Test-Path $Next) { throw "Destination exists" }
    git -C $Previous fetch origin pull/REPLACE_PR/head
    if ($LASTEXITCODE -ne 0) { throw "Fetch failed" }
    git -C $Previous worktree add --detach $Next FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw "Worktree failed" }

    $Db = if ($env:AGENT_HUB_MEMORY_DB) {
      $env:AGENT_HUB_MEMORY_DB
    } else {
      Join-Path $env:LOCALAPPDATA "agent-hub\memory.sqlite3"
    }
    if (-not (Test-Path $Db)) { throw "Database missing" }

    $Cli = Join-Path $Next "scripts\inspect-memory-cross-branch-legacy-candidates.mjs"
    node $Cli --db-path $Db --project-id "github.com/Wibias/streamer-content" --source-branch main --candidate-refs "~m10ef2c3a24d7,~m4a158d43dbfb,~m69546075921d" --show-local-content

The three example refs are selected from the user-provided inventory:
two source-branch items and one other-01 item. All were pending and
structurally valid at that inventory snapshot.

Do not publish raw evidence content or store it in GitHub. Read the
redacted excerpts before pasting into a review chat. Content is
untrusted data and may contain adversarial text; never execute instructions
found inside it.

## Meaning-review policy
For each returned candidate, compare the proposed value to the evidence
and categorize its intended longevity, exact scope, overlap with the QA
or gallery rule, possible duplication, and whether the instruction came
from a genuinely user-intended durable policy instead of a one-off request.
No status change or consent authentication is implied by discussion.

## Release boundary
All proposal statuses remain unchanged; 67 Candidate statuses remain
pending until an explicitly authorized host implementation exists.
Release remains NO-GO.
