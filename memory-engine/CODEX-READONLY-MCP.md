# Codex read-only AgentHub Memory MCP (opt-in preview)

This is a real Memory-Read integration. It is not the Reference Graph, C9 Windows broker, or a new memory store.

The adapter exposes exactly one local stdio MCP tool: **memory_recall**. It opens the **existing** AgentHub canonical SQLite database with a read-only MemoryEngine connection. It never registers a project, refreshes freshness, captures a prompt, writes telemetry, imports data, consumes approvals, installs a service, or changes a host setting on its own. No HTTP listener or API key is necessary.

## Recall boundaries

The repository, branch and Git revision are resolved from the trusted --cwd at server startup, not from the agent's MCP arguments. Project identity follows the existing Codex hook configuration and Git repository identity resolver. The default Windows memory file is %LOCALAPPDATA%\agent-hub\memory.sqlite3.

- Current mode only: eligible active claims from the same project and branch, with current Git evidence freshness.
- The existing answer-reliance policy allows user_direct, repo_trusted and tool_observation. It rejects agent_inference, external_untrusted, and unresolved conflicts.
- Up to 10 items in a bounded 12 KiB core response. Only claim value and minimal evidence provenance are returned, with re-redaction and truncation.
- Missing DB -> memory_database_unavailable, without creating a DB. Unknown project -> project_not_registered. No eligible match -> no_current_authorized_match. Errors are sanitized.
- Model-visible memory is *data*, never an instruction, command, approval or new source of authority.

**Limitation:** The read-only adapter cannot refresh Git path freshness snapshots without modifying canonical data. Path-grounded memories whose existing snapshot is missing or not current for this exact Git revision are intentionally excluded.

## Windows opt-in setup

Prerequisites: original Codex CLI/Desktop, Node.js 24+, PowerShell 7, and an AgentHub checkout containing this feature. Execute inside the *actual AgentHub project checkout*, not an outdated preview clone.

~~~powershell
$repo = (git rev-parse --show-toplevel).Trim()
$entry = Join-Path $repo 'scripts\run-codex-memory-mcp.mjs'
node --version
Test-Path -LiteralPath $entry

# The following action changes Codex MCP config only if you execute it.
codex mcp add agenthub-memory-read -- node $entry --cwd $repo
codex mcp list
~~~

Codex CLI and Desktop share MCP server configuration. Restart Codex Desktop after explicitly registering the server. To use another project checkout, create a separate server with a different name and a pinned --cwd.

If the user's existing hooks already use a custom memory DB and project ID, configure those as trusted *host-side environment* arguments, never in a model-controlled tool call. Choose this registration option instead of the default:

~~~powershell
codex mcp add agenthub-memory-read --env AGENT_HUB_MEMORY_DB='C:\absolute\existing\memory.sqlite3' --env AGENT_HUB_MEMORY_PROJECT_ID='existing-project-id' -- node $entry --cwd $repo
~~~

The sample paths and IDs are placeholders. Do not run both registration commands. MCP access lets the agent read eligible local memories and use them in model context; review the privacy implications with your selected model/provider. There is no confirmation dialog for each recall.

## Actual Codex E2E acceptance

In original Codex Desktop or CLI, invoke the **memory_recall** MCP tool with a query about a memory you know is *already stored* for this project and branch. Inspect the actual tool call/result.

1. When status is found, verify the claim value/ID plus evidence ID, source kind, timestamp and authority class against the original stored memory.
2. Use an unrelated query and verify it does not return an invented memory.
3. Inspect that the available tool list has only memory_recall. No service or writer operation is exposed.
4. If status is memory_database_unavailable or project_not_registered, report the blocker and do not seed the user's real database merely to make a test pass.

The isolated regression uses temporary real SQLite Evidence and Claims, invokes the **actual stdio MCP process**, and checks no canonical DB bytes change:

~~~powershell
node --test tests/memory-engine/codex-readonly-memory-mcp.test.mjs
~~~

**Not demonstrated by a successful isolated test:** The user's personal memory DB contains relevant data, production/security authorization, C9 release approval, cross-project lookup, memory writes, or an independently attested Codex Desktop session. C9 security gates and Graph production gates remain NO-GO.
