# design-with-ai sources

This skill is a Wibias orchestration/consolidation layer. Upstream sources supply
craft guidance; local routing, workflow composition, evals, and completion policy
are maintained here.


## Impeccable upstream integration policy (2026-11-23)

**Canonical owner:** `skills/design-with-ai/`. `pbakaus/impeccable` is a
reviewed upstream source and, where explicitly selected, an internal provider
under `skills/design-with-ai/internal/impeccable/`. It is **not** a second
discoverable AgentHub skill. Do not restore `skills/impeccable/SKILL.md`,
`internal/impeccable/SKILL.md`, a competing design router, or a parallel
acceptance/quality gate. Legacy command names remain DWA subroutes only.

On each new Impeccable release or relevant upstream change:

1. Compare the exact reviewed commit/tag and changed scope with the current DWA
   implementation, including internal runtime assets. A new upstream commit is
   a review trigger, **not** proof that every change should be copied.
2. Classify each meaningful capability, fix, or behavior change as
   `INTEGRATE`, `ALREADY_COVERED`, `NOT_RELEVANT`, or `BLOCKED_PENDING`.
   Record the upstream ref, impacted DWA owner, evidence, and rationale in the
   upstream review or an explicitly linked issue/PR. Do not silently drop a
   relevant improvement just because Impeccable is no longer standalone.
3. For `INTEGRATE`, improve the **existing DWA** workflow, reference,
   detector, optional internal provider, or test. Keep a single owner and
   preserve project design authority, ordinary DWA gate/receipt semantics,
   explicit-only engine activation, and host permission/security boundaries.
   Protect the behavioral delta with relevant regression/compatibility tests.
4. For `ALREADY_COVERED` or `NOT_RELEVANT`, give a concrete comparison or
   reason. For `BLOCKED_PENDING`, retain an actionable tracked follow-up
   and an honestly pending status; do not report the implementation as current.
5. Keep **reviewed upstream ref**, **local implementation pin**, and
   **runtime qualification** distinct. Only advance the installed engine
   release after coherent tagged-source/checksum verification plus appropriate
   Windows x64 launcher, fail-closed, hook, Live/browser, and negative-path
   evidence. Updating prose or reference files never qualifies a binary.
6. Run Skill Ratchet checks required by the affected skill and update the
   relevant upstream registry/provenance only after recording the disposition.
   Do not overwrite historical pins with a newer unreviewed `main` snapshot.

The canonical registry entry in `upstream-sources.json` must retain
`integrationOwner: "design-with-ai"`. The upstream checker rejects a missing
or competing owner and a blanket `not-applicable` decision for Impeccable.
That is an ownership guard, **not** an automatic relevance judge or installer.


| Source | Snapshot / access | Role | Licence / provenance |
|---|---|---|---|
| LexnLin design-with-AI thread | accessed 2026-07-12; URL recorded historically | Methods 1-3 and component-by-component framing | public thread, historical local note |
| emilkowalski/skills | commit `0f2e23b32bb1265e84cff8d3e75785fec953fb1b` reviewed 2026-11-14 (previous `4061b67b8d976a186aca118594f54b638c5f718a` reviewed 2026-11-12; original choreograph lineage `c8a79627b59d72d764d6ab6f2c87c09a48169833`) | motion craft, removal-safety, runtime motion advice and selectively adapted `choreograph` coordination guidance; no new skill route and no wholesale recipe import; `break-ui` remains owned by `fortify worst-case` | MIT |
| anthropics/knowledge-work-plugins `design/skills/design-handoff` | main tree `b4c9a4e1de4b42868b74a6fe30ac766f64e43a3e` reviewed 2026-11-19 | conditional implementation-ready UI handoff coverage and component/state matrix, narrowed to existing DWA `design-spec` and grounded evidence grades; no upstream code or example specification copied | Apache-2.0; procedural adaptation |
| MengTo/skills | original commit `321c769739b823de5eb94eb3a52aa1974fe783a2` reviewed 2026-09-04; scoped new review `3cc93458c4949c39a04e938ea7892a1d6d3d40bf` on 2026-11-18 | prior design-first prompting and animation profiling; additive reference capture completeness and originality-risk evidence procedures. Only local methods and optional built-in Node checkers adapted; no code, screenshot corpus, or browser runtime vendored | MIT |
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

## 2026-11-14 Emil upstream review

Reviewed three commits through `0f2e23b32bb1265e84cff8d3e75785fec953fb1b`.
The `choreograph` adaptation traces back to the earlier MIT snapshot
`c8a79627b59d72d764d6ab6f2c87c09a48169833` (2026-11-05);
this provenance is retained even though the reviewed upstream HEAD advanced.
New `learn-taste` is adapted as opt-in `learn-design-taste` under
`design-with-ai` with source-backed suggestions, conflict checks and
user approval before writing design rules. No standalone skill or competing
memory store. Corrected motion assumptions are adopted selectively:
`AnimatePresence` default sync does not release exiting layout, while
`transform` and `opacity` are the portable compositor-friendly properties.
`filter`, `clip-path`, and background color need actual browser evidence.
Other framework-specific examples and selectors are not blindly copied.

## 2026-11-18 MengTo scoped reference-evidence review

Reviewed `agent-skills/codex/stitched-full-page-capture/SKILL.md` and
`agent-skills/codex/audit-reference-originality/SKILL.md` from commit
`3cc93458c4949c39a04e938ea7892a1d6d3d40bf`. Verdict: EXTEND the
existing `design-with-ai` source-evidence workflow, with `playwright`
retaining browser control. Add conditional procedures and read-only local
geometry and exact-overlap diagnostics. These do not certify screenshot
pixels, automatically stitch images, judge legal originality, or replace the
current user-directed design acceptance. No upstream browser code or assets
were copied, and no new shared skill or global gate was created.

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

