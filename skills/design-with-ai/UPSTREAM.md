# design-with-ai sources

This skill is a Wibias orchestration/consolidation layer. Upstream sources supply
craft guidance; local routing, workflow composition, evals, and completion policy
are maintained here.

| Source | Snapshot / access | Role | Licence / provenance |
|---|---|---|---|
| LexnLin design-with-AI thread | accessed 2026-07-12; URL recorded historically | Methods 1-3 and component-by-component framing | public thread, historical local note |
| emilkowalski/skills | commit `2d228630ba1446365f614a108cb8252f1feda202` reviewed 2026-10-13 | motion craft, animation review standards, vocabulary, runtime animation performance; `break-ui` remains owned by `fortify worst-case` | MIT |
| MengTo/Skills | commit `321c769739b823de5eb94eb3a52aa1974fe783a2` reviewed 2026-09-04 | design-first prompting and runtime animation profiling | MIT |
| ibelick/ui-skills `baseline-ui` | local adapted snapshot | baseline UI floor | MIT |
| jakubkrehel/make-interfaces-feel-better | local adapted snapshot | micro craft | MIT |
| nextlevelbuilder/ui-ux-pro-max-skill | commit `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03` reviewed 2026-10-28 | bounded guidance retrieval, chart/native interaction guidance, master/override persistence, provenance/freshness and relevance-regression concepts | MIT; selectively adapted, no wholesale corpus import |
| Webdesign Journal design fundamentals / visual hierarchy / design language / styleguide material | accessed 2026-10-28 | perceptual hierarchy/Gestalt diagnostics, operational visual-intent vocabulary, imagery/styleguide completeness including AI-image rules | external practitioner guidance; selectively re-expressed, not mirrored and not treated as tested usability evidence |
| penpot/penpot | develop commit `e20a0d748eb9ae431c27a4a201ee9f7067d955e8` reviewed 2026-10-28 | Penpot MCP design-file/session adapter, remote/local capability boundary, read/write safety, current OAuth plus legacy token compatibility | MPL-2.0 source; no Penpot source vendored |
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

The 2026-10-28 UI UX Pro Max refresh remains `EXTEND + CLEANUP`. The upstream is
38 commits ahead of the September snapshot. Agent Hub refreshes provenance and
adopts freshness/relevance-governance and token/persistence concepts only where
they fit the local evidence model. It still does not import the style, palette,
font-pairing, landing-pattern, motion-preset, or generic stack corpora. The old
category/signal presets in local `dials.md` are removed because dial values now
come from explicit direction, incumbent measurements, inspected references, or
an explicitly selected visual direction rather than product stereotypes.

The same 2026-10-28 refresh classifies the Webdesign Journal material as
`EXTEND`, not a new discovery surface. Perceptual/Gestalt ideas are a bounded
diagnostic and practitioner interpretation, not usability proof. Styleguide and
imagery concepts extend the existing durable design truth rather than creating a
second styleguide owner or mirroring article content.

The 2026-10-13 Emil refresh again classifies as `EXTEND`, not a new discovery
surface. `animation-performance` strengthens the existing runtime-motion owner.
`break-ui` has no post-adoption delta: Agent Hub already adopted it on 2026-10-04
as the dedicated `fortify worst-case` workflow, including schema-backed realistic
stress data, real-boundary injection, environment pressure, report-before-fix,
and regression-fixture guidance. No duplicate design-with-ai route is added.

The 2026-10-28 Penpot review also classifies as `EXTEND`. Penpot is a design
source/editing surface, not an independent design owner. Agent Hub therefore adds
one progressive Penpot integration reference instead of `skills/penpot/`. The
integration pins upstream capability/provenance only: Penpot source, MCP server
code, client configuration, credentials, and session state are not vendored into
this skill. Current upstream OAuth support and legacy query-token compatibility
are treated as current-source facts, not a permanent universal client contract.

`impeccable` is intentionally not vendored or modified by `design-with-ai`. It
remains an independently managed explicit/delegated specialist and may update on
its own cadence.

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
- Penpot as a progressive design-file/session adapter with read-only-first inspection, bounded reversible writes, read-back verification, project-design-authority precedence, and host-local secret/config handling;
- motion craft vs live runtime performance evidence boundary;
- source-evidence and design-reference-library policy;
- bounded heuristic design-guidance retrieval separated from evidence, with freshness and relevance-regression governance;
- bounded perceptual hierarchy/grouping diagnostics that never become standalone usability evidence;
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