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

Use 2-6 meaningful terms around one observable question. Prefer an explicit domain. Read the returned record identity, guidance, avoid condition, accessibility note, provenance, and freshness status before applying it.

- exit `0`: at least one catalog match; inspect `freshness.status` (`current` or `review-due`);
- exit `2`: no verified catalog match;
- exit `3`: the catalog is hard-expired and must be refreshed/reviewed before results may be treated as verified guidance;
- other non-zero: tool, argument, or catalog-configuration failure.

When exit `2` occurs, retry **once** with a narrower semantic rewrite. If that still returns no match, stop querying and continue from project evidence, current standards, or clearly labelled general reasoning. Never present a fallback as a catalog match.

When freshness is `review-due`, the record remains bounded heuristic guidance but its age is part of the decision. Prefer current official platform/accessibility material for time-sensitive details and schedule an upstream review rather than silently treating the snapshot as fresh. When exit `3` occurs, do not use the stale catalog result at all; refresh the source or fall back explicitly to project evidence/current standards.

`DESIGN_GUIDANCE_NOW=YYYY-MM-DD` exists only to make tests/reproducible evaluation deterministic. Normal runs use the current UTC date.

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

Source lineage: adapted from the bounded-search and provenance/relevance-governance mechanics of `nextlevelbuilder/ui-ux-pro-max-skill` (MIT), reviewed at commit `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03` on 2026-10-28 and narrowed to the local `design-with-ai` ownership and evidence model.
