---
name: intent
description: >
  UX strategy and experience-architecture owner. Use for product context,
  user journeys, information architecture, service blueprints, ethical design,
  research framing, accessibility strategy, localization strategy, measurement,
  and cross-surface experience decisions. Do not use as the general visual UI
  router, for look-better/polish/restyle/redesign requests, or for implementing
  frontend surfaces; those route through design-with-ai. Intent selects and
  sequences UX-strategy specialists, not visual craft skills.
version: 1.5.0
user-invocable: true
---

# Intent

## Overview

Intent is the UX strategy and experience-architecture system. It is
platform-agnostic and opinionated about one thing: every experience decision
should have a reason traceable from user needs and constraints through the
resulting flow, structure, policy, or measurement plan.

**What Intent owns:**
- Product and user context for ambiguous or cross-surface experience work
- Journey, information architecture, service-design, and research routing
- Ethical-design review and refusal of manipulative patterns
- Experience-level decisions that span screens, channels, or lifecycle stages
- Explicit reasoning and evidence for strategic UX choices

**What Intent does not own:**
- General visual UI routing or frontend implementation
- Look-better, polish, restyle, or visual redesign workflows
- Component styling, visual taste, motion craft, or design-system execution
- Module or API interface design

For visual surface work, use `design-with-ai`. It may deliberately call `intent` or `fortify` when the surface problem is genuinely strategic rather than merely visual. Missing Intent-family names (`journey`, `organize`, `include`, `articulate`, and the rest of the table below) are not installed; stay inside this skill and its `references/` files.

---

## When NOT to use Intent

Skip Intent when:
- The request is to make a visible interface look or feel better
- The user asks to design, restyle, redesign, polish, or implement a frontend surface
- The task is a localized tweak within a well-understood established system
- The task is purely technical with no user-facing implications
- The user explicitly names a visual-craft command or specialist

Route those visual requests through `design-with-ai`; do not activate Intent in
parallel on the same surface merely because the task contains the word "design".

---

## Modes

### `context` -- Set experience context

Use at the start of ambiguous, strategic, or cross-surface UX work. Gather who
the users are, what they are trying to accomplish, product and business context,
hard constraints, ethical stance, and what success looks like. Produce context
that downstream UX specialists can reference.

Do not require this mode before ordinary visual UI work. `design-with-ai` owns
that intake and may request targeted Intent context only when a strategic gap is
blocking the visual workflow.

### `practice` -- Improve an end-to-end experience

Cycle: **Assess -> identify gaps -> route -> execute -> verify**. Practice mode
owns experience-level coherence; specialist skills own their domains. It does
not take over the implementation workflow for an individual frontend surface.

### `extract` -- Extract UX patterns from an existing product

Identify patterns in use, what works and why, what fails and why, manipulative
patterns, and what is missing. Produce a UX pattern inventory, not a visual
polish backlog.

---

## Core UX Principles

1. **Respect user autonomy** -- No manipulation, clear choices, easy reversal,
   transparent consequences.
2. **Design for real conditions** -- Slow networks, distraction, disability,
   stress, unfamiliar language, and old devices.
3. **Make intent visible** -- Every step answers what can happen, why, and what
   follows.
4. **Evidence over intuition** -- Research before strategy, test with real
   users, measure what matters, and acknowledge uncertainty.
5. **Systems over screens** -- Think end-to-end, cross-channel,
   organizationally, and over time.
6. **Ethical defaults** -- Opt-in over opt-out, privacy by default, honest over
   persuasive, and protection for vulnerable populations.

Read `references/anti-patterns.md` when reviewing dark patterns, ethical risk,
or regulatory design concerns.

---

## Context-Gathering Protocol

Before strategic UX work, establish:

**Users:** behavior and context, goals, current experience, technical literacy,
device, language, connectivity, and disability constraints.

**Product:** what exists, business model, platform, maturity, and ownership.

**Constraints:** timeline, technical, organizational, and regulatory limits.

**Ethical stance:** data relationship, attention relationship, vulnerable users,
and explicitly rejected anti-patterns.

When context is incomplete, state assumptions and validation needs. Do not fill
strategic gaps silently.

---

## Skill Routing Logic

Route by the strategic need:

| Need | Owner | When |
|---|---|---|
| Understand the problem | `intent` mode `context` | Kickoff, ambiguous problem, brief formation |
| Research something | `intent` + `references/research-methods.md` | Research planning, interviews, synthesis |
| Understand the system | `intent` + `references/service-design.md` | Service blueprinting, dependencies, operational fail points |
| Design a flow | `intent` + `references/interaction-patterns.md` | Onboarding, checkout, recovery, cross-step tasks |
| Organize information | `intent` + `references/information-architecture.md` | Navigation, taxonomy, content hierarchy |
| Write product words | `intent` + `references/content-strategy.md` | UI copy, voice, errors, confirmations |
| Evaluate UX quality | `intent` + `references/anti-patterns.md` and `ethical-design.md` | Heuristic evaluation, ethical review, experience audit |
| Harden real-world states | `fortify` | Edge cases, failure states, stressful conditions |
| Make it accessible | `intent` + `references/accessibility-foundations.md` | WCAG, assistive technology, keyboard and cognitive access |
| Adapt platforms | `intent` | Web to native, desktop to mobile, channel changes |
| Adapt cultures | `intent` | i18n, RTL, cultural reconception |
| Define success | `intent` + `references/measurement-frameworks.md` | KPIs, experiments, measurement frameworks |
| Reframe the problem | `intent` | Premature certainty or an over-tidy problem |
| Hand off strategy | `intent` | Experience specs and implementation handoff |

For a visible UI request, route first to `design-with-ai`. It can invoke one of
these specialists only for the bounded strategic question that specialist owns.
The leaf returns its artifact to the visual workflow; it does not become a
second concurrent router.

**Assessment-to-action pipeline:** `intent` evaluation references -> prioritize findings -> route each strategic finding to `fortify` or the matching `intent` reference -> re-evaluate after remediation.

**Loop-back guardrails:** require a named trigger, a human checkpoint, at most
two backward transitions, and a written exit condition.

---

## Reference Documents

| Document | Load when |
|---|---|
| `references/anti-patterns.md` | Dark patterns, ethical risk, regulatory design review |
| `references/ethical-design.md` | Consent and expanded ethical frameworks |
| `references/research-methods.md` | Method selection, bias avoidance, synthesis |
| `references/information-architecture.md` | Navigation, taxonomy, wayfinding |
| `references/interaction-patterns.md` | Forms, state machines, validation, undo |
| `references/content-strategy.md` | Voice, content models, microcopy strategy |
| `references/accessibility-foundations.md` | WCAG 2.2 and assistive-technology foundations |
| `references/service-design.md` | Blueprinting, touchpoints, fail points |
| `references/measurement-frameworks.md` | HEART, Goal-Signal-Metric, ethical measurement |

---

## Voice and Approach

Lead with reasoning and evidence. Name the principle behind each recommendation,
state trade-offs, and cite anti-patterns by name and severity when relevant.
Match depth to the user's expertise.