# MCP Tool Security Reference

> Source: mukul975/Anthropic-Cybersecurity-Skills (https://github.com/mukul975/Anthropic-Cybersecurity-Skills), Apache-2.0 License. Adapted 2026-07-10.

> **AUTHORIZED USE ONLY.** Scan only MCP servers you own or are authorized to assess.

Drawn from: auditing-mcp-servers-for-tool-poisoning, securing-agentic-ai-tool-invocation

## Threat Overview

| Threat | Description | ATLAS |
|--------|-------------|-------|
| Tool poisoning | Hidden instructions in tool description hijack agent | AML.T0051.001, AML.T0010 |
| Tool shadowing | Malicious server overrides trusted tool behavior | AML.T0053 |
| Rug pull | Tool description changes after user approved it | AML.T0010 |
| Toxic flow | Tool combination enables exfiltration | AML.T0057 |
| SSRF | URL-fetch tool reaches internal targets | -- |
| Unauth exposure | MCP endpoint requires no credentials | -- |

## Prerequisites

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh   # install uv (for uvx)
pip install requests mcp
```

## Step 1: Static Scan of Installed MCP Configs

```bash
# Scan all auto-discovered MCP configs
uvx mcp-scan@latest

# Scan a specific config file
uvx mcp-scan@latest ~/.vscode/mcp.json

# Machine-readable JSON for CI
uvx mcp-scan@latest --json ~/.cursor/mcp.json > mcp_scan_report.json

# Inspect raw tool/prompt/resource descriptions
uvx mcp-scan@latest inspect ~/.cursor/mcp.json
```

Look for: instructions aimed at the assistant ("do not tell the user", "read ~/.ssh/id_rsa"), nested fake documentation, zero-width/Unicode-smuggled text.

## Step 2: Enumerate Tools Programmatically

```python
# enumerate_tools.py
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    params = StdioServerParameters(command="node", args=["./suspect-mcp-server.js"])
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            for t in tools.tools:
                print(f"{t.name}: {len(t.description or '')} chars")
                print((t.description or "")[:400])

asyncio.run(main())
```

## Step 3: Test URL-Fetching Tools for SSRF (Owned Systems Only)

```python
# ssrf_probe.py -- only use against systems you own
SSRF_TARGETS = [
    "http://169.254.169.254/latest/meta-data/",   # AWS IMDS
    "http://127.0.0.1:22/", "http://localhost:6379/", "file:///etc/passwd",
]
# (connect via MCP ClientSession as in step 2 and call the fetch_url tool)
```

## Step 4: Verify Authentication and Exposure

```bash
# Does SSE/HTTP endpoint respond without credentials?
curl -s -i http://mcp-host:8000/sse | head -n 20

# Check listening interfaces
ss -tlnp | grep -E ':(8000|3000|6277)'
```

An endpoint that returns tool listings without auth is unauthenticated exposure.

## Step 5: Runtime Proxy Guardrails

```bash
uvx --with "mcp-scan[proxy]" mcp-scan@latest proxy
```

## Agentic Tool Invocation Controls

```python
# tool_registry.py
TOOL_POLICY = {
    "search_docs":    {"impact": "read",  "approval": False},
    "create_ticket":  {"impact": "write", "approval": False},
    "send_email":     {"impact": "high",  "approval": True},
    "transfer_funds": {"impact": "high",  "approval": True},
    "run_shell":      {"impact": "high",  "approval": True},
}

# schemas.py -- deny-by-default argument validation
from jsonschema import validate, ValidationError

TOOL_SCHEMAS = {
    "send_email": {
        "type": "object",
        "properties": {
            "to": {"type": "string", "pattern": r"^[^@]+@example\.com$"},
            "subject": {"type": "string", "maxLength": 200},
            "body": {"type": "string", "maxLength": 5000},
        },
        "required": ["to", "subject", "body"],
        "additionalProperties": False,
    },
}

def validate_args(tool: str, args: dict) -> bool:
    schema = TOOL_SCHEMAS.get(tool)
    if schema is None:
        return False   # deny-by-default: unknown tool
    try:
        validate(instance=args, schema=schema)
        return True
    except ValidationError:
        return False
```

Human-in-the-loop (HITL): for `require_approval` decisions, block until an authorized human approves out-of-band. Fail-closed: any timeout or non-approval denies the action.

## Validation Criteria

- [ ] All installed MCP configs statically scanned with mcp-scan
- [ ] Raw tool descriptions inspected for hidden instructions
- [ ] Tool hashes pinned; rug-pull detection enabled
- [ ] URL-fetching tools tested for SSRF against owned targets
- [ ] Authentication and network exposure of remote servers verified
- [ ] Tool allowlist enforced with deny-by-default
- [ ] Per-tool JSON argument schemas validated
- [ ] HITL approval enforced for high-impact tools
- [ ] All invocations audit-logged with actor, tool, arg hash, decision
