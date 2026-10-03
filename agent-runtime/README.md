# Agent runtime policy

Canonical skill behavior stays in `skills/<name>/SKILL.md`. Host-specific runtime choices such as model class, reasoning effort, isolation, turn budgets, and tool restrictions stay outside shared skills.

This directory is the Hub's source of truth for that separation.

## Files

- `skill-runtime.json` - sparse, host-neutral runtime preferences. Unlisted skills inherit defaults.
- `host-capabilities.json` - evidence-backed statements about what each host currently supports.
- `portable-skill-exceptions.json` - exact reviewed exceptions for legacy/external top-level skill frontmatter.
- `generated/*.md` - deterministic capability reports generated from the registries.
- `generated/codex-runtime/` - deterministic Codex runtime-launch manifest for the verified CLI-override surface.

## Commands

```powershell
node scripts/verify-portable-skills.mjs
node scripts/render-agent-runtime.mjs
node scripts/render-agent-runtime.mjs --check
node scripts/render-agent-runtime.mjs --emit-config codex
node scripts/setup-codex-host.mjs
```

`verify-portable-skills.mjs` scans only top-level Hub skills (`skills/*/SKILL.md`). Nested vendored/internal skill trees are governed by their own owner unless promoted to the Hub discovery surface.

## Portability contract

Portable shared top-level frontmatter keys are:

- `name`
- `description`
- `license`
- `compatibility`
- `metadata`
- `allowed-tools`

A host/vendor extension at the top level is rejected unless `portable-skill-exceptions.json` permits that exact key for that exact file. Exceptions are migration/ownership facts, not precedent for new skills.

Runtime preferences use semantic values rather than concrete model IDs:

- `reasoning`: `inherit | low | medium | high | xhigh`
- `isolation`: `inherit | none | prefer | required`
- `mutation`: `inherit | read-only | writes-with-authority`

The registry expresses preference, not a claim that every host can enforce it. A host report must show unsupported/manual capabilities honestly.

## Host adapters

Do not generate host configuration until `host-capabilities.json` names a supported renderer backed by current host documentation and tests. A plausible-looking file that the host ignores is worse than no adapter.

When a renderer is eventually added, keep shared skills unchanged and generate the host-local agent/profile resource from this registry.


## Codex runtime launch overrides

Codex is the first host with a supported runtime renderer, but the renderer no longer
installs named Codex profile files.

The verified mapping remains:

```text
Agent Hub reasoning -> Codex model_reasoning_effort
```

The activation mechanism is now an ephemeral Codex CLI config override:

```text
-c model_reasoning_effort="<effort>"
```

Codex gives CLI config overrides higher precedence than project, named-profile, and user
configuration. Agent Hub therefore applies the skill reasoning preference for the launched
session without changing the user's selected model or persistent defaults.

This change is deliberate. Current Codex resolves `--profile <name>` by using
`$CODEX_HOME/<name>.config.toml` as the selected user config path. Local TUI settings
write back to that selected user file. In practice, using `/model` inside an Agent Hub
named profile can rewrite the generated reasoning value and add a model choice. Mutable
named profiles are therefore unsuitable as Agent Hub's runtime-policy source of truth.

Generated runtime metadata lives under:

```text
agent-runtime/generated/codex-runtime/manifest.json
```

Inspect a launch without starting Codex:

```powershell
node .\scripts\run-codex-runtime.mjs diagnose --dry-run
```

Start an interactive Codex session with the `diagnose` runtime preference:

```powershell
node .\scripts\run-codex-runtime.mjs diagnose
```

Forward Codex arguments after `--`:

```powershell
node .\scripts\run-codex-runtime.mjs diagnose -- --search
node .\scripts\run-codex-runtime.mjs source-driven-development -- exec "inspect the current change"
```

On Windows the launcher uses `codex.exe`; on other platforms it uses `codex`.
`CODEX_BIN` or `--codex PATH` can override the executable.

The launcher maps only `reasoning`. It deliberately does **not** translate Agent Hub
`isolation` to `sandbox_mode`, or `mutation` to approval/sandbox settings. Those
concepts are not equivalent. Non-inherited values remain visible as unmapped metadata.

### Retiring legacy Agent Hub Codex profiles

Agent Hub versions that used the earlier named-profile renderer may have installed
`agent-hub-*.config.toml` files into `$CODEX_HOME` / `~/.codex`.

Inspect them without mutation:

```powershell
node .\scripts\retire-codex-runtime-profiles.mjs
```

Back up every matching legacy Agent Hub profile and then remove only the original
`agent-hub-*.config.toml` files:

```powershell
node .\scripts\retire-codex-runtime-profiles.mjs --apply
```

The retirement tool does not touch `config.toml` or unrelated profile names and refuses
symlinked managed files.

`install-codex-runtime-profiles.mjs` is retained only as a fail-closed migration notice;
it no longer installs mutable profile files.

Skill activation remains manual because the capability registry still marks
`skillModelRouting` unsupported. The runtime launcher never pins the model; it injects
only `model_reasoning_effort`.
