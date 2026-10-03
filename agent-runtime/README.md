# Agent runtime policy

Canonical skill behavior stays in `skills/<name>/SKILL.md`. Host-specific runtime choices such as model class, reasoning effort, isolation, turn budgets, and tool restrictions stay outside shared skills.

This directory is the Hub's source of truth for that separation.

## Files

- `skill-runtime.json` - sparse, host-neutral runtime preferences. Unlisted skills inherit defaults.
- `host-capabilities.json` - evidence-backed statements about what each host currently supports.
- `portable-skill-exceptions.json` - exact reviewed exceptions for legacy/external top-level skill frontmatter.
- `generated/*.md` - deterministic capability reports generated from the registries.
- `generated/codex-profiles/` - deterministic Codex reasoning profiles plus a manifest; generated only for the verified renderer surface.

## Commands

```powershell
node scripts/verify-portable-skills.mjs
node scripts/render-agent-runtime.mjs
node scripts/render-agent-runtime.mjs --check
node scripts/render-agent-runtime.mjs --emit-config codex
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


## Codex reasoning profiles

Codex is the first host with a supported runtime config renderer.

The renderer uses only the verified one-to-one mapping:

```text
Agent Hub reasoning -> Codex model_reasoning_effort
```

It deliberately does **not** map Agent Hub `isolation` to `sandbox_mode`, or
`mutation` to approval/sandbox keys. Those concepts are not equivalent. Non-inherited
values remain visible in the generated manifest and TOML comments as unmapped semantics.

Generated artifacts live under:

```text
agent-runtime/generated/codex-profiles/
```

Each file is named after its manual Codex profile, for example:

```text
agent-hub-diagnose.config.toml
```

Install a selected profile by copying it beside `$CODEX_HOME/config.toml`, then start
Codex with the matching profile name:

```powershell
Copy-Item .\agent-runtime\generated\codex-profiles\agent-hub-diagnose.config.toml `
  (Join-Path $env:USERPROFILE ".codex\agent-hub-diagnose.config.toml")

codex --profile agent-hub-diagnose
```

Profile activation remains manual because the capability registry still marks
`skillModelRouting` unsupported. The renderer does not change the user's model choice;
it emits only `model_reasoning_effort`.
