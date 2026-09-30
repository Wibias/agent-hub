# OpenAI Codex runtime capability report

Generated from `agent-runtime/host-capabilities.json` and `agent-runtime/skill-runtime.json`. Do not hand edit.

- reviewed: 2026-09-30
- agentsRoot: supported
- skillModelRouting: unsupported
- config renderer: unsupported
- lifecycle hooks: supported
- command hooks: supported
- plugin-bundled hooks: supported
- hook events: SessionStart, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, SubagentStart, SubagentStop, Stop, Interrupt, SessionEnd
- shared skill root: `~/.agents/skills`
- agent profiles: manual
- note: General Codex host-config rendering remains unsupported. Documented lifecycle command hooks are supported; the memory integration uses UserPromptSubmit through the explicit Codex hook adapter.

## Sources

- https://developers.openai.com/docs/hooks
- https://developers.openai.com/plugins/build/plugins

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
