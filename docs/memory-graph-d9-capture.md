# D9: Explicit Repository Evidence Capture

D8 observed zero repository-backed Evidence in the selected production scope.
D9 adds a separate operator-invoked capture path. It does not modify Codex
hooks, automatic capture, canonical schema, Recall, or the Memory Console.

## Contract

- Exactly one explicitly selected regular tracked Git file per invocation.
- Verify the exact Git root, canonical project identity, selected branch, full
  immutable HEAD, committed blob OID, and absence of uncommitted changes.
- Reject invalid paths, directories, symlinks, untracked files, dirty files,
  mismatched projects, wrong branches, and changing checkouts.
- Use only read-only Git subprocesses with inherited GIT_* overrides removed.
- Store no file contents. The primary claim states only that one regular
  Git blob exists at the verified revision, not anything about its meaning.
- Never promote existing session or tool observations to repo_trusted.
- Stable IDs make a repeated request for the same revision idempotent.
- No automatic scanning, project registration, default DB, or checkout changes.

## CLI usage (Node 24)

An existing MemoryEngine database must already have a project whose
registered repository identity exactly matches the selected checkout.
No command creates a database or invents a repository identity.

Read-only dry-run (default):

    node scripts/capture-memory-graph-d9.mjs --db-path PATH --repo-root ROOT --project-id ID --branch BRANCH --path RELATIVE_FILE

Explicit single-file Evidence + primary Claim insertion:

    node scripts/capture-memory-graph-d9.mjs --db-path PATH --repo-root ROOT --project-id ID --branch BRANCH --path RELATIVE_FILE --write

Production use of --write requires separate operator authorization, backup,
and review of the target path and database. No D9 CI test or published PR
performs a production write. The output contains only booleans and fixed
status labels, without file paths, Git hashes, source contents or raw errors.

## Evidence and acceptance

A disposable real-Git/SQLite integration must prove: default dry-run leaves
SQLite bytes unchanged; the explicit single-file write produces canonical
repository Evidence with one active primary claim; the source content is
absent; duplicate invocation is idempotent; D8 becomes ready_for_d7_live;
D7 live verification passes with one fresh repository node; changing the
committed blob subsequently makes D7 block as stale; invalid selections
do not produce Evidence.

Synthetic results do not establish production coverage. The prior D8
production audit remains the factual state until a separate, explicitly
approved real capture is made. No merge is automatic.
