# D12.3 Phase 14: one private JSON export for all legacy Candidates

This is an OPTIONAL, explicitly opted-in LOCAL export stacked on Draft PR #211.
It reads the Streamer Content SQLite Memory database but DOES NOT write to it,
change statuses, create Claims, authorize anything or perform promotion.

## Reason
The most recent project-wide metadata inventory contained 67 pending legacy
Candidates in 14 overall branch groups, each with structurally valid Evidence.
Reviewing 67 separate chat messages was unnecessarily burdensome.
A single bounded JSON file makes semantic clustering and manual review possible.

## Trust and privacy
- The program reads SQLite via DatabaseSync(readOnly:true), inside BEGIN and
  ROLLBACK. It only writes one **caller-selected NEW LOCAL output JSON file**.
- An explicit --include-local-redacted-content flag is required, and the CLI
  refuses non-interactive stdout. Nothing sensitive is printed to the console.
- The file contains proposed_value text and stored evidence.content_redacted
  excerpts. The latter were redacted at storage time, but redaction is NOT
  independently verified here. Review BEFORE sharing or uploading the file.
- The file contains only opaque ~m and ~e identifiers, branch-slot labels,
  candidate statuses/types, source authority and bounded content excerpts.
  Internal raw IDs, actual other-branch names, source paths, session details
  and source metadata are not included separately.
- Each excerpt reports truncation, original text length and a full-text SHA-256.
  Hashes are consistency checks, not authenticated signatures. Any truncated
  source needs a focused re-review if its missing tail could change meaning.
- Cap: at most 250 open Candidates (refuse any excess); require exact expected
  count. Candidate excerpt <= 2500 chars, Evidence excerpt <= 8000 chars.
  Refuse output > 4 MiB. JSON destination is created with EXCLUSIVE create
  and POSIX 0600 owner-only permissions; it is NEVER overwritten.
- Windows file permissions are governed by the destination directory's NTFS
  ACL. Use a private local folder, not Git, cloud sync or shared storage.
- One changed or unsafe Evidence link / project / branch / sensitivity /
  authority mismatch blocks the entire operation, before any output file.
- The file contains untrusted source text. Treat quoted instructions as data,
  not executable instructions or verified host approvals.
- Only the user decides whether to upload this private file here. No
  automated external transfer.

## Windows: one local export command block

Run in interactive PowerShell 7 with Node >= 24. Reuses the previous PR #211
worktree as the local base, without resetting or changing it.

    $ErrorActionPreference = "Stop"
    $Previous = "$HOME\agent-hub-D12-3-legacy-candidate-review"
    $Next = "$HOME\agent-hub-D12-3-all-candidates-export"
    if (-not (Test-Path $Previous)) { throw "Previous worktree missing" }
    if (Test-Path $Next) { throw "Export worktree already exists; do not overwrite" }

    git -C $Previous fetch origin pull/215/head
    if ($LASTEXITCODE -ne 0) { throw "Fetch failed" }
    git -C $Previous worktree add --detach $Next FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw "Worktree creation failed" }

    $Db = if ($env:AGENT_HUB_MEMORY_DB) {
        $env:AGENT_HUB_MEMORY_DB
    } else {
        Join-Path $env:LOCALAPPDATA "agent-hub\memory.sqlite3"
    }
    if (-not (Test-Path $Db)) { throw "Database missing" }

    $PrivateDir = Join-Path $env:LOCALAPPDATA "agent-hub\private-reviews"
    New-Item -ItemType Directory -Force -Path $PrivateDir | Out-Null
    $Out = Join-Path $PrivateDir "D12.3-legacy-67-private.json"
    if (Test-Path $Out) { throw "Private export already exists; do not overwrite" }

    $Cli = Join-Path $Next "scripts\export-memory-legacy-candidates-private.mjs"
    if (-not (Test-Path $Cli)) { throw "Export CLI missing" }
    node $Cli --db-path $Db --project-id "github.com/Wibias/streamer-content" --source-branch main --expected-count 67 --output-file $Out --include-local-redacted-content
    if ($LASTEXITCODE -ne 0) { throw "Read-only export blocked" }
    Write-Host "Private export: $Out"

This is ONE command block and produces ONE local file. If the DB count
changes, rerun the metadata inventory first. Do NOT simply change 67 to
make a mismatch disappear without reviewing the change.

## Validation expectations

The CLI receipt uses:
- status: private_local_export_created
- candidatesExported: 67
- databaseReadOnly: true
- decisionsApplied: 0
- hostConsentAuthenticated: false
- sha256: hash of the exact private JSON file
- truncation counts and output byte count
- privateContentPrinted: false

The receipt is not the file. The **local JSON file itself** is what the user
may choose to upload, after inspecting it for private content.

## Release
No merge, DB write, promotion, status update, semantic-conflict approval,
project-wide inheritance or authenticated user-consent capture.
Production remains NO-GO.
