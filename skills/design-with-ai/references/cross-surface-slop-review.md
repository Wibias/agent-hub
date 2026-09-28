# Cross-surface anti-slop review

Use this only when the task genuinely spans two or more distinct rendered web
surfaces in the same product and asks for consistency, redesign, systemic polish,
or portfolio-level anti-slop review. A single-route task does not load this
reference.

This pass addresses **G02 Macro reuse**. Per-route source and render gates can
show that one page is generic; they cannot establish that several different
product jobs reuse the same macro skeleton.

## Capture

For each relevant route/state at the same representative viewport band:

1. render the real route/state;
2. run the current `scripts/render-snapshot.js` as read-only page evaluation;
3. save the returned JSON outside the product source tree;
4. compare the snapshots together:

```shell
node <skill-base-dir>/scripts/compare-render-snapshots.mjs \
  --snapshot "<route-a.json>" \
  --snapshot "<route-b.json>" \
  --json
```

Add more `--snapshot` arguments when the task spans more surfaces.

Compare desktop with desktop and mobile with mobile. Mixed viewport bands are
reported but are not eligible for G02 because responsive transposition can
legitimately change macrostructure.

## What is measured

The collector records a coarse ordered macro fingerprint for direct visible
surface zones:

- centered hero-like zone;
- repeated-three zone;
- repeated-many zone;
- card-dominant zone;
- content plus action;
- ordinary content;
- broad width band;
- repeated-unit counts.

The comparator uses ordered-zone similarity, repeated-unit archetypes, hero
posture, and zone-count similarity. The current threshold is a **local v1
review heuristic**, not a research-reported probability.

A pair is mechanically eligible only when:

- routes are distinct;
- viewport bands match;
- both snapshots contain at least three macro zones;
- weighted macro similarity meets the registry threshold.

## Adjudication

A G02 lead is not automatically bad. For every flagged pair ask:

1. **Different job?** If both surfaces have materially different first-screen
   jobs, content ownership, or traversal needs, why do they share the same macro
   skeleton?
2. **Shared system or copied template?** A common application shell, wizard step
   family, settings subpage grammar, or approved design-system composition can
   justify repetition.
3. **Content-to-surface assignment:** does each route preserve its own priority
   and repeated-unit model, or has content merely been poured into the same
   containers?
4. **Responsive evidence:** does the similarity persist at the corresponding
   mobile/desktop state?
5. **Project authority:** is the repetition an explicit product/system decision,
   or merely inherited implementation?

The comparator emits only `PASS_CROSS_SURFACE_EVIDENCE` or
`REVIEW_CROSS_SURFACE`. It never emits `HOLD` and never infers AI
authorship.

## Evidence receipt

Record:

```text
cross-surface-evidence: <routes and viewport band>
snapshots: <paths>
verdict: PASS_CROSS_SURFACE_EVIDENCE | REVIEW_CROSS_SURFACE
G02 pairs: <route pairs and similarity>
adjudication: <shared-system justification or revision required>
visual-proof: <screenshots/live browser references>
```

Do not use route count itself as a quality metric. Only compare surfaces that are
actually in scope for the task.
