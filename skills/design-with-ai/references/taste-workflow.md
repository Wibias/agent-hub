# Taste workflow

Use this when direction, genre, macrostructure, visual identity, or anti-slop judgement is active. It is the Direction layer of `design-with-ai`.

## Progress

- [ ] 0 Preflight incumbent product/design truth
- [ ] 1 Design read: audience, surface kind, vibe, genre, colour/type posture
- [ ] 2 Macrostructure and navigation/footer treatment when applicable
- [ ] 3 Signature move, signature artifact, and explicit refusals
- [ ] 4 Build with tokens/direction locked
- [ ] 5 Pre-emit critique
- [ ] 6 Anti-slop mechanical gate
- [ ] 7 Rendered verification

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

Use `critique-protocol.md`. Review Philosophy, Hierarchy, Execution, Specificity, Restraint, and Variety. When hierarchy/grouping/salience is the defect rather than art direction itself, load `perceptual-hierarchy.md`. Revise weak axes before the gate.

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

Check representative desktop/mobile sizes, focus, contrast, state changes, reduced motion, clipping, and interaction. Use the blur/thumbnail diagnostic from `perceptual-hierarchy.md` only when visual focal order is materially in question; it is not a usability verdict. Missing motion is `motion-opportunities`; runtime cost is `motion-optimize`.
