# Claude Code runtime capability report

Generated from `agent-runtime/host-capabilities.json` and `agent-runtime/skill-runtime.json`. Do not hand edit.

- reviewed: 2026-10-03
- agentsRoot: unsupported
- skillModelRouting: unsupported
- config renderer: unsupported
- lifecycle hooks: supported
- command hooks: supported
- plugin-bundled hooks: supported
- hook events: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SubagentStart, SubagentStop, Stop, SessionEnd
- agent profiles: manual
- note: General Claude Code host-config rendering remains unsupported. Documented lifecycle command hooks are supported; the read-only memory integration uses UserPromptSubmit through the explicit Claude Code hook adapter.

## Sources

- https://code.claude.com/docs/en/hooks
- https://github.com/addyosmani/agent-skills/blob/main/docs/advanced-per-agent-configuration.md

## Semantic runtime preferences

| skill | reasoning | isolation | mutation |
|---|---|---|---|
| (default) | inherit | inherit | inherit |
| code-simplification | medium | inherit | inherit |
| codebase-design | high | inherit | inherit |
| codex-dynamic-workflows | high | prefer | inherit |
| design-with-ai | high | inherit | inherit |
| diagnose | high | prefer | inherit |
| improve-codebase-architecture | high | prefer | inherit |
| security-review | high | prefer | read-only |
| source-driven-development | medium | inherit | inherit |
| writing-ticks | low | inherit | inherit |

These are Hub preferences, not claims that this host can enforce each field. Host capability state above is authoritative.
