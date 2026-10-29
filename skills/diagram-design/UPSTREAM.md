# diagram-design upstream

`diagram-design` is an Agent Hub ownership layer over a pinned, selectively vendored snapshot of `cathrynlavery/diagram-design`.

## Reviewed source

- Repository: `cathrynlavery/diagram-design`
- Commit: `0cf73c3fcc56667ad91a9a04c439ac6ccfabc9d1`
- Release manifest at review: `2.6.136`
- Reviewed: 2026-10-28
- Licence: MIT, preserved in `LICENSE.upstream`

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
