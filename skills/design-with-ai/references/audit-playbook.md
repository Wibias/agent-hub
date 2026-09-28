# Motion audit playbook

Use for broad existing-motion audits. Exact implementation values come from
`standards.md`; this file owns audit structure, prioritisation, and evidence
quality.

## 1. Purpose and frequency

Every animation must explain spatial continuity, state, feedback, causality, or
prevent a jarring change.

| Frequency | Default decision |
|---|---|
| 100+ times/day or keyboard initiated | remove motion |
| tens/day | remove or drastically reduce |
| occasional, such as modals/drawers | standard motion |
| rare/first-time | delight may be justified |

## 2. Easing and duration

Use `standards.md` for exact values. Audit for the semantic fit of timing:

- enter/exit: strong ease-out;
- on-screen movement: ease-in-out;
- hover/colour: ease;
- constant motion: linear;
- UI ease-in is a finding;
- ordinary product UI should remain short unless its component category or
  deliberate interaction explicitly permits longer timing.

## 3. Physicality and origin

- No ordinary entrance from `scale(0)`.
- Trigger-anchored content originates from its trigger; centred modals may remain
  centred.
- Press feedback remains subtle and fast.
- State transitions should preserve object identity where possible rather than
  teleport between unrelated states.

## 4. Interruptibility and gestures

Rapidly retriggered or reversible motion must continue from current state.
Prefer transitions or springs where appropriate over keyframes that restart.
Gesture motion should account for velocity, boundaries, pointer capture, and
multi-touch where the interaction requires them.

## 5. Performance risk visible from source

- Flag `transition: all` and avoidable layout-property animation.
- Prefer compositor-friendly properties for predetermined visual motion.
- Prefer CSS/WAAPI where they fit the interaction.
- Treat parent-inherited animation variables, unbounded RAF, timers, observers,
  and heavy blur/filter use as source-level risk signals when evidence supports
  them.

Do not convert source risk into a live-performance claim. RAF/canvas/WebGL
activity, offscreen work, CPU/GPU cost, memory growth, and leak claims require
`motion-optimize` runtime profiling.

## 6. Accessibility and pointer capability

Movement must honour reduced-motion preferences. Keep useful opacity/colour
feedback where it aids comprehension while removing unnecessary movement. Gate
hover-only motion to hover-capable fine pointers.

## 7. Cohesion and tokens

Motion must match product personality and shared duration/easing tokens. Flag:

- near-duplicate curves/timings without semantic reason;
- isolated bounce in an otherwise crisp product;
- inconsistent enter/exit direction or transform origin;
- group entrances that need a restrained stagger;
- motion that contradicts established component behaviour.

## 8. Missed opportunities

Report only grounded seams where motion would explain state, orientation, or
continuity. Cap incidental missed opportunities at four. A dedicated missing-
motion sweep uses `opportunities.md` and its full gate/report contract.

## Recon checklist

Before judging, map:

- framework and motion libraries;
- global tokens and keyframes;
- component-library primitives;
- motion-heavy routes/shared components;
- product personality;
- interaction-frequency map;
- existing reduced-motion and pointer-capability patterns.

Useful searches include `transition`, `animation`, `@keyframes`, `motion.`,
`animate=`, `useSpring`, `ease-in`, `transition: all`, `scale(0)`,
`prefers-reduced-motion`, `transform-origin`, RAF/timers, and observer setup.

## Finding quality

Every finding requires:

- confirmed current location;
- exact evidence;
- severity and category;
- terse fix direction;
- whether it is a craft verdict, source-level performance risk, or a claim that
  requires separate live profiling.

Reject duplicates, intentional documented trade-offs, stale code, and claims
that require live feel/profiling evidence you do not have.

## Prioritised output

Use impact divided by effort, not file order:

| # | Severity | Category | Location | Finding | Fix summary |
|---|---|---|---|---|---|

Present vetted findings before planning or implementation. `quick` focuses on
high-traffic/high-impact items, `standard` covers all interactive UI in scope,
and `deep` includes lower-severity polish after higher-impact findings are
exhausted.
