# Source-backed design evidence

Use this reference for standard and deep non-motion workflows. It governs how
external material informs a design decision. It does not replace local product
evidence, project rules, user research, or the internal anti-slop owner in
`anti-slop-gates.md`.

After reading this contract, load `reference-library.md` and query the shared
catalog before broad external discovery. Existing fresh reviewed records count
toward the profile sample; live research fills only explicit coverage gaps.

Heuristic guidance is separate. `design-guidance.md` and
`knowledge/design-guidance/` may frame an unresolved chart, native, interaction,
text-layout, or accessibility choice, but those records use
`heuristic-guidance` provenance and **never** count toward inspected-reference
minimums or satisfy `TESTED` / `OBSERVED` evidence requirements.

## Evidence classes

Label every external claim before using it:

| Class | Meaning | May justify |
|---|---|---|
| `TESTED` | Method, context, participants or traffic, metric, and limitations are available | A context-matched recommendation or experiment |
| `OBSERVED` | A real product, journey, or implementation was inspected | A convention, failure question, or implementation hypothesis |
| `INTERPRETED` | A practitioner explains why an observed design may work | A critique or hypothesis, not a proven outcome |
| `INSPIRATION` | A visual, cultural, or interaction reference suggests a direction | Art direction or a signature move only |
| `MARKETING_CLAIM` | A vendor describes its own effectiveness without sufficient method | Discovery only; never a recommendation |

Screenshots and examples illustrate a claim; they do not prove it. Record
negative and inconclusive evidence when available. If domain, audience, device,
task, trigger, or success metric differs materially, downgrade the transfer to
a hypothesis requiring local validation.
### Visual evidence for visual work

For any workflow whose output changes rendered appearance (restyle, redesign,
build-product-surface, or any visual-world decision), a reference contributes
to the direct-domain or adjacent-domain sample ONLY if it was visually
inspected: either a rendered screenshot or live render was viewed by the agent,
or the library record carries measured visual facts (tag `visual-verified` with
a populated `visualWorld` field). Text-only extracts of help, documentation, or
marketing pages remain valid for flows, states, and conventions, but count as
discovery for visual questions -- never as visual-world evidence.

Each annotated reference record must include one required line:

    Visually inspected: yes (<method>) | no (text-only)

Omitting this line is a record defect; the reference does not count toward a
visual-domain sample until the line is present.

## Choose the source by the question

| Question | Preferred source | Use | Do not use as |
|---|---|---|---|
| What happens across a real product flow? | A connected, documented reference MCP/API; permitted Page Flows/Refero/Nicelydone/Gummble access; direct product walkthrough; Built for Mars | `OBSERVED` sequence, states, conventions, friction questions | Usability proof |
| What has usability evidence in ecommerce? | Baymard methodology and matching guideline | Context-scoped problem severity and likely remedies | Universal rule outside the tested context |
| What might improve conversion? | GoodUI positive, negative, and inconclusive tests | Experiment hypothesis with applicability tuple | Guaranteed winner |
| What mechanism or ethical risk should we examine? | Growth.Design or practitioner case studies | `INTERPRETED` mechanism and ethics questions | Tested redesign |
| What tiny interaction could create delight? | Design Spells or curated UX bites | `INSPIRATION` for a restrained signature detail | Product requirement or usability proof |
| How should a page, component, or flow be covered? | Checklist Design | Coverage prompts for states, progress, success, error, and recovery | Normative platform standard |
| Is a design system operationally complete? | Jacob Olenick's Design Systems Checklist plus project evidence | Lifecycle and governance review | Mandatory taxonomy or architecture |
| How should visual craft be diagnosed? | Refactoring UI and Erik Kennedy's public material | Hierarchy, alignment, spacing, consistency, and feature-first critique | A copied visual system |
| Is body typography sound? | Butterick's Practical Typography plus rendered content | Joint review of font, size, line-height, measure, hierarchy, and optical fit | A universal font blacklist |
| Which visual defaults should be challenged? | Anthropic frontend-design/Cookbook; SmoothUI; Developers Digest; local `anti-slop-gates.md` and `taste-workflow.md` | Prompt dimensions, contextual refusals, and closed-loop critique | Proof that a pattern is always bad |

