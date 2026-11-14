# D12.3 Phase 15: all 108 reviewed Memory items, read-only reconciliation

This checker is stacked on Draft PR #215. It does not apply, promote,
ignore, activate, revise or delete any Memory data, and it is NOT a
host-authenticated consent event or project-wide policy implementation.

## Scope and review anchor

A user-confirmed, **untrusted, manual-chat transcription** contains exactly:

- 21 Evidence Proposals: 19 future-ignore intents; 1 project-wide E2E QA
  retain-for-review; 1 Blender-Gallery retain-for-review;
- 87 legacy Candidates: 86 future-ignore intents; 1 Gallery-only
  reproducibility retain-for-review;
-  2 already-active Gallery Claims, not counted among the 108 items.

The private review-intent JSON is generated outside GitHub from the
previously user-provided final review summary, 21-Proposal manifest and
private 87-Candidate export. **Do not commit or publish that JSON.** It
contains opaque IDs, hashes and disposition labels, not the raw source
texts. The original private export contained redacted prompts and paths
and must also remain outside the repository.

SHA-256 of the intended private combined review manifest:

`7643c2feb8ffe5d00011800c4666286fdb6b4bdc2fc5de97b65994b4b4730f87`

This checksum is for detecting accidental substitution or corruption,
**not a signature or host-authentication mechanism**.

## Validation

All data is read in one SQLite transaction with `DatabaseSync(readOnly:true)`
and finished with ROLLBACK. Every record is scoped to the exact registered
project. The verifier:

- rejects extra or missing open Proposals, Candidates or active project Claims;
- checks the exact status, type, source/branch binding, Evidence authority,
  normal sensitivity, and opaque references;
- checks each original Proposal canonical fact SHA-256 and Evidence links;
- checks each Candidate proposed value SHA-256 and **full stored redacted
  Evidence body SHA-256**, even when the earlier user-facing preview was
  truncated;
- checks the two active Claims' state, primary Evidence links and Evidence
  scope (but **not** Claim text hashes);
- checks Proposal branch groups as independent equality constraints, and
  Candidate branch slots using the original complete inventory's
  source/other-NN convention;
- fails closed on changes, unexpected manifest keys, invalid scope,
  hash mismatch or unsupported mutation flags.

It outputs only counts, fixed blocker codes and opaque mismatched refs.
Never prints source texts, raw row IDs, branch names or local paths. A
blocked report has a nonzero CLI exit status. There are no write-related
flags or database mutations.

The result is `matched_read_only` **only** if the current database is
consistent with the frozen manual review snapshot. It does NOT prove
whether the stored Evidence is authentic, whether the instructions are
still semantically right, whether the two active Claims have unchanged
text, or whether any future write is authorized. Proposal Evidence bodies
lack a prior comparison hash and are intentionally not given a false
integrity verdict.

## Windows PowerShell: one local check

Download the private combined review manifest separately, verify its SHA
and put it in a local nonshared directory. Use the already-created
Phase 14 export worktree as the parent for this detached checkout. Do not
reset, overwrite or merge any existing worktree.

    $ErrorActionPreference = 'Stop'
    $Previous = "$HOME\agent-hub-D12-3-all-candidates-export"
    $Next = "$HOME\agent-hub-D12-3-final-108-reconcile"
    if (-not (Test-Path $Previous)) { throw 'Previous worktree missing' }
    if (Test-Path $Next) { throw 'Worktree exists; do not overwrite' }

    git -C $Previous fetch origin pull/217/head
    if ($LASTEXITCODE -ne 0) { throw 'Fetch failed' }
    git -C $Previous worktree add --detach $Next FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Worktree failed' }

    $Db = if ($env:AGENT_HUB_MEMORY_DB) {
        $env:AGENT_HUB_MEMORY_DB
    } else {
        Join-Path $env:LOCALAPPDATA 'agent-hub\memory.sqlite3'
    }
    $Review = Join-Path $env:LOCALAPPDATA 'agent-hub\private-reviews\D12.3-108-entscheidungen-abgleich-nichtautoritativ.json'
    $Checksum = '7643c2feb8ffe5d00011800c4666286fdb6b4bdc2fc5de97b65994b4b4730f87'
    if (-not (Test-Path $Db)) { throw 'Database missing' }
    if (-not (Test-Path $Review)) { throw 'Review file missing' }
    if ((Get-FileHash -LiteralPath $Review -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Checksum) {
        throw 'Review checksum mismatch'
    }
    node "$Next\scripts\reconcile-memory-final-108-review.mjs" --db-path $Db --project-id 'github.com/Wibias/streamer-content' --source-branch main --review-file $Review --expected-review-sha256 $Checksum
    if ($LASTEXITCODE -ne 0) { throw 'Read-only 108-item reconciliation blocked' }

If a new Candidate or Proposal appears, stop and produce another read-only
inventory and targeted review. Never change the expectation to force a
passing result. Never use a matched output as authorization to mutate.

## Release boundary

0 SQLite writes, 0 applied decisions, 0 promoted Candidates, 0 new Claims.
No merge or production GO. Separate host consent, project policy ownership,
semantic conflict evaluation, Evidence provenance, rule inheritance,
revocation, backup/restore and authorized audited mutations remain open.
