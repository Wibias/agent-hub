# Critique protocol - never ship the first draft

## Core sequence

```
Read brief -> Build -> Critique with fresh eyes -> Revise -> Gate -> Ship
```

The first version is evidence to judge, not proof that the design is finished.

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

## Senior designer filter

Check the applicable questions:

1. One clear focal point and readable eye path?
2. Colour roles are intentional and required contrast holds?
3. Spacing relationships and density are coherent?
4. Values come from project/system tokens or documented local decisions?
5. Can non-essential decoration be removed?
6. Applicable states and failure paths are covered?
7. Representative mobile/tablet/desktop layouts preserve content priority?

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
polish alone does not fix a template problem.

## Pushback protocol

Follow the router and project instructions. Preserve locked product truth,
security, accessibility, and other higher-authority constraints while proposing
the smallest viable alternative.