The 2026-10-28 Emil refresh again classifies as `EXTEND`, not a new discovery
surface. `animation-performance` strengthens the existing runtime-motion owner.
`break-ui` has no post-adoption delta: Agent Hub already adopted it on 2026-10-04
as the dedicated `fortify worst-case` workflow, including schema-backed realistic
stress data, real-boundary injection, environment pressure, report-before-fix,
and regression-fixture guidance. The new `remove-animations` skill mostly
overlaps Agent Hub's existing purpose/frequency motion gate, so no new route or
standalone skill is added. Only its removal-safety delta is adopted: check hidden
start states, completion/unmount/focus coupling, layout-motion masking, and
motion-coupled tests before deletion, then clean only artifacts orphaned by the
approved removal and require explicit approval before removing a dependency.

The 2026-10-28 Penpot review also classifies as `EXTEND`. Penpot is a design
source/editing surface, not an independent design owner. Agent Hub therefore adds
one progressive Penpot integration reference instead of `skills/penpot/`. The
integration pins upstream capability/provenance only: Penpot source, MCP server
code, client configuration, credentials, and session state are not vendored into
this skill. Current upstream OAuth support and legacy query-token compatibility
are treated as current-source facts, not a permanent universal client contract.

The 2026-11-12 Emil refresh classifies the new `gestures` skill as an
`EXTEND` of existing `references/direct-manipulation.md`, not another
standalone skill. It adds tracking-loop cost guidance, linked drag feedback,
velocity-aware dismissal and linear hold-progress cancellation. It keeps
local platform/gesture primitives authoritative and rejects copied magic
thresholds or a universal Vaul requirement. README-only changes were
reviewed without adopting a new routing owner.

The 2026-11-05 Emil refresh classifies `choreograph` as `EXTEND` for
coordinated motion only. `references/motion-choreography.md` is loaded
conditionally by existing motion-build, motion-audit and motion-review paths
when several elements respond to one event; isolated animation work remains
unchanged. The adaptation keeps lead/support/static roles, together/overlap/
sequence/carry choices, interruption and reduced-motion checks. It rejects
the upstream's absolute uniform-stagger prohibition, and corrects the
`AnimatePresence` sequencing claim: official Motion docs confirm
`mode="sync"` as the default, with `wait` as the explicit sequential mode.
The existing project token, accessibility and measurement gates remain canonical.

## Impeccable selective v4.10.0 review (2026-11-20)

Reviewed the tagged `pbakaus/impeccable` `skill-v4.10.0` commit
`b49177d32788f2dc585c42831d845dacf1ebed2c`. Adapted only two
non-runtime ideas into the existing DWA owners: the optional compact
navigation map for long approved design contracts
(`references/durable-design-contract.md`) and paired normal/reduced-motion
capture reasoning (`references/motion-build.md`). Existing DWA acceptance,
render verification, project authority and tool permissions take precedence.
The upstream 496-line critique rubric was not copied as a competing audit
owner, and no mandatory Impeccable motion-capture tool or reviewer was added.

## Unified Impeccable runtime migration (2026-11-20)

The local explicit Impeccable skill is being integrated under the canonical
`skills/design-with-ai` owner in AgentHub issue #404. Its non-entrypoint
files moved to `internal/impeccable/` and the separate `SKILL.md` entry
was retired. Command dispatch is a conditional DWA subroute in
`references/impeccable-routes.md`, not a second design workflow.

## Optional Impeccable engine 0.1.31 release sync (2026-11-27)

**Active candidate engine pin:** `0.1.31`. The previous reviewed
0.1.28 engine milestone is retained below as history. This is an
**engine-only** change inside the canonical DWA owner. It does **not**
install the standalone `skill-v4.11.1` skill or treat its new
account/Loop/auto-trust/upload behaviors as automatically authorized.

Use release `engine-v0.1.31` for the binary asset identity, and
`skill-v4.11.1` for the coherent source `0.1.31` version,
checksum manifest and launcher blobs. The engine tag's source
manifest still listed `0.1.30`, so never promote it directly.
`internal/impeccable/UPSTREAM.md` records the exact tag commits,
published asset SHA-256 values and Windows/POSIX launcher provenance.
Full native checks and independent Skill Ratchet qualification must
precede merge. The JS detector and browser/Live helpers remain
separately owned and are not implied Rust-engine parity.

This migration originally pinned legacy skill 4.9.1 and engine 0.1.24
with matching hashes. The 2026-11-23 **engine-only** release candidate
updates `internal/impeccable/scripts/VERSION` and its verified release-asset
SHA-256 manifest to engine 0.1.28 from the exact upstream
`engine-v0.1.28` release tag. The canonical DWA skill owns routing and
remains a selective adaptation of upstream skill 4.10.0 ideas, not a
wholesale replacement or a claim of complete browser/Live parity.
The upgrade's qualification boundaries are recorded in
`internal/impeccable/UPSTREAM.md` and issue #436.

Certain internal playbook paths, command labels, context and hook helpers
are deliberate AgentHub compatibility overlays and therefore no longer
byte-identical to upstream. Unmodified engine launchers and manifests
retain exact pinned Git blobs; verification must distinguish these sets.

The normal DWA quality gate continues to own task acceptance. Source-only
JS detection and its fail-closed scan receipt are independent from the
optional Rust engine. No generic DWA task launches the engine, downloads
binaries, installs hooks or starts a browser Live session. Full runtime,
hook and Live parity must be demonstrated before this migration is merged.

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