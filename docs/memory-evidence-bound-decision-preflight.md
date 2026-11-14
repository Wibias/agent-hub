# Evidence-Bound decision preflight (D12.3, read-only)

Issue: #326. This preflight is intentionally **not an approval implementation**.

## What it establishes

- Uses the unified Review UI's existing E~xxxxxxxxxx proposal reference.
- Requires an exact project ID, checked-out Git branch and full 40-character HEAD commit SHA. Git remote/project identity is checked against the supplied scope before any SQLite access.
- Opens the SQLite database read-only, sets query-only mode, and reads within one consistent transaction.
- Resolves exactly one reviewable needs_confirmation proposal; rejects missing, ambiguous, oversized, malformed, secret-redacted, wrong-authority or foreign-scope evidence.
- Displays citation authorities, the stored relation target and active-Claim comparison count. A same-scope exact duplicate blocks further consideration; any active Claim requires independent semantic review.
- Computes a reviewSnapshotSha256 over the selected proposal, evidence content/provenance, relationship, same-scope active Claims and Git revision. A changed token is refused.
- Canonical fact and source text are shown only with --show-local-content, and only in an interactive local TTY. Do not paste output into issue comments, CI logs or ChatGPT.

## Example: Windows PowerShell 7

From the checked-out AgentHub repository (not from an agent-generated Git worktree):

~~~powershell
$repo = (Get-Location).Path
$revision = (git rev-parse HEAD).Trim()
$db = Join-Path $env:LOCALAPPDATA "agent-hub\memory.sqlite3"
node .\scripts\inspect-evidence-bound-decision.mjs --db-path $db --repo-path $repo --project-id github.com/Wibias/agent-hub --branch main --revision $revision --proposal-ref E~0123456789
~~~

Replace E~0123456789 with the actual proposal reference from the unified Review UI. An optional --expected-snapshot followed by the previous 64-character reviewSnapshotSha256 detects changed review state. Run with --show-local-content only in a trusted local interactive terminal when you intend to read private redacted evidence.

The script does not accept --apply, --confirm, --reject or any mutation command. Every returned result contains promotionAllowed=false and decisionCommandEnabled=false.

## Authorization boundary and next phase

A user request, a ChatGPT message, an agent tool call, or a synthetic UserPromptSubmit JSON event is not by itself authenticated human approval.

Windows processes sharing the same user identity and database access can impersonate a hook or mutate SQLite directly. The same-account Codex process cannot be securely isolated from that threat merely by a CLI boolean, DPAPI protected under the same user, or a local file nonce. Any product claim of strong isolation would require a genuine, separately protected host enforcement boundary. If AgentHub instead trusts all same-user processes, deployment must explicitly state that trust assumption and residual risk; it cannot claim resistance to same-user malicious agents.

Next work requires distinct exact user-decision capture, an audit ledger, and single-transaction compare-and-set resolution, including evidence and relation rechecks. Canonical Claim writes, migration, installed hooks, G5 and the production broker remain **OFF / NO-GO** until the authorization model is established and reviewed with native Windows x64 E2E evidence. The old mixed-intent #192 finalizer cannot be substituted for Evidence-Bound decisions.
