# Agent Hub

Portable, cross-harness guidance and reusable skills for coding agents.

The Hub keeps shared behavior in one place while separating:

- always-on agent policy;
- reusable skills and domain workflows;
- host-specific runtime capabilities;
- stable knowledge;
- local episodic memory;
- project-local rules and skills.

The public repository is designed to work without maintainer-specific paths,
private transcripts, local memory history, or a required operating system.

## Layout

| Path | Purpose |
|---|---|
| `AGENTS.md` | Always-applicable policy, authority boundaries, and cross-task defaults |
| `SOUL.md` | Voice and working style |
| `CONTEXT.md` | Shared vocabulary |
| `skills/` | Portable reusable workflows and domain skills |
| `agent-runtime/` | Host-neutral runtime preferences and evidence-backed host capabilities |
| `knowledge/` | Stable reference material and the generated skill index |
| `memory/` | Public memory workflow/templates; personal state stays local and ignored |
| `scripts/` | Deterministic validation and maintenance tools |

Project-specific behavior belongs in the project itself, for example
`<project>/.agents/skills/`, instead of being hardcoded into the global Hub.

## Install

The conventional user-level location is `~/.agents`, but the Hub does not
require one concrete home-directory layout.

Clone **this published repository** into that location. Do not clone the
historical private operator checkout.

### macOS / Linux

```sh
git clone https://github.com/Wibias/agent-hub.git "$HOME/.agents"
cd "$HOME/.agents"
```

### Windows PowerShell

```powershell
git clone https://github.com/Wibias/agent-hub.git "$HOME\.agents"
Set-Location "$HOME\.agents"
```

Use the active host's normal instruction-discovery mechanism. Host-specific
configuration belongs outside shared `SKILL.md` files unless the surface is
explicitly portable.

### Codex host setup / upgrade

After cloning or pulling a newer Agent Hub revision, inspect the complete managed Codex
host state with one dry-run-first command:

```powershell
node .\scripts\setup-codex-host.mjs
```

The command checks generated runtime drift before host mutation, plans the Agent Hub
memory hooks, native Codex-memory isolation, and retirement of legacy mutable Agent Hub
runtime profiles, then runs the existing read-only memory doctor.

If the plan is expected, apply only the managed changes:

```powershell
node .\scripts\setup-codex-host.mjs --apply
```

The orchestrator reuses the existing safe installers and backup behavior. It does not
trust changed hooks on the user's behalf. When hook definitions change, restart Codex
and review/trust them through `/hooks`.

Individual scripts remain available for diagnostics, recovery, and narrow maintenance.

## Verify an installation

Requires Node.js for the repository maintenance scripts.

```text
node scripts/verify-public-release.mjs
node scripts/verify-portable-skills.mjs
node scripts/render-agent-runtime.mjs --check
node scripts/verify-skill-routing.mjs
node knowledge/build-index.mjs
```

After rebuilding the index, a clean canonical checkout should have no generated
drift:

```text
git diff --exit-code -- knowledge/INDEX.md knowledge/index.json
```

The release-governance workflow runs the wider deterministic suite in CI.

## Skill discovery

The generated indexes are:

- `knowledge/index.json` for machines;
- `knowledge/INDEX.md` for humans and agents.

The canonical build indexes the Hub itself plus declared external catalogs.
Machine-local host caches and a specific project are opt-in inputs and are not
part of the checked-in public index.

## Local memory

The public repository ships memory **structure**, not a maintainer's history.

Tracked templates:

- `memory/MEMORY.example.md`
- `memory/pending-rules.example.md`
- `memory/README.md`

Local state is ignored:

- `memory/MEMORY.md`
- `memory/pending-rules.md`
- `memory/notes/*.md`

Initialize missing local state with:

```text
node skills/extract-approach/scripts/ensure-memory-state.mjs
```

For the local durable-memory engine, a loopback-only console is available:

```powershell
node .\scripts\memory-ui.mjs
```

Open `http://127.0.0.1:4317` to browse projects, branches, Memories, Inspect,
Pipeline, Health, Quality, and Stale views. The console opens the SQLite memory
database read-only and exposes no mutation endpoints.

## Portability contract

Shared skills should:

- use semantic locations such as `~/.agents`, `<project>`, or an explicitly
  supplied path instead of a maintainer path;
- select shell syntax for the active operating system;
- avoid requiring one host connector, model identifier, or local cache layout;
- treat project-local assumptions as project-local guidance;
- keep secrets, transcripts, session state, and personal memory out of Git.

Runtime preferences and host capability claims live in `agent-runtime/`.

## Changing skills

Before creating, merging, forking, or materially expanding a skill, run the
`skill-ratchet` preflight and follow its qualification contract.

Shared-skill frontmatter or runtime-policy changes should also run:

```text
node scripts/verify-portable-skills.mjs
```

Keep tests focused on observable behavior and stable contracts.

## Third-party material

Some skills are adapted from or integrate with upstream open-source projects.
Keep their source attribution, notices, and component-specific license terms
intact. This README does not replace those notices or declare a new
repository-wide license.
