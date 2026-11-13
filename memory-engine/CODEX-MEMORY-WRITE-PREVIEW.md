# Codex Memory Write Preview (separate approval-gated local MCP)

## Purpose

Make a first **real canonical Memory Claim write** available to original Codex CLI and Desktop without enabling the G5 Windows production broker. This uses the existing Memory Engine SQLite transactions/WAL and existing explicit Codex claim commit protocol, not native file replacement. G5's handle-relative rename applies to a separate, bounded file-artifact writer and must never replace a live SQLite database.

The existing global agenthub-memory-read MCP and memory_recall tool remain unchanged. This is a separate server with one tool: memory_commit_approved. There are no free-form model-supplied memory contents, SQL queries, file paths, DB selectors, branch or project selectors, lifecycle transitions or approvals.

## Normal Codex conversation path (preferred)

The already-installed `UserPromptSubmit` hook, not the experimental writer MCP, owns explicit user-direct memory commands. The hook now recognizes clear **whole-message** requests such as `Merke dir, dass wir PostgreSQL nutzen.`, `Merke dir: Wir nutzen PostgreSQL.`, or `Remember that we use Node 24.`. This writes one canonical Claim through the original Memory Engine without copying evidence IDs or invoking any preview MCP tool. It remains subject to the original hook's project and branch scope and provenance checks. The direct message is stored as redacted source Evidence. The hook consumes the request and returns a confirmation instead of forwarding it to the model.

Ordinary conversations are different: conservative user/agent candidate capture and the existing Stop/SubagentStop processing route may propose memories. A candidate needing confirmation is **not** silently promoted. A model's own text is not user_direct approval. On Windows the UserPromptSubmit **background candidate pipeline launch remains disabled** as before; the separate Stop/SubagentStop pipeline is not changed.

To activate the improved natural wording locally, the installed Codex hooks must actually point to this checked-out source; mere global MCP registration does not install or redirect hooks. Use `node scripts/setup-codex-host.mjs` to inspect first. No automatic host configuration changes are performed by merging this PR.

## Exact write flow

1. A human uses a separate **interactive** PowerShell terminal to type the exact fact and confirm with the phrase APPROVE ONE WRITE.
2. The operator command checks the already enrolled Git project and already existing canonical SQLite DB via the existing per-user memory scope manifest. It records redacted user_direct evidence and an exact one-use approval bound to evidence ID, current branch and repository identity, valid for only 10 minutes.
3. Original Codex Desktop/CLI calls memory_commit_approved with the returned evidence_id.
4. The Memory Engine atomically consumes the approval; the existing Codex commit protocol writes a canonical Claim from the immutable Evidence. A second call fails (replay). The unchanged memory_recall tool can find the Claim.

The operator command never enrolls a new project or initializes a database. A failed commit after an approval was consumed does not refund authorization.

## Direct Windows 11 x64 usage (Node 24+, PowerShell 7, existing enrolled project)

Use a clean AgentHub checkout containing this PR branch. **Do not overwrite an existing working tree or real memory database.** Do not execute the preparation command through an autonomous Codex shell.

In a normal, non-administrator PowerShell terminal rooted at the approved Git project:

~~~powershell
$hub = (git rev-parse --show-toplevel).Trim()
node "$hub\scripts\prepare-codex-approved-memory-write.mjs" --cwd $hub
~~~

Enter the exact memory text. Type APPROVE ONE WRITE when asked. Copy the printed evidence_id (not a password; it identifies the one approved fact).

Only if you explicitly opt in, register the independent preview MCP:

~~~powershell
$server = Join-Path $hub 'scripts\run-codex-approved-memory-write-mcp.mjs'
codex mcp add agenthub-memory-write-preview -- node $server --cwd $hub
codex mcp list
~~~

Restart the original Codex Desktop. In a session for the **same project**, instruct Codex to call the real tool memory_commit_approved with exactly the printed evidence_id. Verify an observed tools/call response with status committed, a claim_id and the correct branch. Repeating that exact call should produce approval_denied. Then call the existing memory_recall tool with a distinctive phrase from the fact and confirm the Claim ID and project. **Do not infer success from a model-only narrative**.

Remove the preview registration at any time:

~~~powershell
codex mcp remove agenthub-memory-write-preview
~~~

## Security limitations

This preview runs as the **same Windows user as Codex**. A fully shell-capable malicious agent or a compromised same-user process could invoke the operator CLI itself or alter the local scope/DB. The typed confirmation phrase is a human-interaction convention, **not a Windows security boundary**. Global read project allowlisting is a scope check, not cryptographic host/session authentication. We therefore cannot call this a production write authorization, even with a successful tools/call.

For production, G2/G3/G4/G5 gates, broker-separated OS identity, authenticated session and explicit authorization controls must be integrated and reviewed separately. No service or pipe is installed by these scripts. The preview does not unlock G5 writing or Graph production routing.

**G5-Write HOLD. Production NO-GO.**

## Optional project-wide publication for an existing user-direct memory

A normal Claim remains scoped to the Git branch where its original source
Evidence was captured. Do **not** copy Claims between branches, overwrite
their branches, or infer project scope from conversational phrasing alone.

An operator may explicitly publish a single existing, active, non-synthetic
`user_direct` Claim (subject: user memory; predicate: states; real user-prompt
Evidence) through `scripts/manage-project-wide-memory.mjs`. Publication and
revocation are append-only canonical Evidence events in the same SQLite
database, including the exact original Claim and Evidence IDs, originating
branch, and a SHA-256 of the Claim text. They survive canonical export/import.

A published Claim remains subject to normal current/historical, provenance,
conflict and authority checks on its **source branch**. Other user decisions,
repository evidence, test seeds and model-inferred Claims are not published.

This operation requires an already approved repository and an interactive
PowerShell terminal. First retrieve the exact Claim ID from the original
branch using a read-only `MemoryEngine.recall` call. Inspect it with:

~~~powershell
$hub = Join-Path $HOME '.agents'
node "$hub\scripts\manage-project-wide-memory.mjs" --cwd $hub --claim-id "EXACT_CLAIM_ID" --inspect
~~~

If and only if that decision should apply to all branches of the same Git
project, repeat with `--publish`, read the displayed Claim, and type
`PUBLISH PROJECT-WIDE`. `--revoke` requires `REVOKE PROJECT-WIDE` and
immediately stops the cross-branch projection without deleting canonical
Evidence or modifying the original Claim.

Only the already allowlisted **global** read-only `memory_recall` MCP projects
published Claims into other branches. Returned cross-branch items include
`scope:"project"` and `origin_branch`. This does not alter the old pinned
project MCP, make the system multi-tenant, or unlock C9 production writing.

This is same-Windows-user operator consent, not a privileged OS security
boundary. No normal model-side memory write can silently publish a Claim.