## Reference-access contract

Before claiming a source was used, record `AVAILABLE`, `PAYWALLED`,
`BLOCKED`, or `UNAVAILABLE` and the retrieval method. Never imply MCP,
account, subscription, or
screen access that the active environment does not provide.

- Reference libraries change names, prices, trials, and access terms often.
  Verify the current checkout, documentation, and terms before recommending or
  claiming access. A marketing pricing card is not proof of monthly billing.
- Use a reference MCP or API only when its tools are actually callable in the
  active environment. Record its result limits, pagination, image payload
  behavior, rate limits, and plan requirements. Otherwise use permitted human
  browsing, direct live-product inspection, public documentation, or
  user-supplied captures and label the fallback.
- Do not scrape, bulk-download, mirror, or create an AI-training corpus from a
  gallery or paid library unless its current terms and the user's authority
  explicitly permit that use. `robots.txt` is not a content license. Land-book
  and similar galleries may allow browsing while forbidding bots or AI reuse.
- Treat Recent, Awwwards, Dribbble, Behance, Land-book, Lookup.design, and
  UIUXShowcase as discovery or inspiration surfaces unless stronger evidence is
  available. App-store marketing screenshots such as Scrnshts are not evidence
  of in-product interaction quality.
- Paid books, courses, and proprietary case libraries may inform work only from
  legitimately accessible material. Do not reconstruct paid content from
  summaries or third-party copies.
- A gallery result must include a stable source link or captured provenance,
  not only an image detached from its context.

## Annotated reference record

Keep the set small. For each item record:

```text
Source:
Access: AVAILABLE | UNAVAILABLE | PAYWALLED
Evidence: TESTED | OBSERVED | INTERPRETED | INSPIRATION | MARKETING_CLAIM
Observed claim:
Transferable principle:
Applicability: domain, audience, device, task, trigger, metric
Limits or contrary evidence:
Design decision or question it informs:
Local validation required:
```

Do not collect references without assigning each one to a decision or open
question. Do not average incompatible references into a moodboard. Keep useful
differences visible.

## Sampling instead of corpus hoarding

Research depth follows the selected profile:

| Profile | Individually inspected references | Contract |
|---|---:|---|
| `quick` | 3-6 | One direct or adjacent precedent, one craft/evidence check, and one counterexample when available |
| `standard` | 8-16 | Multiple topology and visual families plus evidence/craft counterchecks |
| `deep` | 20-40 | Required layered sample before direction selection; saturation cannot stop the sample below 20 |

For `deep`, assign every reference exactly one primary stratum so counts cannot
be inflated by duplicates:

| Primary stratum | Target | What qualifies |
|---|---:|---|
| Direct domain | 6-12 | Real products, flows, or implementations serving a comparable job |
| Adjacent domain | 5-10 | Different product category with transferable task, density, navigation, or control topology |
| Outside domain | 4-8 | Editorial, broadcast, game, industrial, spatial, cultural, or other visual-system reference |
| Evidence and craft | 5-10 | Usability research, tested patterns, case analysis, design systems, typography, motion, or implementation craft |

The total must remain 20-40; choose counts within each range that sum to that
total. At least three items must expose a real multi-state flow, and at least
two must be ordinary, constrained, or failure-prone implementations rather
than award winners. A source directory, search result, gallery index, pricing
page, or vendor corpus claim does not count. The agent must inspect and record
the underlying product, flow, case, or example. Multiple screenshots from one
unchanged page count as one reference; a genuinely distinct multi-step flow may
count once per separately analyzed state group only when each group informs a
different decision.

Use this default public stack by role, not as a checklist to browse blindly:

