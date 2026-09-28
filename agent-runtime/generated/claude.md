# Claude Code runtime capability report

Generated from `agent-runtime/host-capabilities.json` and `agent-runtime/skill-runtime.json`. Do not hand edit.

- reviewed: 2026-09-04
- agentsRoot: unsupported
- skillModelRouting: unsupported
- config renderer: unsupported
- agent profiles: manual
- note: The Hub keeps Claude-specific orchestration out of shared skills. Renderer remains disabled until this repository locks a current official/local schema and tests it.

## Sources

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
