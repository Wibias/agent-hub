# D12.3 Phase 8: read-only reconciliation of manual decision intents

This is a **local, read-only consistency check**, stacked on Draft PR #194.
It reconciles a private JSON file describing human-reviewed decision **intents**
against the currently open Evidence-bound proposals in one SQLite read
transaction. It does not write the intents to SQLite, create Claims, or
authenticate a conversation.

## Trust boundary

- The decision file is a **manual transcription**. It is NOT a trusted Codex
  host confirmation, not an authorization token, and not a durable ledger.
- No project-wide rule inheritance, semantic conflict evaluation, promotion,
  finalizer, status update, or database mutation is performed.
- SQLite is opened with DatabaseSync({readOnly:true}) and read within BEGIN /
  ROLLBACK. Missing tables, incomplete inventory, changed status/content,
  missing/foreign/non-normal Evidence, changed authority/links, and ambiguous
  opaque IDs block a matched result.
- The local manifest binds each proposed decision to the full SHA-256 hash
  of its **original canonical_fact**, exact Evidence opaque refs, status, kind,
  and source authority. These are consistency checks, not signatures.
- All currently open proposals in the exact project and branch must be
  represented. A new open proposal or any disappeared proposal blocks the
  result. No hidden 100-item truncation is treated as success.
- JSON schema is allowlisted: no free-form descriptions, original content,
  source IDs, filesystem paths, session IDs, host approval claims, or secrets
  in the manifest. Keep the manifest PRIVATE even though its refs are opaque.
- Output is metadata-only; it contains no proposal text, Evidence content,
  Claim content, DB paths, or original internal IDs.
- Existing scoped Claims are counted in active, candidate, stale, and
  conflicted states, but their meaning is NOT compared. Other branches and
  project-wide inheritance are not evaluated.
- A matched report is **not** a GO signal. There is no apply flag.

## Manifest format

Create a JSON file OUTSIDE any Git worktree, for example:

    $Manifest = Join-Path $env:LOCALAPPDATA "agent-hub\private-review-intents.json"

The local JSON object has exactly these fields:

    {
      "type": "agent_hub_memory_manual_decision_intents_v1",
      "scope": {
        "projectId": "github.com/example/project",
        "branch": "main"
      },
      "origin": "manual_chat_transcription_unverified",
      "items": [
        {
          "proposalRef": "~p000000000000",
          "expectedKind": "procedure",
          "expectedStatus": "needs_confirmation",
          "canonicalFactSha256": "<64 lower-case hexadecimal chars>",
          "evidenceRefs": ["~e000000000000"],
          "expectedAuthority": "user_direct",
          "intent": "retain_project_rule_for_review",
          "rationaleCode": "explicit_user_confirmation"
        }
      ]
    }

The example is illustrative and WILL NOT match any real proposal. Supported
intent values: retain_project_rule_for_review, ignore_when_authorized.
Supported rationale codes: explicit_user_confirmation,
single_task_instruction, canonical_guidance, canonical_config, tool_guidance,
canonical_product_data, canonical_implementation.

To compute the canonical fact SHA-256 locally from a reviewed exact string,
use:

    $Text = 'Exact original canonical_fact from local review'
    $Bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $Digest = [System.Security.Cryptography.SHA256]::HashData($Bytes)
    [Convert]::ToHexString($Digest).ToLowerInvariant()

Do not hash the proposed rewritten rule in place of the original proposal
fact: that would break the evidence binding.

## Windows invocation

Use a separate detached worktree for this PR; do not reset, merge or mutate
the existing #193/#194 worktrees.

    $Previous = "$HOME\agent-hub-D12-3-evidence-review"
    $Next = "$HOME\agent-hub-D12-3-decision-reconcile"
    if (-not (Test-Path $Previous)) { throw "Evidence review worktree missing" }
    if (Test-Path $Next) { throw "Destination worktree exists" }
    git -C $Previous fetch origin pull/199/head
    if ($LASTEXITCODE -ne 0) { throw "Fetch failed" }
    git -C $Previous worktree add --detach $Next FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw "Worktree failed" }

    $Db = if ($env:AGENT_HUB_MEMORY_DB) {
        $env:AGENT_HUB_MEMORY_DB
    } else {
        Join-Path $env:LOCALAPPDATA "agent-hub\memory.sqlite3"
    }
    $Manifest = Join-Path $env:LOCALAPPDATA "agent-hub\private-review-intents.json"
    if (-not (Test-Path $Db)) { throw "Memory DB missing" }
    if (-not (Test-Path $Manifest)) { throw "Private review manifest missing" }
    $Cli = Join-Path $Next "scripts\reconcile-memory-review-decisions.mjs"
    node $Cli --db-path $Db --project-id "github.com/Wibias/streamer-content" --branch main --decisions-file $Manifest

Do NOT put the private manifest in the repository, commit it, attach it
to GitHub, or paste private review text into issues. Keep the original
human approval and exact revised wording separately until an authenticated
local host-confirmation and project-wide Claim scope exist.

## Release boundary

No merge, local DB writes, production migration or user-specific Claim
promotion is authorized by this read-only tooling. The project-wide QA
inheritance, exact span/provenance portability, host authentication,
conflict review, multiwriter/WAL backup and restore, and revocation gates
remain OPEN. CI only verifies the synthetic regression tests.
