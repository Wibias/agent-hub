# CONTEXT.md — shared language

Agent vocabulary for this hub. Identity: `SOUL.md`. Routing and policy: `AGENTS.md`.

## Agent stack

- **Hub** — this directory (`~/.agents` when installed as the user hub) is the single source of truth
- **SOUL** — only this hub’s `SOUL.md` is canonical (no tool-local forks)
- **Known harnesses** — Codex, Claude Code, Cursor, Grok; examples, not a requirement or exhaustive compatibility list
- **Skills** — `skills/` (flat layout)
- **Rules** — `rules/`
- **Knowledge** — `knowledge/` (stable facts; generated indexes may be local-only)
- **Memory** — `memory/` (episodic lessons; see `memory/README.md` — no separate `learnings/` tree)

## Cross-project terms

| Term                     | Meaning                                                   |
| ------------------------ | --------------------------------------------------------- |
| **Green Gate**           | Tests, doctor, and lints green before handoff             |
| **Blast Radius**         | Count of modules/files a change touches                   |
| **Screenshot-Check**     | UI not done until live browser proof                      |
| **Close the Loop**       | Agent verifies output via CLI, tests, or screenshots      |
| **Harness is the model** | System form (rules, hooks, gates) beats raw model upgrade |
