# Motion build

Use only for `motion-build <target-or-description>` after the target is resolved.
This is the construction route: it decides whether motion should exist and, when
it should, implements the smallest appropriate motion that fits the product.

Load `standards.md` first. Load `spring-decision.md` only when physics vs easing
is materially open. Load `motion-systems.md` when the work defines or extends a
shared product motion language rather than one bounded transition. Load
`direct-manipulation.md` for drag/swipe/gesture ownership. Load
`react-native-motion.md` only for resolved React Native/Expo targets.

## Construction sequence

Run this sequence in order. Earlier gates may legitimately end the workflow with
no animation code.

### 1. Should this move?

Name the user-facing job before writing code: feedback, continuity/orientation,
state indication, direct manipulation, explanation, or explicitly budgeted rare
delight. Then apply interaction frequency from `standards.md`.

If motion has no job, or repeated motion would slow expert/high-frequency use,
prefer the immediate/static behavior. Deleting unjustified motion is a successful
build result.

### 2. Choose the cheapest mechanism that preserves behavior

Prefer existing project primitives/tokens. For web, typical escalation is:

1. CSS transition for simple controlled state changes;
2. CSS entry/animation when choreography is predetermined and does not need live
   retargeting;
3. WAAPI for bounded programmatic control without adding a library;
4. the project's existing motion library for layout, exit, spring, or gesture
   behavior that genuinely benefits from it.

Do not install a motion dependency for a fade/press treatment, and do not replace
an established project motion stack merely because another library is preferred
upstream.

If the request is really for an accessible component primitive (dialog, popover,
select, toast, etc.), use the project's component-system owner rather than
hand-rolling focus/dismissal semantics inside this route.

### 3. Choose properties from the visual requirement

Prefer `transform` and `opacity` for routine movement/fades because they are the
most reliably compositor-friendly. Geometry, filters, masks, clip paths, and
other properties are allowed when the visual requirement is real; use
`standards.md` and runtime profiling rather than a universal prohibition.

Avoid `transition: all`. Do not reflexively enter from `scale(0)`. Trigger-anchored
surfaces normally use a meaningful transform origin; centered/global surfaces do
not pretend to come from a local trigger.

### 4. Choose timing model

Use project motion tokens first. Otherwise apply `standards.md` starting ranges.
Use deterministic easing when completion time matters and a spring when velocity,
interruption, direct manipulation, or retargeting is part of the interaction.

Do not invent a custom cubic-bezier or spring merely because upstream shows one;
existing product tokens and observed feel have authority.

### 5. Design interruption and exit

Anything users can rapidly reverse/retrigger must continue from the current
visual state instead of restarting from an obsolete origin. Direct manipulation
must preserve pointer/touch ownership and may need velocity handoff.

Enter/exit should preserve the spatial story where one exists. A user must not be
locked out while decorative motion finishes.

### 6. Ship accessibility and input capability with the implementation

- provide reduced-motion behavior that preserves meaning and immediate feedback;
- gate hover-only motion to hover/fine-pointer capability;
- never make motion the sole carrier of state/success/error;
- keep content usable when entrance JavaScript or an animation callback fails.

### 7. Verify the actual motion

Mechanical tests are necessary but not sufficient. When rendered tooling exists,
check the result in context and exercise:

- normal and rapid repeated triggers;
- mid-flight reversal/interruption;
- reduced motion;
- relevant pointer/touch modes;
- realistic content pressure;
- slow-motion/frame-by-frame inspection when feel is uncertain.

Runtime claims such as dropped frames, main-thread contention, GPU cost, RAF
leaks, offscreen loops, or long-session degradation belong to `motion-optimize`
and require live profiling. Do not claim a runtime root cause from source style
alone.

## Output

Keep the explanation small because the implementation is the deliverable:

- **Gate:** purpose + frequency decision, including any rejected motion.
- **Ingredients:** mechanism, properties, timing model/tokens, interruption path.
- **Verification:** what was rendered/feel-checked and what remains blocked.

Source lineage: construction ordering adapted from `emilkowalski/skills`
`animate` (MIT), with Agent Hub's project-token, accessibility, and measured
performance rules kept authoritative.
