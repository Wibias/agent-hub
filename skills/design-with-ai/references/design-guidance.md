# Deterministic design guidance

Use this reference only when a concrete product-UI decision needs bounded heuristic guidance that is not already resolved by project truth, observed evidence, or a selected visual world.

This is **guidance, not evidence**. The catalog may frame options or expose failure modes. It cannot prove usability, choose art direction by product stereotype, or override current platform documentation.

## Query contract

From the Agent Hub root:

```text
node knowledge/design-guidance/scripts/query.mjs --domain <domain> --query "<one dominant intent>" --json
```

Domains are intentionally limited to:

- `chart`
- `native`
- `interaction`
- `text-layout`
- `accessibility`

Use 2-6 meaningful terms around one observable question. Prefer an explicit domain. Read the returned record identity, guidance, avoid condition, accessibility note, and provenance before applying it.

- exit `0`: at least one catalog match;
- exit `2`: no verified catalog match;
- other non-zero: tool/argument failure.

When exit `2` occurs, retry **once** with a narrower semantic rewrite. If that still returns no match, stop querying and continue from project evidence, current standards, or clearly labelled general reasoning. Never present a fallback as a catalog match.

## Authority order

1. explicit user direction and product truth;
2. project design rules, tokens, components, and accepted design source of truth;
3. current official platform/accessibility requirements when applicable;
4. observed/tested/source-backed evidence from `source-evidence.md` and `reference-library.md`;
5. this guidance catalog;
6. generic model priors.

A catalog result never unlocks a `LOCKED` design dimension in the contract ledger.

## Forbidden shortcut

Do not derive visual world, palette, typography, motion intensity, or landing structure from product category alone. The local catalog deliberately contains no style, palette, font, landing, or motion-preset domain.

`finance -> dark blue`, `luxury -> glass`, `AI -> purple`, and similar category mappings are anti-evidence shortcuts, not deterministic design intelligence.

## Use with source evidence

Guidance records use `sourceType: heuristic-guidance`. They do not count toward the inspected-reference minimums in `source-evidence.md` and cannot satisfy `TESTED` or `OBSERVED` evidence requirements.

Map every used result to one decision or open question. If the result conflicts with the real render or source-backed evidence, the result loses.

Source lineage: adapted from the bounded-search mechanics of `nextlevelbuilder/ui-ux-pro-max-skill` (MIT), narrowed to the local `design-with-ai` ownership and evidence model.
