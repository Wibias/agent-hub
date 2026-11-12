# Central local Codex Memory-Read MCP, project-isolated

AgentHub uses **one locally executed, globally registered stdio MCP server** for original Codex CLI and Codex Desktop. There is no HTTP listener, no automatic enrollment and no canonical SQLite mutation. The server exposes only the memory_recall tool and reuses the existing Memory Engine, answer-reliance policy and synthetic provenance exclusions.

## How project selection works

With no configured MCP cwd, the Codex local STDIO launcher uses its runtime working directory. Global mode starts with --global, never with --cwd. The server observes process.cwd(), resolves the actual Git checkout root and repository identity, then verifies **both** against an explicitly approved per-user allowlist.

Every read:
1. Validates the allowlist and observed Git root. A missing, unapproved or changed project fails closed.
2. Checks the actual Git project identity against the identity pinned when the operator enrolled the checkout. Prompt-controlled paths, project IDs and database names are forbidden.
3. Uses the allowlist's pinned existing SQLite DB and canonical current-mode recall for that project and branch only, including freshness, answer-reliance, conflicts and E2E test seed exclusion.
4. Returns a maximum of 10 claims in a 12 KiB core budget, minimal provenance and re-redacted values.

Inherited AGENT_HUB_MEMORY_PROJECT_ID, AGENT_HUB_MEMORY_REPO_IDENTITY and AGENT_HUB_MEMORY_DB are ignored in global mode. A model cannot select another project by adding tool arguments. Memory is data, not instructions or authorization.

Fail-closed status values include scope_not_configured, scope_invalid, project_context_unavailable, project_not_approved, project_identity_changed, project_not_registered, memory_database_unavailable and no_current_authorized_match. Existing allowed memory returns found. No new memories are generated to make a test pass.

**Threat-model limitation:** Startup process cwd is a host-runtime signal, not a cryptographically verified Codex session identity. The allowlist prevents accidental cross-repository reads under the audited local STDIO launch path but does **not** stop a malicious process running as the same Windows user, a deliberately spoofed process cwd, a compromised Codex host or a host version that supplies a different runtime cwd. OS ACLs and authenticated workspace identity are required for stronger isolation. If Codex starts the server outside an allowed checkout, it must deny rather than fall back to the AgentHub checkout.

## Windows opt-in migration (Node 24+, PowerShell 7)

These commands are not executed by a GitHub merge. The old global entry with --cwd is wrong for multi-project routing and must be replaced once. The MCP executable itself stays in the AgentHub checkout.

~~~powershell
Set-Location "$HOME\Downloads\AgentHub-ReadOnly-Preview"
git pull --ff-only
$hub = (git rev-parse --show-toplevel).Trim()
$server = Join-Path $hub 'scripts\run-codex-memory-mcp.mjs'
$manager = Join-Path $hub 'scripts\manage-codex-global-memory-projects.mjs'

# Dry-run: inspect proposed approval; no files changed
node $manager --add --cwd $hub

# Explicit enrollment. Writes only the local allowlist file.
node $manager --add --cwd $hub --apply

# Replace only the old global AgentHub registration.
codex mcp remove agenthub-memory-read
codex mcp add agenthub-memory-read -- node $server --global
codex mcp list
~~~

The new Codex entry must show --global, no --cwd and an empty Cwd field (typically -). Restart Codex Desktop. If a per-project .codex/config.toml from an earlier prototype exists, remove **only its old agenthub-memory-read MCP table** after inspecting it, or it may shadow the global server. Never delete unrelated project configuration.

### Enroll other projects

The same manager is used for all other checkouts, even though the manager script itself resides in AgentHub.

~~~powershell
$otherProject = 'C:\path\to\another\git-repository'
node $manager --add --cwd $otherProject
node $manager --add --cwd $otherProject --apply
node $manager --list
~~~

Adding an approved root does not add canonical project rows or Claims. The corresponding project must already exist in the shared memory store for recall to succeed. No-match and unregistered statuses are legitimate outcomes.

To revoke read permission without deleting the project memory:

~~~powershell
node $manager --remove --cwd $otherProject
node $manager --remove --cwd $otherProject --apply
~~~

The Windows allowlist defaults to %LOCALAPPDATA%\agent-hub\codex-memory-scopes.json and the canonical database to %LOCALAPPDATA%\agent-hub\memory.sqlite3. If your existing Codex hooks use a different database, specify the **existing absolute path** with --db on the first --add. Changing a pinned database later is denied; do not silently switch the memory source.

## Acceptance: actual global Codex project isolation

1. Open AgentHub as a fresh Codex Desktop session. Invoke the real memory_recall tool with a project-specific query. The result must show the AgentHub project ID, its current branch, and exclude historical runtime-e2e-seed records.
2. Open a different **approved** repository as a separate Codex session. Memory-Read must return only that repository's existing approved Claims, never AgentHub's.
3. Open a non-approved Git checkout. The same tool must return project_not_approved. In a non-Git folder it must return project_context_unavailable.
4. If the real Codex build spawns the global MCP from a non-session cwd, it fails closed. Do not repair that by assigning AgentHub --cwd globally or trusting a model-supplied path. Report the exact status and host behavior.

Direct transport smoke check from your current PowerShell directory (not a substitute for a genuine Codex session):

~~~powershell
Set-Location $hub
$request = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory_recall","arguments":{"query":"AgentHub"}}}'
$request | node $server --global
~~~

A returned non-seed Claim is not independent proof of human authorship. Verify its Evidence source reference, capture time and original human event. If no genuine saved memory exists, report that instead of seeding a fabricated one.

## CI

The dedicated Windows 2022 / Ubuntu 24.04 Node 24 workflow checks the real STDIO server launched from two different Git roots, canonical SQLite, explicit enrollment/revocation, Git identity changes, inherited environment spoof attempts, unapproved contexts, and existing seed/authority filtering.

~~~powershell
node --test tests/memory-engine/codex-readonly-memory-mcp.test.mjs tests/memory-engine/codex-project-memory-scope.test.mjs tests/memory-engine/codex-global-memory-scope.test.mjs
~~~

No C9 service, production Graph activation, Write-Broker or release signing is implied. C9 security gates and Graph production gates remain NO-GO.
