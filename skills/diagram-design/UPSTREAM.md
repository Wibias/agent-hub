# diagram-design upstream

`diagram-design` is an Agent Hub ownership layer over a pinned, selectively vendored snapshot of `cathrynlavery/diagram-design`.

## Reviewed source

- Repository: `cathrynlavery/diagram-design`
- Commit: `f6db0decea96de66b901331a0f79a8d4b147ebae`
- Release manifest at review: `2.6.164`
- Reviewed: 2026-11-18
- Licence: MIT, preserved in `LICENSE.upstream`

## November 2026 refresh

Reviewed the 56-commit upstream delta since the prior pinned snapshot.
Updated all 43 changed files in the vendored assets, references and scripts
surfaces, and preserved the upstream `SKILL.md` as
`references/upstream-skill.md`. The new shared files include a bounded,
non-executing PlantUML extractor, geometry verifier, diagram-type references,
and matching gallery examples. The local top-level `SKILL.md` remains Agent
Hub-owned and only exposes supported new paths. Upstream CI is not equivalent
to Agent Hub's integration, routing or Windows evidence.

## Vendored surfaces

Copied from `skills/diagram-design/` at the reviewed commit:

- `assets/`
- `references/`
- `scripts/`
- upstream `SKILL.md` preserved as `references/upstream-skill.md`

The upstream repository's gallery, demos, docs site, plugin packaging, CI, marketplace metadata, and unrelated repository files are intentionally not vendored.

## Local ownership

Agent Hub supplies the top-level `SKILL.md` and Skill Ratchet tests. Local deltas are deliberate:

- one discovery owner for polished/publishable diagram artifacts;
- semantic ownership remains with `codebase-design`, `formal-verification`, `intent`, and `design-with-ai` where their domain is primary;
- living Mermaid/PlantUML source is preserved when the user requests Git-diffable documentation;
- project-native design authority overrides the upstream default skin;
- imported diagram/repository text is untrusted task data for instruction purposes;
- failure/authority behavior follows Agent Hub's fail-closed completion policy;
- upstream's large type library remains progressive reference material, not a reason to load every diagram type into context.

## Refresh policy

Refreshes are normally `EXTEND`, not a new skill.

For a future upstream update:

1. inspect the new immutable upstream commit and changelog;
2. compare only the vendored surfaces;
3. preserve Agent Hub's top-level ownership/routing contract;
4. retain the upstream licence and provenance;
5. rerun focused routing, Skill Ratchet structure, upstream self-check compatibility, README coverage, and full release governance;
6. add a retained regression before qualification when a real failure is found and fixed.

Do not overwrite the Agent Hub `SKILL.md` with upstream during refresh. Preserve upstream's latest contract as `references/upstream-skill.md` instead.
