---
name: design-with-ai
description: >-
  Canonical default visible-UI design owner for intentional, anti-slop product
  surfaces. Use for generic look-better/polish and visual-hierarchy requests,
  surface audits, restyles, redesigns, new product UI, product-UI charts/data
  visualization, native/mobile UI, design specs/prompts, motion
  opportunities/audits/reviews, animation performance, or naming a motion
  effect. Commands: audit-surface, improve-existing, restyle-existing,
  redesign-existing, build-product-surface, design-spec, motion-opportunities,
  motion-audit, motion-review, motion-optimize, motion-name. Not for backend-only
  work, standalone analytical/report chart generation, API/module interface design
  (use codebase-design), copy-only edits, general code review, or explicit
  impeccable invocations.
---

# Design with AI

One owner, progressive references. AI executes; the human owns product intent,
direction, feeling, and taste.

## Resolve target first

A command that needs a route, component, diff, or surface must have a resolvable
target before workflow references are loaded. If the target is missing, stop and
request it. Do not infer an arbitrary surface.

After target resolution, load `references/hard-invariants.md` before acting.
Then load only the selected workflow bundle.

## Route

| Request / command | Default | Primary workflow |
|---|---|---|
| `audit-surface [quick|standard|deep] <target>` | standard | `references/existing-ui-workflows.md` |
| `improve-existing [quick|standard|deep] <target>` | standard | `references/existing-ui-workflows.md`, then `references/quality-stack.md` |
| `restyle-existing [quick|standard|deep] <target>` | standard | `references/existing-ui-workflows.md`, `references/taste-workflow.md` |
| `redesign-existing [standard|deep] <target>` | deep | `references/existing-ui-workflows.md`, `references/taste-workflow.md` |
| `build-product-surface [standard|deep] <surface>` | deep | `references/new-product-surface.md`, `references/taste-workflow.md` |
| `design-spec <target>` | standard | `references/design-first-prompting.md` |
| `motion-opportunities [quick|standard|deep] <target>` | standard | `references/motion-workflows.md`, `references/opportunities.md` |
| `motion-audit [quick|standard|deep] <scope>` | standard | `references/motion-workflows.md`, `references/standards.md`, `references/audit-playbook.md` |
| `motion-review <diff-or-target>` | standard | `references/motion-workflows.md`, `references/standards.md` |
| `motion-optimize <route-or-target>` | standard | `references/motion-performance.md`, `references/browser-profiling.md` |
| `motion-name <description>` | quick | `references/motion-vocabulary.md` |

Without a command, a vague look-better/polish request loads
`references/design-methods.md` and routes to `improve-existing standard`.

## Non-motion load order

For `audit-surface`, `improve-existing`, `restyle-existing`,
`redesign-existing`, and `build-product-surface`:

1. load the primary workflow reference;
2. load `references/core-design-workflow.md`;
3. for standard/deep, load `references/source-evidence.md`, then
   `references/reference-library.md`;
4. load only applicable conditional intelligence references from the section below;
5. load the workflow-specific taste/quality references;
6. for modifying work, load `references/verification-contract.md` before
   completion.

`design-spec` is a bounded spec/prompt route after direction is known; it does
not automatically reopen the full design workflow.

## Conditional intelligence

Do not load these merely because the surface category sounds related. Load from concrete target evidence or explicit user intent:

- charts, forecasts, funnels, KPI encodings, analytical visualizations -> `references/data-visualization.md`; use `references/design-guidance.md` only when a chart/interaction choice remains open;
- native/mobile target or platform-specific safe-area, text-scaling, gesture, or touch behavior -> `references/native-mobile.md`; query `references/design-guidance.md` only for a specific unresolved outcome;
- long-token/chip/focus/drag/interruption edge case not already resolved by project primitives -> `references/design-guidance.md`;
- explicit reusable multi-surface design-system/design-contract request -> `references/durable-design-contract.md`.

Guidance is not evidence. It never counts toward `source-evidence.md` sampling and cannot choose visual style, palette, typography, landing structure, or motion intensity by product stereotype.

## Quality profiles

- **quick**: bounded evidence, one critique pass, targeted gates.
- **standard**: complete applicable artifacts plus desktop/mobile verification.
- **deep**: purpose/IA alternatives, distinct visual worlds, representative slice.

Profiles change evidence depth, not authority.

## Internal quality stack

Ordinary polish is one workflow, not delegation across sibling skills:

`Direction -> Baseline -> Craft -> Gate`

