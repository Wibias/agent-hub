# Critique protocol - never ship the first draft

## Core sequence

```
Read brief -> Build -> Critique with fresh eyes -> Revise -> Gate -> Ship
```

The first version is evidence to judge, not proof that the design is finished.

## Evidence-linked iteration loop

For modifying non-motion product UI, establish a **finding-to-outcome ledger**
before the first edit and reconcile it after each rendered iteration. Work at
the requested surface/route scope; the ledger tracks quality, not the number
of changed files. Use existing user feedback and prior findings when available.
Do not invent a past review or treat an assistant's suggestion as verified.

1. **Scope and baseline:** List the routes, flows, or material components
   actually in scope and their first-screen task. Capture the incumbent
   state (or the first rendered candidate for a new surface), viewport,
   representative data, and any relevant permission/interaction state.
   An untouched, out-of-scope route is not an unverified in-scope success.
2. **Findings before edits:** Assign stable IDs to material issues. Record
   severity, observed symptom with evidence, user impact, and the intended
   **observable acceptance condition**. Separate observation from inference
   or suspected product-model problems.
3. **Decision per finding:** Propose the smallest authorized change, or
   mark `KEEP` with evidence that the current behavior already serves the
   task. `DEFER` needs a reason, owner, and next verification step. A user
   request to preserve the UI is a valid constraint, not an excuse to ignore
   accessibility or functional defects.
4. **Paired review:** After implementation, compare *the same route,
   viewport band, meaningful state, and task* where possible. Record the
   actual delta, not just the intended code change. Inspect normal-zoom
   reading order, first-screen action, responsiveness, state/permission
   behavior, and potential regressions. An aesthetic shift or green CI
   alone is not proof the original issue was resolved.
5. **Disposition:** Mark each finding `RESOLVED`, `IMPROVED_BUT_OPEN`,
   `PERSISTS`, `REGRESSED`, `KEEP_JUSTIFIED`, `DEFERRED`, or `UNVERIFIED`.
   `RESOLVED` requires supporting evidence for the stated acceptance
   condition; partial improvement must stay open. Track newly introduced
   regressions as new findings, not footnotes.
6. **Carry forward:** Keep open, regressed, deferred, and unverified finding
   IDs visible in the next iteration's input. Do not silently drop an issue
   because the page looks cleaner or another screen improved. Prefer
   high-impact unresolved issues over another palette/radius pass.

For work spanning separate sessions or agents, keep the non-sensitive ledger in
the authorized task/PR record or existing design handoff, if one is available;
otherwise include it in the completion report so the next iteration can reuse
it. Do not create a new repository file or tracking system solely for this
record without scope/authority, and do not record credentials or private data.

Compact example (replace with real findings and evidence):

| ID / route | Problem and user impact | Acceptance condition | Decision / change | Paired evidence | Disposition |
|---|---|---|---|---|---|
| UX-01 / jobs | Queue buried below passive KPIs | Primary queue visible before secondary reporting | Promote queue | Before/after at matched desktop state | IMPROVED_BUT_OPEN |
| UX-02 / setup | Next setup step not clear | Current blocker and next action obvious | No verified repair yet | Before captured; after unchanged | PERSISTS |
| UX-03 / settings | Comparable fields are already readable | Preserve accurate form grouping | KEEP | Matched normal-zoom inspection | KEEP_JUSTIFIED |

**Comparison integrity:** When the baseline is missing, stale, or not paired
with the after candidate, mark comparative claims `UNVERIFIED`; review the
current state on its own. Never manufacture a screenshot or claim a route
improved because its source changed. If screenshot evidence cannot prove
interaction or publishing behavior, distinguish visual observation from
runtime/contract verification. For first-build work, the first rendered
candidate can seed the next iteration; do not invent a pre-existing UI.

**Scope integrity:** A route intentionally left unchanged can be
`KEEP_JUSTIFIED` only after relevant inspection, or `DEFERRED` when known
issues remain with a documented reason. `NOT_INSPECTED` is a coverage gap,
not a pass or a failure of that route's design. If a requested multi-route
pass changes one screen and leaves other known issues open, the correct
verdict is *partial progress*, not product-wide completion.

## Pre-emit self-critique

Score the planned or completed output **1-5** on each axis. Any axis below 3
triggers a revision pass before mechanical gates.

| Axis | Question |
|---|---|
| **P Philosophy** | Is there a clear why / position, or just a layout? |
| **H Hierarchy** | In 2 seconds, is primary / secondary / tertiary obvious? |
| **E Execution** | Are focus, contrast, wrapping, spacing, and state details covered? |
| **S Specificity** | Does this belong to this brief rather than any generic page? |
| **R Restraint** | Can anything be removed without losing meaning? |
| **V Variety** | Is structure justified rather than copied from a default template? |

Receipt example: `critique: P5 H4 E5 S4 R5 V5`.

Repeated critique is normal. If revisions keep adding decoration without fixing a
weak axis, re-read the brief and structural contract instead.

## Independent quality and style-distribution critique

