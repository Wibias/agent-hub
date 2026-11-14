# Memory Console: exact Evidence-Bound review preflight

This adds a **read-only** preflight to the existing Evidence-Bound `E~`
review inspector. It reuses the current Node SQLite inspector and existing
server-approved Git checkout resolver. It adds **no** separate security
framework, new service, new database, authorization mechanism or hidden
Claim promotion.

## Operator workflow

Start the existing Memory Console with an explicitly trusted Git root:

```powershell
node scripts/memory-ui.mjs --repo-root C:\path\to\approved\checkout
```

In the **Review** view, select an `E~` proposal and choose
**Check evidence and conflicts**. The inspector displays the exact current
Git revision, proposal integrity/preflight status, scoped active Claim count,
exact duplicates and reasons that require human review. Missing/untrusted
checkout, changed branch or ambiguous repository identity fails closed with
`git_context_unavailable`, not a fabricated revision.

The endpoint:

```text
GET /api/review-preflight?projectId=...&branch=...&proposalRef=E~...
```

takes **only** project, branch and an opaque `E~` reference. It deliberately
ignores browser-supplied Git revision, checkout path, DB path, Evidence IDs
and authority hints. The Git root comes from server startup configuration
and must match the already registered Memory project and requested branch.
The SQLite database is opened `readOnly` and `PRAGMA query_only=ON`
inside a read transaction. No original source text or absolute checkout
path is emitted. The preflight snapshot SHA-256 changes when relevant facts,
Evidence, relations, Claims or current Git revision change.

## Security and product boundary

**A preflight is not approval.** Both the API and UI keep
`promotionAllowed=false`, `hostUserOriginAuthenticated=false`,
`claimsCreated=0` and `decisionsApplied=0`. A useful or blocker-free
preflight cannot be replayed as permission to write. It only informs a
future trusted host review. The existing protected LocalService
`VerifiedReviewCoordinator` remains separate until trusted source
verification, actual human Windows Hello/FIDO2 enrollment, a
user-visible review ceremony and a protected atomic Claim decision are
integrated. User-writable `memory.sqlite3` is still not authoritative
for protected approval.

If the Console was started without `--repo-root`, its existing
graph and memory pages remain available. The preflight reports
`git_context_unavailable` instead of guessing.

## CI evidence

The existing cross-platform Evidence-Bound preflight workflow now
tests the real HTTP endpoint on Node 24 in Windows 2022 and Ubuntu
24.04, including spoofed browser paths/revisions, real Git branch
switches, unconfigured roots, unchanged canonical Claims and unchanged
unapproved proposals. The existing Console JavaScript and design
regression workflows continue to run.

Default OFF for any write or service changes. No change to installed
Codex hooks, project allowlists or user SQLite databases.
