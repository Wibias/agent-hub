# Design-to-code handoff (conditional design-spec mode)

Use for `design-spec handoff <target>` or a request for an implementation-ready handoff of an **existing, resolved** UI, accepted design or approved direction. This is the bounded `design-spec` route with an implementation contract, not a new owner of product design, UX implementation or release approval. Inspired by the design-handoff procedure in Anthropic's `knowledge-work-plugins` (Apache-2.0; reviewed commit `b4c9a4e1de4b42868b74a6fe30ac766f64e43a3e`, 2026-11-19). Adapt the method, not the example values.

## Resolve the evidence and its authority

1. Identify target route/component, accepted design version or screenshot, implementation repository, platform, and receiving developer/team. Read actual project tokens/components and approved product/design rules. For an explicit Penpot source, load `penpot-integration.md` and read available design objects; no assumed export API or invented Figma measurements.
2. Separate every significant specification into **MEASURED** (inspected design, code, tokens or browser, with path/object and version), **APPROVED** (explicit user/project direction, with source), **PROPOSED** (open recommendation), or **UNKNOWN** (missing input). Label unresolved values `TBD`, not measured or approved. Do not infer mobile breakpoints, accessible behavior, asset rights or animation curves from a screenshot.
3. Resolve conflicts with implementation/product truth before writing handoff. An approved design can describe an intended change, but cannot silently authorize alterations to locked copy, security, data, analytics, route behavior, legal claims or accessibility semantics. Report conflicts for a decision.
4. If implementation has not been built or visually verified, label the handoff `SPEC_ONLY`; never call it implemented, pixel-perfect or runtime-validated. If a live target is available, note exactly which state and viewport was inspected. A static design cannot demonstrate focus order, screen reader speech or network failure handling.

## Output contract (include applicable fields, not invented precision)

- **Scope and decision**: goal, audience, target route/element, platform, accepted design source/version, receiving implementation path, `LOCKED` vs editable boundaries, explicit non-goals.
- **Existing component map**: concrete candidate component/file, reuse or proposed addition, props/variants and reason. Preserve the existing design system; do not create duplicate tokens, new component libraries, or second design authority just to fill a template.
- **Visual and responsive rules**: layout relationships, content priority, spacing, typography, semantic color/material tokens, responsive behavior and device/viewport classes. Specify token identifiers and observed values where known. Distinguish a breakpoint measured from shipped CSS from a proposed breakpoint.
- **Behavior/state matrix**: for each relevant interactive component describe `default`, `hover`, `focus-visible`, `active`, `disabled`, `loading`, `empty`, `error`, `success`, `permission-denied`, and interrupted/offline cases **where applicable**. Mark legitimately absent states `N/A`, not simulated. Include keyboard activation/focus, readable status and recovery, touch/gesture semantics, route transitions and reduced-motion behavior when material.
- **Content and data**: approved labels/messages, real formatting and truncation/wrapping behavior, long/localized strings, realistic empty/error content, minimum/maximum data pressure. Do not fabricate metrics, claims, copy or data types.
- **Assets and motion**: existing approved assets and their provenance, icon/illustration roles, tokenized motion if present. Mark uninspected asset rights or unspecified duration/easing `UNKNOWN`; no fictional animation implementation.
- **Acceptance mapping**: each changed design obligation maps to a visible component/state and a measurable implementation check (desktop and mobile when applicable). Include functional/permission/keyboard/readability checks that need live execution. Hand off unresolved assumptions to the responsible decision maker.

A compact format is sufficient:

| Part / state | Source + evidence grade | Accepted requirement | Implementation owner (file/component) | Verification / open question |
| --- | --- | --- | --- | --- |
| Primary action / loading | project code path, MEASURED | Keep current action; indicate pending status | existing component | observe live pending and rapid repeat clicks |
| Small viewport | UNKNOWN | TBD, do not guess the breakpoint | TBD | inspect actual responsive implementation |

## Completion boundary

The handoff is **complete as a specification** when applicable states, authority, implementation mapping and unknowns are explicit. Do not turn missing details into fictional values to make it look complete. No new rendering, code, components or third-party data access is implied by a read-only handoff request. If implementation is also requested, route the actual build and verification through the existing DWA `build-product-surface` or `improve-existing` flow, including `verification-contract.md`. The actual result must then be inspected against this handoff, not certified by the handoff alone.

A standard `design-spec <target>` request continues to load only `design-first-prompting.md`; this extra handoff reference is opt-in.
