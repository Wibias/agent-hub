# Grok Build runtime capability report

Generated from `agent-runtime/host-capabilities.json` and `agent-runtime/skill-runtime.json`. Do not hand edit.

- reviewed: 2026-09-04
- agentsRoot: supported
- skillModelRouting: unsupported
- config renderer: unsupported
- shared skill root: `~/.agents/skills`
- agent profiles: supported
- compatible agent roots: `.claude/agents`
- note: Grok documents that model/effort fields in skill frontmatter are not applied. Keep routing outside shared skills.

## Sources

- https://docs.x.ai/build/features/skills-plugins-marketplaces

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
