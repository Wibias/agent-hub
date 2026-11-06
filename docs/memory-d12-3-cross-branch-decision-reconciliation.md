# D12.3 Phase 13: full cross-branch read-only decision reconciliation

This phase is stacked on Draft PR #204. It adds one PRIVATE local verifier
for manual intents for ALL currently open Evidence-bound proposals of exactly
one registered project. It does not mutate any SQLite record or grant a
promotion, ignore action, user-consent authority or project-wide policy.

## Intent manifest contract

Input is a local **untrusted** JSON manifest with exact keys:
- type: agent_hub_memory_cross_branch_manual_decision_intents_v1
- origin: manual_chat_transcription_unverified
- scope: { projectId, sourceBranch }
- items: a list of one entry for every open Evidence-bound proposal.

Each item has these exact fields:
- proposalRef: opaque ~p<12 hex>
- expectedBranchGroup: source or other-XX (ephemeral equality group)
- expectedKind: preference | procedure | knowledge
- expectedStatus: pending | needs_confirmation | failed
- canonicalFactSha256: 64 hex of the EXACT original canonical_fact bytes
- evidenceRefs: array of opaque ~e<12 hex> Evidence refs
- expectedAuthority: declared original Evidence authority class
- intent: ignore_when_authorized | retain_project_rule_for_review |
  retain_scoped_for_review
- targetScope: null for ignored; project_wide_e2e_qa for retained QA;
  blender_gallery_only for retained Gallery rule
- rationaleCode: fixed allowlisted code, NEVER free-form content.

The checker rejects any additional manifest keys including fake approved,
host_authenticated or apply controls. This manifest is a manual transcript
and must remain PRIVATE. It is not a signed event, a host-consent record,
a migration artifact or a decision application payload.

## Core checks

- Open the exact local DB with readOnly:true; BEGIN; ROLLBACK; close.
- Verify project registration, all required ledgers and exact scope.
- Scan ALL pending / needs_confirmation / failed proposals across branches
  for the registered project, never branch=main as a wildcard.
- Require EXACT complete inventory: one manifest item for every project
  proposal; detect extra, missing, status-changed and non-open proposals.
- Check kind, exact canonical fact SHA-256, linked Evidence opaque refs,
  Evidence authority, matching project/branch and normal sensitivity.
- Check that 'source' group matches sourceBranch; other-XX groups must each
  map consistently to one non-source branch, and no two groups may map to
  the same branch. No hidden branch names are output.
- Classify ignore versus scoped future-review intentions without acting
  on them. Count project Claims, without comparing their meaning.
- Fail closed on unknown projects, malformed scope, unexpected keys,
  opaque hash collisions, missing source links and oversized inventories.
- Emit ONLY opaque refs, fixed blockers, counts, approved *intent vocabulary*
  (not user approval), grouping labels and explicit non-authorization flags.

## What remains UNVERIFIED

- The manifest's recorded canonical_fact hashes refer to copied local
  review text. The checker compares them with CURRENT database text, but
  does NOT independently authenticate that the text was reviewed by the
  real host user in an authenticated session.
- It does not read or hash Evidence body content. A modified Evidence body
  with the same ID could go undetected.
- There is no semantic comparison across all 62 legacy candidates,
  immutable Evidence provenance, project policy owner, user event capture,
  branch inheritance, revocation, backup/WAL restore test, write or merge.
- A 'matched_read_only' output is NOT a green light for production.

## Windows operation

Keep the 21-item private JSON outside the repository. The operator
receives it separately; its two original sources were a nine-item
main-scope review manifest and a twelve-item cross-branch manual transcript.
DO NOT commit either source or the combined file.

    $Previous = "$HOME\agent-hub-D12-3-proposal-cross-branch"
    $Next = "$HOME\agent-hub-D12-3-cross-branch-reconcile"
    if (-not (Test-Path $Previous)) { throw "Previous worktree missing" }
    if (Test-Path $Next) { throw "Destination exists; do not overwrite" }
    git -C $Previous fetch origin pull/209/head
    if ($LASTEXITCODE -ne 0) { throw "Fetch failed" }
    git -C $Previous worktree add --detach $Next FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw "Worktree failed" }

    $Db = if ($env:AGENT_HUB_MEMORY_DB) {
      $env:AGENT_HUB_MEMORY_DB
    } else {
      Join-Path $env:LOCALAPPDATA "agent-hub\memory.sqlite3"
    }
    $Manifest = Join-Path $env:LOCALAPPDATA "agent-hub\D12.3-21-proposal-review-intents-untrusted.json"
    if (-not (Test-Path $Db)) { throw "DB missing" }
    if (-not (Test-Path $Manifest)) { throw "Manifest missing" }
    node "$Next\scripts\reconcile-memory-cross-branch-decisions.mjs" --db-path $Db --project-id "github.com/Wibias/streamer-content" --source-branch main --decisions-file $Manifest

The private manifest must be placed there explicitly by the operator.
Any blocked output must be resolved by re-reviewing sources; do NOT modify
the DB or rewrite expected hashes solely to manufacture a match.

## Release boundary

No apply, activation, deletion, promotion, status change, migration or
merge is included. D12.3 production remains NO-GO.