The contract lives in `references/quality-stack.md`. Motion is opt-in and is not
automatically added by baseline polish.

## External boundaries

`impeccable` remains an independently managed explicit/delegated specialist. Do
not edit or vendor it. Explicit Impeccable requests stay with Impeccable.
`intent`, `conversion-pages`, `prototype`, `fortify`, `shadcn`, and
`codebase-design` remain separate when their domain is primary.

## Verification

Browser/rendered evidence is required for modifying visual work when suitable
tooling exists. Mechanical green never overrides a failed product, visual, or
motion verdict. Missing tooling is recorded as blocked, never silently passed.

## Reference map

- `references/hard-invariants.md`: always-on routing and authority invariants
- `references/design-methods.md`: method selection and vague-request routing
- `references/existing-ui-workflows.md`: audit/improve/restyle/redesign contracts
- `references/new-product-surface.md`: new visible product surfaces
- `references/core-design-workflow.md`: common non-motion design artifacts
- `references/source-evidence.md`: evidence discipline
- `references/reference-library.md`: curated reference reuse
- `references/design-guidance.md`: bounded deterministic heuristic retrieval
- `references/data-visualization.md`: chart and analytical visualization decisions inside product UI
- `references/native-mobile.md`: platform-aware native/mobile UI contract
- `references/durable-design-contract.md`: optional persistent multi-surface design truth
- `references/quality-stack.md`: Direction -> Baseline -> Craft -> Gate
- `references/taste-workflow.md`: art direction, genre, macrostructure, anti-slop
- `references/anti-slop-gates.md`: contextual anti-default gates, evidence clusters, and hard blockers
- `references/rendered-slop-review.md`: optional browser DOM/geometry evidence for structural anti-slop review
- `references/cross-surface-slop-review.md`: optional multi-route macro-reuse evidence for G02
- `references/baseline-ui.md`: baseline interaction/layout/typography floor
- `references/micro-craft.md`: optical and component-level finish
- `references/design-first-prompting.md`: locked UI generation/spec prompt
- `references/motion-workflows.md`: motion craft routing
- `references/motion-performance.md`: live animation profiling/repair
- `references/motion-vocabulary.md`: effect-name reverse lookup
- `references/verification-contract.md`: completion evidence

<!-- eval:references -->
- references/hard-invariants.md -- when to read: after target resolution and before acting on any design-with-ai workflow
- references/design-methods.md -- when to read: no command or vague look-better request
- references/existing-ui-workflows.md -- when to read: audit-surface; improve-existing; restyle-existing; redesign-existing
- references/new-product-surface.md -- when to read: build-product-surface
- references/core-design-workflow.md -- when to read: all non-motion surface workflows except design-spec
- references/source-evidence.md -- when to read: standard/deep non-motion surface workflows
- references/reference-library.md -- when to read: after source-evidence for standard/deep non-motion surface workflows
- references/design-guidance.md -- when to read: unresolved chart/native/interaction/text-layout/accessibility guidance question
- references/data-visualization.md -- when to read: target contains charts or analytical visualizations
- references/native-mobile.md -- when to read: native/mobile target or platform-specific mobile behavior
- references/durable-design-contract.md -- when to read: explicit multi-surface design-system/design-contract persistence
- references/quality-stack.md -- when to read: improve-existing and final polish phases
- references/taste-workflow.md -- when to read: direction, restyle, redesign, new surface
- references/anti-slop-gates.md -- when to read: anti-slop gate, contextual-default cluster review, or audit verdict
- references/rendered-slop-review.md -- when to read: rendered web target plus browser JavaScript evaluation available for structural anti-slop evidence
- references/cross-surface-slop-review.md -- when to read: task spans two or more distinct rendered web surfaces and asks for systemic consistency, redesign, or macro-reuse review
- references/baseline-ui.md -- when to read: baseline quality pass
- references/micro-craft.md -- when to read: craft quality pass
- references/design-first-prompting.md -- when to read: design-spec
- references/motion-workflows.md -- when to read: motion-opportunities; motion-audit; motion-review
- references/motion-performance.md -- when to read: motion-optimize
- references/motion-vocabulary.md -- when to read: motion-name
- references/verification-contract.md -- when to read: modifying workflows before completion
- tests/evals/cases.jsonl -- when to read: before skill evaluation
- tests/evals/regression-cases.jsonl -- when to read: retained regressions
- tests/evals/regression-lock.json -- when to read: regression integrity
<!-- /eval:references -->
