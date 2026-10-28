# Design Foundations Refresh

## Intent

Strengthen the existing `design-with-ai` owner with selected design-foundation and knowledge-governance ideas from Webdesign Journal and the current `nextlevelbuilder/ui-ux-pro-max-skill` upstream without creating a new discovery skill or importing a category-driven style corpus.

## Goals

- Add a bounded perceptual-hierarchy contract for grouping, similarity, figure/ground, continuity, emphasis, and blur/thumbnail hierarchy checks.
- Make visual-intent language explicit enough to guide both creation and critique without turning adjectives into stereotype-to-style mappings.
- Expand the durable design contract with imagery grammar, brand/asset constraints, positive/negative examples, and AI-generated-image rules when such assets are in scope.
- Refresh `ui-ux-pro-max-skill` provenance from the 2026-09-04 snapshot to current reviewed commit `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03`.
- Add deterministic freshness metadata and relevance-regression coverage to the local `knowledge/design-guidance` catalog.
- Remove category/signal presets from `dials.md`; variance, motion, and density must be derived from user intent, incumbent project truth, inspected references, or an explicitly chosen direction.

## Non-goals

- No new `ui-ux-pro-max` or Webdesign Journal skill.
- No wholesale import of upstream style, palette, font-pairing, landing-pattern, motion-preset, or generic stack datasets.
- No automatic visual direction from product category (`finance -> blue`, `luxury -> glass`, `AI -> purple`, etc.).
- No second design-system source of truth or mandatory file hierarchy.
- No claim that practitioner articles are usability evidence; they remain interpreted guidance/inspiration unless stronger evidence exists.

## Architecture

`design-with-ai` remains the sole ordinary visible-product-UI owner. New fundamentals are progressive references inside its existing load graph. The local design-guidance catalog remains heuristic guidance, separate from observed/tested evidence, but gains explicit upstream snapshot/freshness metadata plus relevance cases that pin important queries to expected records.

Authority order remains: explicit user/product truth -> project design authority -> current official platform/accessibility requirements -> observed/tested/source-backed evidence -> local heuristic guidance -> generic model priors.

## Behavioral contracts

### Perceptual hierarchy

When hierarchy or grouping is materially in question, inspect:

- proximity and common-region grouping;
- similarity only when similar treatment reflects similar semantics;
- connectedness and continuity where flows/steps are shown;
- figure/ground separation for primary content/actions;
- visual weight versus semantic priority;
- competing accents and accidental salience.

For rendered web work, a blur/thumbnail check may be used as a diagnostic: after defocus/downscale, the intended focal order should remain legible. It is not a standalone usability proof.

### Visual intent language

Direction work records a small desired/avoid vocabulary and a tension statement. Each word must map to observable choices or refusals. Generic words such as `modern`, `clean`, `premium`, or `sleek` are insufficient without operational meaning.

### Design dials

Keep the three existing dials: `DESIGN_VARIANCE`, `MOTION_INTENSITY`, `VISUAL_DENSITY`. Remove product-category and signal-word presets. Calibrate from explicit direction, incumbent measurements, or inspected references. If unresolved and material, expose alternatives instead of silently choosing a preset.

### Durable contract

When imagery/brand assets are in scope, the durable contract may include imagery style, subject/motif rules, crop/composition/light treatment, icon/illustration grammar, logo/asset usage constraints, prohibited motifs, positive/negative examples, and AI-generated-image constraints. Existing project-native brand/design authority still wins.

### Guidance governance

The local catalog records the reviewed upstream snapshot and a freshness policy. Query output exposes freshness status. A catalog beyond its hard-expiry window must not be presented as verified guidance. Relevance regression cases pin representative queries to expected top result IDs and prevent silent retrieval drift.

## Sources

- Webdesign Journal design foundations index, visual hierarchy / Gestalt material, design-language article, and current styleguide article. Treat as practitioner/interpreted guidance, not tested evidence.
- `nextlevelbuilder/ui-ux-pro-max-skill`, MIT, reviewed at commit `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03` on 2026-10-28.

## Acceptance

- Existing `design-with-ai` routing/ownership remains unchanged.
- New tests fail on the old branch state and pass after implementation.
- Existing design-with-ai test suites remain green.
- Skill Ratchet structural validation and repository governance pass.
- No forbidden category-driven corpus/domain is added.