| Role | Suitable starting points | Counting rule |
|---|---|---|
| Source discovery | UIUXShowcase | The directory itself does not count; inspect the destination |
| Current visual directions | Recent | `INSPIRATION`; inspect the actual showcased site |
| Component patterns | Lookup.design | Count the specific component example, not the search page |
| Page and section composition | Land-book, when current terms permit manual use | `INSPIRATION` or `OBSERVED`, never automated collection |
| Motion craft | 60fps.design, Design Spells | Count a specific interaction with trigger, timing, and transfer question |
| Possibility space | Awwwards, Dribbble, Behance | Visual inspiration only unless stronger evidence exists |
| Real UX | Direct product walkthroughs; legitimately accessible flow libraries | Record states and friction as `OBSERVED`, not proven usability |
| Countercheck | Baymard, GoodUI, Built for Mars, public design systems | Apply context and evidence limits before transfer |

Paid or connected libraries such as Refero, Nicelydone, Gummble, or Page Flows
are optional retrieval channels, never required dependencies. Use them only
when current access and terms are verified. Their corpus size does not reduce
the 20-item analysis minimum, and fetching many screens is not the same as
analyzing references.

Deep work needs coverage, not indiscriminate volume. Build the stratified set
around the decision:

1. sample multiple topology families, not twenty variations of one trend;
2. include direct-domain, adjacent-domain, and outside-domain references;
3. include at least one ordinary or failure-prone implementation, not only
   award winners and curated highlights;
4. separate repeated convention from tested outcome;
5. after the profile minimum is met, stop when additional references repeat an
   already-recorded principle and no open decision remains; never exceed the
   profile maximum without recording why the decision still lacks coverage.

Record a sampling ledger with source, primary stratum, access, evidence class,
decision informed, and duplicate status. Summarize counts by stratum before
direction selection. Never claim "best practice" because a
pattern is common, popular, awarded, or visually polished. Popularity may
indicate familiarity, survivorship bias, or gallery taste; local browser and
task validation still decide whether the transfer works.

## Generation brief

Before a representative slice or implementation, translate research into a
compact execution contract:

1. subject, audience, surface type, and single job;
2. real content and product vocabulary;
3. information and traversal model;
4. typography roles and textual hierarchy;
5. palette roles, materiality, imagery, and background logic;
6. interaction states and one orchestrated motion opportunity, or an explicit
   no-motion decision;
7. one subject-derived signature artifact;
8. contextual refusals derived from the brief and local anti-slop inventory;
9. responsive transposition and accessibility requirements;
10. references mapped to the specific choices they informed.

Target individual design dimensions when only one is open. Do not restyle
locked dimensions because a generic aesthetics prompt mentions them. A font,
gradient, card, dark theme, or visual genre is not forbidden merely because AI
often defaults to it; it must be chosen or rejected for this subject.

## Design-system readiness check

Run this check when work creates or materially extends shared tokens,
primitives, components, or cross-product patterns:

- purpose, scope, owners, consumers, and supported platforms are explicit;
- foundations and semantic tokens exist in design and code;
- components cover variants, interaction states, content extremes, responsive
  behavior, accessibility, and localization;
- documentation includes usage, non-usage, composition, and migration examples;
- design/code parity, tests, release/versioning, contribution, deprecation,
  feedback, and adoption ownership are defined.

Component count is not design-system maturity. If the task only needs a local
pattern, do not manufacture a design system.

## Source-backed review

After rendering, review in this order:

1. task and journey: can the intended user complete the first-screen job and
   recover from meaningful failures;
2. hierarchy and typography: do real content, reading measure, line-height,
   contrast, and emphasis work at each viewport;
3. system and states: are variants, focus, loading, empty, error, disabled,
   overflow, and responsive states coherent;
4. specificity: does structure and visual language come from the subject, or
   from a generator default;
5. evidence integrity: does each recommendation retain its evidence class,
   applicability, limitations, and required local validation;
6. convergence: fix the highest-impact defect, recapture, and repeat until the
   declared acceptance bar passes or the workflow's stop rule applies.

Anti-slop detection is a diagnostic, not the finish line. A design that avoids
every listed trope but lacks a subject-derived idea still fails specificity.
