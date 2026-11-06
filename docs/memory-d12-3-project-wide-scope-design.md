# D12.3 Phase 9: project-wide policy scope, read-only audit

This phase is stacked on Draft #199. It does **not** enable project-wide policy,
change the canonical schema, activate the Streamer Content QA rule, or mutate
any local database.

## What the existing engine actually does

- Canonical claims are keyed by project_id and an exact branch_scope.
- Evidence-bound proposals and memory candidates also use exact project/branch.
- Existing conflict/relation validators require matching exact branch scopes.
- Therefore the special spelling "*" or "main" must NOT be interpreted as a
  project-wide wildcard, nor should the QA instruction be copied to branches.
- A scoped zero-Claim comparison on main does NOT establish absence of
  conflicting claims or candidate/proposal evaluations on other branches.

## Safe near-term inspection

Run on the same private SQLite DB, from a separate detached worktree containing
this PR, in an interactive local PowerShell session. The audit itself never
prints raw proposal, Evidence, Claim, candidate, branch, source or token text.
It prints only caller-supplied project/source branch and counts.

    $Previous = "$HOME\agent-hub-D12-3-decision-reconcile"
    $Next = "$HOME\agent-hub-D12-3-project-scope-audit"
    if (-not (Test-Path $Previous)) { throw "Missing decision worktree" }
    if (Test-Path $Next) { throw "Destination exists; do not overwrite" }
    git -C $Previous fetch origin pull/201/head
    if ($LASTEXITCODE -ne 0) { throw "Fetch failed" }
    git -C $Previous worktree add --detach $Next FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw "Worktree creation failed" }

    $Db = if ($env:AGENT_HUB_MEMORY_DB) {
        $env:AGENT_HUB_MEMORY_DB
    } else {
        Join-Path $env:LOCALAPPDATA "agent-hub\memory.sqlite3"
    }
    if (-not (Test-Path $Db)) { throw "Missing local memory DB" }
    $Cli = Join-Path $Next "scripts\inspect-memory-project-rule-scope.mjs"
    node $Cli --db-path $Db `
        --project-id "github.com/Wibias/streamer-content" `
        --source-branch main `
        --proposal-ref "~p72cc39ed74bf"

Expected status: manual_project_scope_review_required. This is a
warning, not a production GO. Review the project-wide count of candidate,
stale, conflicted, and active Claims, unresolved candidates/proposals
(including failed), and open conflicts. No automatic semantic approval is
returned even if counts are zero.

## Proposed future architecture (design only, not implemented)

1. Introduce an **explicit, separately owned project-policy ledger**,
   distinct from the existing branch-scoped claims. One immutable rule
   version per project ID and policy key; no magic branch_scope sentinel.
   The project ID must come from verified repository identity.
2. Store authoritative approval and verified source in append-only provenance:
   exact project identity, reviewed proposal and canonical text digest, original
   Evidence body digest, authenticated host event ID, specific approved rule
   text/version, effective-from, explicit scope ("full E2E" only), and later
   revocations/supersession. Do not trust a manually transcribed chat manifest
   as a host-signed event.
3. Read-time resolution: load eligible project policies once, then overlay
   branch-local nonnormative observations. Branch-local observations may
   suggest conflicts but cannot silently override or redefine an approved
   policy. Show explicit unresolved conflicts, never silently drop them.
4. The conflict gate must consider ALL relevant branches, ALL active,
   candidate, stale and conflicted Claim states, plus pending,
   needs_confirmation and failed candidate/proposal rows. An absent
   claim is not sufficient clearance; semantic review remains human-led.
5. No duplicate per-branch normative Claims. A feature-branch query can
   receive the project-policy owner by reference with provenance, without
   copy or auto-promotion. Never expose policies across repository IDs.
6. Revocation must be versioned and effective immediately in all branch reads.
   Explicit host authorization and audit events are mandatory. A safe rollout
   requires exact export/import, restore, rollback, concurrent-writer/WAL and
   conflict regression tests before activating the new read path.

## Security boundaries of this phase

- Opens SQLite readOnly, BEGIN then ROLLBACK.
- Validates that the selected unresolved proposal exists exactly once and
  has at least one in-project, in-source-branch, normal-sensitivity Evidence.
- Counts current project ledger rows across all branches without their names,
  texts, raw IDs or excerpts. Distinct branches is a count, not an inventory.
- No semantic conflict comparison, source-body integrity check, authenticated
  approval, project-scope policy owner, claim mutation or write.
- Missing required tables and unsafe selected evidence block the audit.
- The reported count is a snapshot; concurrent writers can change later state.
- Passing tests and a successful counting audit are NOT production clearance.

D12.3 remains NO-GO until the independently reviewed security rollout.
