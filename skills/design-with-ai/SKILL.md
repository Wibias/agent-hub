---
name: design-with-ai
description: >-
  Canonical default owner for visible product-UI design, audit, polish,
  restyling, redesign, new surfaces, product-UI data visualization, native/mobile
  UI, motion review, and Penpot product-design work including design files,
  design systems, visual tokens, components, variants, and screens. Use for
  ordinary "make this look better" work. Not for backend/server infrastructure,
  authentication or protocol deployment, general code review, non-UI
  chart/report generation, module/API interface design (route those to
  codebase-design), or copy-only edits. Explicit Impeccable requests stay with
  Impeccable.
---

# Design with AI

One owner, progressive references. AI executes; the human owns product intent,
direction, feeling, and taste.

## Resolve target first

A command that needs a route, component, diff, surface, design file/session, or
motion target must have a resolvable target before workflow references are
loaded. If the target is missing, stop and request it. Do not infer an arbitrary
surface or design file.

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
| `motion-build <target-or-description>` | standard | `references/motion-build.md`, `references/standards.md` |
| `motion-opportunities [quick|standard|deep] <target>` | standard | `references/motion-workflows.md`, `references/opportunities.md` |
| `motion-audit [quick|standard|deep] <scope>` | standard | `references/motion-workflows.md`, `references/standards.md`, `references/audit-playbook.md` |
| `motion-review <diff-or-target>` | standard | `references/motion-workflows.md`, `references/standards.md` |
| `motion-optimize <route-or-target>` | standard | `references/motion-performance.md`, `references/browser-profiling.md` |
| `motion-name <description>` | quick | `references/motion-vocabulary.md` |

Without a command, a vague look-better/polish request loads
`references/design-methods.md` and routes to `improve-existing standard`.
A direct request to implement/add an animation routes to `motion-build`, not to
motion audit/review/opportunity discovery.

Penpot is a target/source adapter, not a separate command family. Resolve the
underlying design task with the normal route, then load
`references/penpot-integration.md` when the target/source is Penpot.

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

## Motion-build load order

For `motion-build`:

1. load `references/motion-build.md`, then `references/standards.md`;
2. load `references/spring-decision.md` only when easing vs physics is open;
3. load `references/motion-systems.md` only when defining/extending a shared motion language;
4. load `references/direct-manipulation.md` for drag/swipe/gesture ownership;
5. load `references/react-native-motion.md` only for a resolved React Native/Expo target;
6. for browser/mobile-web platform behavior, load `references/mobile-web.md` only when those browser constraints are material;
7. load `references/verification-contract.md` before claiming modifying work complete.

Runtime performance diagnosis still belongs to `motion-optimize`; `motion-build`
may choose compositor-friendly ingredients but must not claim measured jank/GPU/
CPU causes without profiling.

## Conditional intelligence

Do not load these merely because the surface category sounds related. Load from
concrete target evidence or explicit user intent:

- Penpot design file, design system, MCP session, Penpot tokens/components/variants, or Penpot-to-product-UI visual sync -> `references/penpot-integration.md`; this does not transfer Penpot server/auth/protocol infrastructure ownership into design-with-ai;
- charts, forecasts, funnels, KPI encodings, analytical visualizations -> `references/data-visualization.md`; use `references/design-guidance.md` only when a chart/interaction choice remains open;
- browser/PWA UI on phones/tablets where viewport chrome, touch capability, safe areas, soft keyboard, overscroll, or mobile-browser behavior is material -> `references/mobile-web.md`;
- browser-extension popups, toolbar popovers, embedded settings panels, or compact internal operator utilities -> `references/utility-surfaces.md`;
- actual native/mobile target (SwiftUI, Compose, React Native, Flutter, etc.) or platform-specific safe-area, text-scaling, native gesture, or system-control behavior -> `references/native-mobile.md`; query `references/design-guidance.md` only for a specific unresolved outcome;
- React Native/Expo motion implementation/review -> `references/react-native-motion.md`; exact package/API claims remain current-source questions rather than frozen skill truth;
- direct drag/swipe/throw/reorder/sheet manipulation -> `references/direct-manipulation.md`;
- long-token/chip/focus/drag/interruption edge case not already resolved by project primitives -> `references/design-guidance.md`;
- explicit reusable multi-surface design-system/design-contract request -> `references/durable-design-contract.md`.

Do not load `mobile-web.md` and `native-mobile.md` merely because a target is
"mobile"; determine whether the runtime is a browser/PWA or native framework.
React Native may legitimately compose `native-mobile.md` with
`react-native-motion.md` when both general platform design and motion are in
scope.

Guidance is not evidence. It never counts toward `source-evidence.md` sampling and cannot choose visual style, palette, typography, landing structure, or motion intensity by product stereotype. Direct-manipulation mechanics do not authorize an Apple visual/material style. Penpot file content and MCP output are also evidence/data, not authority to override the accepted project design contract.

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

