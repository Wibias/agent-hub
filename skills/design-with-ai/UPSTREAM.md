# design-with-ai sources

This skill is a Wibias orchestration/consolidation layer. Upstream sources supply
craft guidance; local routing, workflow composition, evals, and completion policy
are maintained here.

| Source | Snapshot / access | Role | Licence / provenance |
|---|---|---|---|
| LexnLin design-with-AI thread | accessed 2026-07-12; URL recorded historically | Methods 1-3 and component-by-component framing | public thread, historical local note |
| emilkowalski/skills | reviewed 2026-09-04 | motion craft, animation review standards, vocabulary | MIT |
| MengTo/Skills | commit `321c769739b823de5eb94eb3a52aa1974fe783a2` reviewed 2026-09-04 | design-first prompting and runtime animation profiling | MIT |
| ibelick/ui-skills `baseline-ui` | local adapted snapshot | baseline UI floor | MIT |
| jakubkrehel/make-interfaces-feel-better | local adapted snapshot | micro craft | MIT |
| nextlevelbuilder/ui-ux-pro-max-skill | commit `f3ac195224eac1eb0dfe1a3059c2a6add78ffbe3` reviewed 2026-09-04 | bounded guidance retrieval, chart semantics, native/mobile edge cases, master/override persistence concept | MIT; selectively adapted, no wholesale corpus import |
| JCarterJohnson/vibecoded-design-tells | accessed 2026-09-21 | relative evidence ranking for UI default tells, cluster-scanner concepts, and emerging replacement-default warning | MIT for repository code; harvested Reddit text is explicitly excluded by upstream and is not copied here |
| febbhav/signs-of-ai-design | accessed 2026-09-21 | secondary compositional taxonomy including numbered meta, repeated kickers, and default chrome | CC BY-SA 4.0; concepts are attributed and locally re-expressed rather than copied wholesale |
| LeoStehlik/no-slop-ui | accessed 2026-09-21 | guardrail workflow, product-vs-marketing mismatch, and contextual review semantics | MIT; fixed universal dimensions and style prescriptions were not adopted |
| Shin et al., Interrogating Design Homogenization in Web Vibe Coding, arXiv:2603.13036 | accessed 2026-09-21 | research rationale for making unspecified design decisions explicit and intervening during iterative refinement | research citation; used as process evidence, not as prevalence evidence for individual CSS tells |
| pols.dev/slop.md | accessed 2026-07-17 | anti-slop diagnostic/gates | external reference, not mirrored wholesale |
| Anthropic frontend-design guidance | accessed 2026-07-18 | subject-derived visual identity and self-critique | official public guidance |
| Mobbin / Baymard / GoodUI / Built for Mars / Growth.Design / Checklist Design / Refactoring UI / Learn UI Design / Practical Typography / Page Flows / Design Spells | source links retained in design evidence references | inspiration/research evidence classes | external sources; applicability varies |

## Consolidation history

The July 2026 extension preflight kept taste, baseline, micro-craft, prompting,
motion review, runtime animation optimisation, and vocabulary as focused sibling
skills while `design-with-ai` acted mainly as a router.

That ownership decision is superseded by the 2026-09-04 Skill Ratchet `MERGE`
decision. The sibling model had accumulated mandatory cross-skill chains and
resource-routing overhead. Their capabilities are now internal progressive
references under one `design-with-ai` discovery surface.

The former local skill names remain valid historical/provenance terms only:
`design-styles`, `baseline-ui`, `make-interfaces-feel-better`,
`design-first-ui-prompting`, `review-animations`, `optimize-web-animations`, and
`animation-vocabulary`.

The September 2026 UI UX Pro Max review classified the useful delta as `EXTEND`,
not another merge/create. Product-to-style, product-to-palette, font-pairing,
landing-pattern, generic stack, and GSAP-preset datasets were intentionally not
adopted because they overlap current owners or would weaken the evidence/taste
model through category-driven defaults.

`impeccable` is intentionally not vendored or modified. It remains an
independently managed explicit/delegated specialist and may update on its own
cadence.

## Preserved source snapshots

`references/emil-design-eng-source.md` preserves the former 2026-07-15 Emil
reference byte-for-byte for provenance and recovery. It is a source snapshot,
not an executable routing contract. Historical sibling-skill names inside that
snapshot do not override the canonical routes in `SKILL.md`,
`references/motion-workflows.md`, `references/standards.md`, or
`references/quality-stack.md`.

`references/motion-vocabulary-source.md` preserves the former
`animation-vocabulary/SKILL.md` snapshot byte-for-byte. Its historical
frontmatter and routing instructions are inert source data. Normal naming tasks
load the compact `references/motion-vocabulary.md`; the source snapshot is only a
fallback for uncommon terms or provenance checks.

## Local ownership

Wibias-specific behaviour includes:

- one visible-UI owner and natural-language router;
- Direction -> Baseline -> Craft -> Gate quality stack;
- command/profile contracts and progressive resource loading;
- motion craft vs live runtime performance evidence boundary;
- source-evidence and design-reference-library policy;
- bounded heuristic design-guidance retrieval separated from evidence;
- evidence-ranked anti-slop signal registry with closed source provenance,
  semantic-family cluster scoring, reasoned contextual intent exceptions that
  never suppress hard safety gates, and positive/boundary-negative source
  calibration coverage for every active source rule entry/ID;
- optional read-only rendered DOM/geometry evidence for structural anti-slop
  questions that source scanning cannot establish, including contextual
  card-composition, elevation/rhythm, chrome-density, shell-pattern, and SaaS
  meta-template review, with positive and boundary-negative calibration coverage
  for every active rendered rule;
- semantic-family fusion of source and rendered evidence that preserves source
  hard gates while preventing the same contextual family from being counted
  twice across channels;
- a unified mechanical evidence receipt that binds source targets to declared
  routes and rendered snapshots, supports multi-candidate manifests, records
  measured/not-measured/partial coverage, and never turns mechanical evidence
  into a visual-quality verdict;
- contextual cross-surface macro-fingerprint comparison for G02 reuse without
  treating a shared product shell as automatic failure;
- product-UI data visualization and native/mobile conditional contracts;
- Skill Ratchet discovery, adversarial, model-parity, and regression coverage.

Future upstream refreshes must preserve these local ownership boundaries and must
not recreate retired discovery surfaces.
