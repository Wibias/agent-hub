# OpenAI Codex runtime capability report

Generated from `agent-runtime/host-capabilities.json` and `agent-runtime/skill-runtime.json`. Do not hand edit.

- reviewed: 2026-10-03
- agentsRoot: supported
- skillModelRouting: unsupported
- config renderer: supported
- lifecycle hooks: supported
- command hooks: supported
- plugin-bundled hooks: supported
- hook events: SessionStart, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, SubagentStart, SubagentStop, Stop, Interrupt, SessionEnd
- shared skill root: `~/.agents/skills`
- agent profiles: manual
- note: Codex profile rendering is supported for the verified 1:1 mapping reasoning -> model_reasoning_effort. Skill-to-profile activation remains manual because skillModelRouting is unsupported. Isolation and mutation remain semantic Hub preferences and are emitted only as unmapped metadata/comments, not translated to sandbox or approval settings.

## Sources

- https://developers.openai.com/docs/config-file/config-reference
- https://developers.openai.com/docs/config-file/config-basic
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
