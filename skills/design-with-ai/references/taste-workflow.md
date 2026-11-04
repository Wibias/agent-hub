# Taste workflow

Use this when direction, genre, macrostructure, visual identity, or anti-slop judgement is active. It is the Direction layer of `design-with-ai`.

## Progress

- [ ] 0 Preflight incumbent product/design truth
- [ ] 1 Design read: audience, surface kind, vibe, genre, colour/type posture
- [ ] 2 Macrostructure, role-specific style allocation, and navigation/footer treatment when applicable
- [ ] 3 Signature move, signature artifact, and explicit refusals
- [ ] 4 Build with tokens/direction locked
- [ ] 5 Pre-emit critique
- [ ] 6 Anti-slop mechanical gate
- [ ] 7 Rendered verification and finding-to-outcome reconciliation

## 0. Preflight

Read project design/product docs, tokens, fonts, assets, motion conventions, and representative components. Existing project truth beats generic defaults.

## 1. Design read

State the interpretation in one line. Use `dials.md`, `genres.md`, and
`color-strategy.md` only when the decision needs them. Pick a real direction,
not a colour-swap variant.

Record a compact visual-intent vocabulary before using generic adjectives as design rationale: put the **desired** terms and **avoid** terms on one line, add one **tension statement** such as `precise but not sterile`, and map each term to at least one **observable design choice** or explicit refusal. Words such as `modern`, `clean`, `premium`, and `sleek` are insufficient by themselves; operationalize them into structure, type, palette, density, materiality, imagery, motion, or a concrete refusal.

Before filling a high-impact design choice from generic model priors, classify
its source as one of: incumbent project truth, explicit user/reference
direction, task or information semantics, a deliberate new direction, or
unresolved. Apply this to macrostructure, palette source, typography source,
density/radius posture, component language, motion posture, and trust/status
content. The visual-intent vocabulary describes an approved or proposed direction; it does not convert product-category labels into style defaults.

If a material choice remains unresolved and different choices would produce
meaningfully different products, expose distinct directions instead of silently
selecting the statistical median. Do not replace one familiar default recipe
with another anti-slop house style.

## 2. Macrostructure

For page/surface work use `macrostructures.md` and `pattern-vocabulary.md`. Component-only work may skip macrostructure and use `states-interaction.md`. Avoid generic SaaS scaffolds when the product does not demand them.

## 2a. Allocate the visual language by job, not by page

A coherent visual world is a shared grammar, not a requirement to apply the
same treatment to every component. Before generating a full surface or restyle,
make a short **role-to-treatment map** for the materially different content
roles in scope. Use actual product semantics rather than a generic component
catalog. For each role, name:

- the information or action the user needs from it;
- its scanning/interaction priority and relevant state;
- the chosen typography, spacing, containment, separators, and color roles;
- why its treatment should match or differ from neighboring roles.

Distinguish at least the roles actually present, such as overview/comparison,
primary work object, actionable queue, sequential onboarding, detailed
configuration, preview, and supporting reference content. These examples are
not mandatory components or a prescribed arrangement. Comparable items can
share geometry; different jobs should not inherit identical visual weight
merely because a style preset made it convenient.

### Overcorrection check

Compare the inherited/default style with the proposed one and ask whether
the change merely **replaces a dominant motif** (e.g., a wall of dark cards
becomes a wall of hairline dividers, or colored pills become monospace labels).
Inspect a representative viewport for unnecessary uniform use of separators,
box edges, backgrounds, tracked micro-labels, or accent. A deliberate ledger
or high-density data table may validly repeat rules; a wizard, editor, preview,
and comparison view should not all look like the same ledger by reflex.

Do not prohibit beige, dark UIs, monospace, blue accents, cards, or dividers.
Judge repetition by purpose, not by raw counts. If the new motif treats
semantically unrelated regions alike, redistribute visual emphasis and
component grammar before selecting another palette or visual preset.
Preserve accepted brand tokens and locked constraints; this is not an
authorization to redesign purpose or information architecture.

### Style-independent check

Temporarily disregard the palette and decorative materiality while judging
task clarity, priority, readability, navigation, action discoverability,
status meaning, and responsive behavior. If those fail, visual consistency
cannot rescue the design. Then judge whether the selected art direction
expresses this product specifically. These are separate decisions:
`FUNCTIONAL_QUALITY` and `VISUAL_DIRECTION_FIT` may disagree.

## 3. Signature and refusals

Use `signature-moves.md` and, for marketing surfaces, `pols-slop.md`. Choose one recognisable move/artifact and record 3-5 defaults this product will not use.

For compact internal utilities, derive the signature from the task rather than inventing a brand mark. A state treatment, direct action path, or information-dense summary can carry identity. Apply the removal test: delete each proposed ornamental element mentally; if comprehension, state recognition, and action choice do not change, it must not ship. Load `utility-surfaces.md` for browser popovers and embedded settings tools.

## 4. Build

Lock tokens before broad generation. Load only relevant references:

| Need | Reference |
|---|---|
| Colour strategy | `color-strategy.md` |
| Genre/dials | `genres.md`, `dials.md` |
| Perceptual hierarchy/grouping | `perceptual-hierarchy.md` |
| Design systems/icons | `design-systems.md` |
| Motion system craft | `motion-systems.md`, `standards.md` |
| Spring vs easing | `spring-decision.md` |
| CSS implementation recipes | `recipes.md` |
| Interactive states | `states-interaction.md` |
| Screenshot/reference extraction | `taste-dna.md` |
| Copy authenticity | `copy-authenticity.md` |
| Spacing critique | `spacing-critique.md` |
| Named visual presets | `../presets/*.md` |

Baseline and micro craft are separate internal phases owned by `quality-stack.md`; they are not sibling skills.

## 5. Critique

Use `critique-protocol.md`. Review Philosophy, Hierarchy, Execution, Specificity, Restraint, and Variety. For an iterative change, use its finding-to-outcome ledger: compare the candidate against documented baseline defects, acceptance conditions, and carried-forward findings rather than treating a different visual style as a fix. When hierarchy/grouping/salience is the defect rather than art direction itself, load `perceptual-hierarchy.md`. Revise weak axes before the gate.

## 6. Gate

```powershell
pwsh -File "$env:USERPROFILE\.agents\skills\design-with-ai\scripts\taste-gate.ps1" -Path "<files or dir>"
```

When a documented intent/exception contract applies, add
`-IntentPath "<intent.json>"`. Each exception must name a contextual rule or
family, scope, and concrete reason. It cannot suppress a hard gate.

Walk `anti-slop-gates.md`; for brand/marketing work also use relevant
`pols-slop.md` sections. `REVIEW_CLUSTER` means several independent
contextual default families co-occur; it is a review lead, not proof that the
surface is AI-generated and not an automatic block. Mechanical scanning is a
lead; rendered UI is ground truth.

## 7. Verify

Check representative desktop/mobile sizes, focus, contrast, state changes, reduced motion, clipping, and interaction. Where matched before/after evidence exists, report issue disposition and in-scope route coverage. If it is missing, mark comparative improvement unverified; preserve open findings for the next iteration. Use the blur/thumbnail diagnostic from `perceptual-hierarchy.md` only when visual focal order is materially in question; it is not a usability verdict. Missing motion is `motion-opportunities`; runtime cost is `motion-optimize`.
