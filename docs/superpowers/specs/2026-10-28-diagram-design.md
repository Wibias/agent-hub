# Diagram Design Skill Spec

## Intent

Add one canonical Agent Hub owner for polished, publishable diagrams while preserving the semantic ownership of architecture, formal verification, UX/service design, product data visualization, and Git-native living documentation.

## Goals

- Add `diagram-design` as the discovery owner when the user asks to draw, render, publish, brand, or export a diagram or visual schematic.
- Preserve upstream diagram-design's high-quality HTML/SVG output, type-specific references, import/export helpers, branding profiles, and layout doctrine.
- Vendor a pinned MIT snapshot of the upstream skill's references/assets/scripts so the capability works offline and remains reproducible.
- Keep the Agent Hub `SKILL.md` as the routing/orchestration owner and preserve the upstream contract as provenance/reference material.
- Prefer self-contained HTML + inline SVG for publishable artifacts; export SVG/PNG when requested and tooling is available.
- Keep Mermaid/PlantUML as the better fit for frequently edited Git documentation when the user wants a living source representation.

## Non-goals

- Do not make `diagram-design` decide software architecture.
- Do not make it the source of truth for a formally verified state machine.
- Do not replace `intent` for service blueprint/user journey semantics.
- Do not replace `design-with-ai` for charts inside product UI.
- Do not replace a user-requested Mermaid/PlantUML source artifact with a static SVG merely for aesthetics.
- Do not add a second independent brand/design token truth when the project already has one.

## Ownership

`diagram-design` owns visual representation, layout, editorial hierarchy, branding, and publishable output for diagrams.

Neighboring owners:

- `codebase-design` owns module boundaries and architecture decisions.
- `formal-verification` owns code-bound statechart/model truth and proof obligations.
- `intent` owns journey/service blueprint content and UX strategy.
- `design-with-ai` owns product-UI charts and visible product surfaces.
- `github-delivery` may use Mermaid in PR descriptions as living delivery documentation.

When another owner provides the semantic model, `diagram-design` consumes that model and renders it. It does not reinterpret or silently change the underlying truth.

## Upstream snapshot

Vendor from `cathrynlavery/diagram-design` commit `0cf73c3fcc56667ad91a9a04c439ac6ccfabc9d1` (release 2.6.136), MIT.

Copy into `skills/diagram-design/`:

- `assets/`
- `references/`
- `scripts/`
- upstream `SKILL.md` preserved as `references/upstream-skill.md`
- upstream repository `LICENSE` preserved as `LICENSE.upstream`

Agent Hub supplies its own top-level `SKILL.md`, `UPSTREAM.md`, and Skill Ratchet evals.

## Verification

- Validate skill routing and neighboring-owner boundaries.
- Validate Skill Ratchet structure and retained regressions.
- Use upstream doctor/layout/export checks when an actual diagram is generated.
- A generated diagram is not complete merely because HTML parses; visual overlap/clipping/readability checks must pass when tooling exists.
- Keep generated Agent Hub knowledge indexes current.