Do not let visual novelty, consistent tokens, or the absence of known slop
signals raise the rating of an unclear interface. Record two separate
verdicts against rendered, representative states:

1. **FUNCTIONAL_QUALITY:** Can users identify the first-screen job, read
   essential content, find the next action, understand states, and recover
   from errors? Judge this without giving a style bonus for dark, light,
   editorial, brutalist, or any other visual genre.
2. **VISUAL_DIRECTION_FIT:** Does the chosen art direction serve the product
   and accepted brand? Is its vocabulary applied selectively enough that
   components with different jobs retain meaningful differences?

Then run the **motif-displacement challenge**: identify the two most repeated
styling devices (for example boxed cards, hairline dividers, tiny tracked
labels, gradient panels, or badges). For each, name what it communicates.
Compare a representative actionable area with a reference-only area. If
both use the same visual grammar despite different user tasks, revise the
distribution before repainting the UI. Conversely, do not introduce
variation into genuinely comparable rows or measurements merely to appear
less generic.

A different palette, a signature accent, or replacing cards with rules is
not a structural UX improvement by itself. A user-approved design system
may intentionally repeat its visual language; require concrete evidence
of harm or a mismatch before challenging that repetition.

## Navigation purpose and adjacent-surface challenge

On an inspected viewport, ask: does each repeated route/action offer a
meaningfully different user purpose, or is generic shell navigation duplicated
inside a nearby toolbar? Compare effective targets and actual behavior.
Header/footer legal repetition, contextual recovery, and responsive-only
navigation may be justified; two simultaneous generic Settings links usually
are not. Do not demand arbitrary one-link-per-route uniqueness.

For an overview with rich item previews, judge the linked detail screen
against a *different* task: focused inspection and only the decisions/actions
that exist in the product. A big media player plus passive metadata may be
sufficient for a read-only final artifact; when useful supported script,
caption, QA, or output inspection is hidden elsewhere, a purpose-built
inspector can improve the workflow. Do not pretend speculative controls
are working features.

## Senior designer filter

Check the applicable questions:

1. One clear focal point and readable eye path?
2. Colour roles are intentional and required contrast holds?
3. Spacing relationships and density are coherent?
4. Values come from project/system tokens or documented local decisions?
5. Can non-essential decoration be removed?
6. Applicable states and failure paths are covered?
7. Representative mobile/tablet/desktop layouts preserve content priority?
8. Would a compact utility look at home beside native browser controls, or is it cosplaying a SaaS dashboard?

## Investment gates

Use when design direction is high-stakes and the user has not delegated that
decision. Resolve only the uncertainty needed for the next irreversible design
choice:

1. **Project understanding** - right surface and job?
2. **Taste direction** - compare a small set of product-fit directions with trade-offs when direction is genuinely unresolved.
3. **Design brief** - specific enough to implement without inventing product truth?

When the user explicitly grants design autonomy, record assumptions and proceed.
Do not reopen settled direction during later polish.

## Deep critique with Impeccable

Impeccable remains an independent specialist, not a hidden prerequisite.

- If the user explicitly invokes an Impeccable command, route directly to that specialist.
- If `design-with-ai` delegates deep critique, use an exact bounded command such as `impeccable critique <target>` and pass the delegation receipt defined in `design-methods.md`.
- The receipt must include owner, target, profile, locked constraints, completed steps, requested output, and return gate.
- Do not let the specialist rerun method selection or already-completed quality-stack work.

After a delegated critique returns, `design-with-ai` resumes ownership and runs
its applicable quality/verification gates. Do not reimplement the specialist's
deep review framework here.

## pols.dev pass

For brand/marketing work that selected the anti-slop forensic pass, use
`pols-slop.md` plus `anti-slop-gates.md`. External taste guidance remains subject
to the local applicability rule.

## Ship / Hold verdict

Lead with the verdict. Do not bury blocking evidence.

```markdown
# HOLD - 2 blockers
What passed: <scope>
Ship blockers: <gate IDs and evidence>
Fastest path: <smallest fixes and rerun>
```

Use **SHIP** only when all applicable blocking gates and required verification
have real evidence. Files existing is not evidence. Intentions are not evidence.

## Review output for audit mode

Use a Before / After / Why table:

| Before | After | Why |
|---|---|---|
| 3 equal feature cards used without product reason | restructure around unequal content weight | generic macrostructure hides hierarchy |

## Deslop repair order

1. **Structure**: macro, section topology, hero/nav/footer fingerprints.
2. **Surface**: type, colour, radius, elevation.
3. **Verbal**: copy clichés, unsupported claims, fake metrics.

When the skeleton is generic, at least one repair must address structure. Surface
polish alone does not fix a template problem. If the original was fixed by
applying a new motif everywhere, test for **style overcorrection** and repair
component-role allocation rather than swinging to another full-page preset.

## Pushback protocol

Follow the router and project instructions. Preserve locked product truth,
security, accessibility, and other higher-authority constraints while proposing
the smallest viable alternative.