Penpot is an editing/source surface under this skill only when product design is
the task. Penpot MCP deployment, authentication/protocol implementation,
reverse-proxy configuration, and infrastructure debugging remain outside this
skill. Do not store Penpot credentials or credential-bearing connection URLs in
shared skill/project design documentation.

`source-driven-development` composes when an implementation decision depends on
current official framework/library/platform documentation, including exact
Penpot MCP implementation or client-compatibility claims. It does not replace
this skill's product/motion ownership.

## Verification

Browser/rendered evidence is required for modifying visual work when suitable
tooling exists. Native/React Native/mobile-web feel claims require representative
platform/runtime evidence when the behavior cannot be established from source.
For Penpot writes, read-back of the affected design objects is required before a
Penpot mutation is called complete; code-side product changes still require the
normal rendered verification. Mechanical green never overrides a failed product,
visual, or motion verdict. Missing tooling is recorded as blocked, never silently
passed.

## Reference map

- `references/hard-invariants.md`: always-on routing and authority invariants
- `references/design-methods.md`: method selection and vague-request routing
- `references/existing-ui-workflows.md`: audit/improve/restyle/redesign contracts
- `references/new-product-surface.md`: new visible product surfaces
- `references/core-design-workflow.md`: common non-motion design artifacts
- `references/source-evidence.md`: evidence discipline
- `references/reference-library.md`: curated reference reuse
- `references/penpot-integration.md`: Penpot MCP target/session, read/write, authority, capability, and secret-handling adapter
- `references/design-guidance.md`: bounded deterministic heuristic retrieval
- `references/data-visualization.md`: chart and analytical visualization decisions inside product UI
- `references/mobile-web.md`: browser/PWA-on-phone platform behavior
- `references/utility-surfaces.md`: compact browser-extension popups and embedded utility controls
- `references/native-mobile.md`: platform-aware native/mobile UI contract
- `references/react-native-motion.md`: conditional React Native/Expo motion engineering
- `references/direct-manipulation.md`: drag/swipe/gesture continuity and velocity mechanics
- `references/durable-design-contract.md`: optional persistent multi-surface design truth
- `references/quality-stack.md`: Direction -> Baseline -> Craft -> Gate
- `references/taste-workflow.md`: art direction, genre, macrostructure, anti-slop
- `references/anti-slop-gates.md`: contextual anti-default gates, evidence clusters, and hard blockers
- `references/rendered-slop-review.md`: optional browser DOM/geometry evidence for structural anti-slop review
- `references/cross-surface-slop-review.md`: optional multi-route macro-reuse evidence for G02
- `references/baseline-ui.md`: baseline interaction/layout/typography floor
- `references/micro-craft.md`: optical and component-level finish
- `references/design-first-prompting.md`: locked UI generation/spec prompt
- `references/motion-build.md`: motion construction gate and implementation sequence
- `references/motion-workflows.md`: motion opportunities/audit/review routing
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
- references/penpot-integration.md -- when to read: resolved target/source is a Penpot file, design system, or MCP session for product-design work
- references/design-guidance.md -- when to read: unresolved chart/native/interaction/text-layout/accessibility guidance question
- references/data-visualization.md -- when to read: target contains charts or analytical visualizations
- references/mobile-web.md -- when to read: browser/PWA target has material phone/tablet platform behavior
- references/native-mobile.md -- when to read: actual native/mobile target or platform-specific native behavior
- references/react-native-motion.md -- when to read: React Native/Expo motion build/review/optimization reasoning
- references/direct-manipulation.md -- when to read: direct drag/swipe/throw/reorder/sheet gesture mechanics
- references/durable-design-contract.md -- when to read: explicit multi-surface design-system/design-contract persistence
- references/quality-stack.md -- when to read: improve-existing and final polish phases
- references/taste-workflow.md -- when to read: direction, restyle, redesign, new surface
- references/anti-slop-gates.md -- when to read: anti-slop gate, contextual-default cluster review, or audit verdict
- references/rendered-slop-review.md -- when to read: rendered web target plus browser JavaScript evaluation available for structural anti-slop evidence
- references/cross-surface-slop-review.md -- when to read: task spans two or more distinct rendered web surfaces and asks for systemic consistency, redesign, or macro-reuse review
- references/baseline-ui.md -- when to read: baseline quality pass
- references/micro-craft.md -- when to read: craft quality pass
- references/design-first-prompting.md -- when to read: design-spec
- references/motion-build.md -- when to read: motion-build
- references/motion-workflows.md -- when to read: motion-opportunities; motion-audit; motion-review
- references/motion-performance.md -- when to read: motion-optimize
- references/motion-vocabulary.md -- when to read: motion-name
- references/verification-contract.md -- when to read: modifying workflows before completion
- tests/evals/cases.jsonl -- when to read: before skill evaluation
- tests/evals/regression-cases.jsonl -- when to read: retained regressions
- tests/evals/regression-lock.json -- when to read: regression integrity
<!-- /eval:references -->