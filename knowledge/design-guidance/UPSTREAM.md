# Design guidance provenance

This is a small local guidance catalog for `design-with-ai`, not a mirror of an upstream UI corpus.

Adapted concepts were reviewed from:

- repository: `nextlevelbuilder/ui-ux-pro-max-skill`
- snapshot: `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03`
- reviewed: 2026-10-28
- licence: MIT
- primary upstream material: the bounded-search contract, chart/native/UX guidance, current provenance metadata, and relevance-regression mechanics in the upstream skill/data/scripts

The prior Agent Hub snapshot was `f3ac195224eac1eb0dfe1a3059c2a6add78ffbe3` (reviewed 2026-09-04). The 2026-10-28 refresh reviewed the 38-commit upstream delta and selectively adopted lifecycle/retrieval-governance ideas rather than expanding the local recommendation corpus.

The local records are rewritten and narrowed. Product-to-style, product-to-palette, font-pairing, landing-pattern, motion-preset, and generic stack recommendation corpora are intentionally not imported. The allowed domains remain `chart`, `native`, `interaction`, `text-layout`, and `accessibility`.

## Freshness and relevance

The catalog records its reviewed upstream snapshot plus explicit review and hard-expiry windows. Query output exposes freshness status. A hard-expired catalog fails closed instead of presenting stale results as verified guidance.

Representative relevance cases pin important semantic queries to their expected top record. Upstream refreshes must rerun those cases so a search/runtime change cannot silently change the local guidance meaning.

Guidance records are heuristics. They do not count as tested or observed design evidence and never override project rules, current platform documentation, accessibility requirements, user direction, or rendered evidence.
