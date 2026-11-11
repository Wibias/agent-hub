# Codex Memory-Read: genuine data and project-scoped MCP

The original Codex CLI and Codex Desktop can read **existing** AgentHub canonical SQLite memory through the local stdio tool **memory_recall**. This is not the Reference Graph or the C9 Windows service. No Memory-Write operations, approvals, credentials, or HTTP listener are exposed.

## Test data are not user decisions

The original integration exercise retrieved records from the historical runtime-e2e-seed series. These happened to have user_direct as their stored authority class. That is a *classification label*, not proof of a real human decision.

Memory-Read now **excludes test seed provenance before applying the answer-reliance policy**:

- IDs, session IDs, and source references carrying the known runtime-e2e-seed marker or explicit test-fixture/seed marker are excluded.
- Evidence metadata explicitly indicating a test fixture, synthetic seed or test data is excluded.
- Supporting Evidence is also checked, including non-enumerable canonical provenance.
- The claim value/content alone **never** determines test provenance. A genuine decision *about tests* must not be silently excluded.
- Synthetic rows are **not deleted or rewritten** in SQLite. The response field omitted_test_data counts the exclusions separately from omitted_by_policy.

This is a conservative filter for **identifiable** fixtures; unmarked test data can still exist. Conversely, a non-seed source identifier is *not independent proof* that a human originally authored it. For high-confidence decisions, verify source_ref, session, timestamp and the originating user event rather than trusting user_direct alone.

The normal recall security boundary remains unchanged: read-only MemoryEngine, same Git project/branch/revision, only eligible current active claims and answer-approved authority, unresolved conflicts withheld, up to 10 items / 12 KiB, output redaction, no freshness writes. Missing DB -> memory_database_unavailable; missing project -> project_not_registered; no non-seed eligible result -> no_current_authorized_match.

## Project-scoped Codex configuration, not global

**Do not use codex mcp add for this project-only deployment.** That creates a user-global MCP entry, visible outside AgentHub. Codex supports project-local .codex/config.toml in trusted repositories. This is a configuration visibility boundary, not OS-level isolation: another local process running as the same user can still open the same memory file. For stronger isolation, use separate OS accounts/access controls.

### Windows, safe migration from the old global entry

Run in **PowerShell 7** with Node 24+ and original Codex:

~~~powershell
Set-Location "$HOME\Downloads\AgentHub-ReadOnly-Preview"
git pull --ff-only
$repo = (git rev-parse --show-toplevel).Trim()

# First only inspect the proposed local configuration. No writes:
node .\scripts\prepare-codex-memory-project-scope.mjs --cwd $repo

# The following command removes ONLY the old global MCP entry:
codex mcp remove agenthub-memory-read

# Then explicitly create a project-local .codex/config.toml:
node .\scripts\prepare-codex-memory-project-scope.mjs --cwd $repo --apply

# Inspect the locally generated configuration:
Get-Content (Join-Path $repo '.codex\config.toml')
codex mcp list
~~~

The setup command defaults to dry-run, checks that --cwd is the actual Git root, refuses to overwrite an existing .codex/config.toml, and refuses --apply while it finds the named global Codex entry. If an existing project config is present, manually merge the displayed mcp_servers table instead of replacing existing project settings. Do not commit the machine-specific .codex/config.toml file because it contains the absolute checkout path.

Codex project-local settings load **only when the project is trusted**. Restart Codex Desktop and open this exact AgentHub checkout. When Codex is opened in another unrelated project, the former globally installed tool should no longer be listed. The generated config sets:

- server name: agenthub-memory-read
- command: node with absolute launcher and fixed repository --cwd
- local transport only
- enabled_tools = ["memory_recall"]
- default_tools_approval_mode = "prompt" (approve Memory-Read calls in the Codex client)
- no write tool and no project/database override inside the tool call

If you want a less interruptive setup after privacy review, you may choose the documented read-only tool-approval policy yourself. Project-local visibility restricts the Codex tool catalog, but does not prevent same-user access to the underlying file.

### Windows memory query without model involvement

This sends a real MCP tool call and parses its inner JSON. It does not create new memories:

~~~powershell
$entry = Join-Path $repo 'scripts\run-codex-memory-mcp.mjs'
$request = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory_recall","arguments":{"query":"AgentHub","max_items":10}}}'
$response = ($request | node $entry --cwd $repo | ConvertFrom-Json)
$result = $response.result.content[0].text | ConvertFrom-Json
$result | Select-Object status, project_id, branch, omitted_test_data, omitted_by_policy, read_only
$result.items | Select-Object -ExpandProperty claim | Select-Object id, value
~~~

The previous query returned synthetic runtime-e2e-seed records. After this change, those should be absent and contribute to omitted_test_data. **Zero matching non-seed memories is a valid honest outcome**, not a reason to seed or silently broaden permissions.

### Real existing-memory acceptance in Codex Desktop

Ask Codex to use only mcp__agenthub_memory_read__memory_recall and search for a **distinct, independently known existing real project decision**, e.g. a stable architecture decision recorded in a normal human session. Repeat with a different topic if no match. A successful genuine-memory acceptance requires:

1. status found, read_only true, omitted_test_data tracked, and no seed marker in returned IDs/source.
2. Same project/branch and expected claim ID, value, Evidence ID, source reference, timestamp and authority class.
3. Independent verification that the originating event was a real user instruction or genuine tool observation, not merely an E2E seed with a user_direct label.
4. No database change, no service startup, no write operation.

A query returning no_current_authorized_match means the database has no eligible result for that query. **Do not invent a user memory or create a fabricated one just to pass acceptance.**

## Isolated verification

The repository's dedicated Windows 2022 and Ubuntu 24.04 job tests the genuine read-only stdio MCP process, real temporary SQLite Evidence and Claims, SHA immutability, test-seed filtering, authority/project isolation, invalid tool arguments and safe local-project configuration.

~~~powershell
node --test tests/memory-engine/codex-readonly-memory-mcp.test.mjs tests/memory-engine/codex-project-memory-scope.test.mjs
~~~

**Out of scope:** Write-Broker, Windows service, production Graph activation, remediation of legacy synthetic rows, independent attestation of the operator's Codex Desktop session, and proof that a genuine non-seed claim is actually present in the user's local DB. C9 G1-G7 and Graph production gates remain NO-GO.
