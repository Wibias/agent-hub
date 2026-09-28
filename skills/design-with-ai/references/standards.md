# Motion standards

Canonical craft rules for `motion-opportunities`, `motion-audit`, and
`motion-review`. Use these as defaults, then apply project tokens, product
frequency, accessibility requirements, and measured runtime evidence.

Runtime performance claims belong to `motion-optimize` and require profiling.

## 1. Should it animate?

Motion needs a user-understandable job: orientation, spatial continuity, state
change, feedback, explanation, direct manipulation, or deliberately budgeted
delight.

Frequency changes the budget:

| Frequency | Default posture |
|---|---|
| Very high frequency or keyboard-driven | Immediate response; remove decorative delay/movement |
| Frequent navigation/hover/toggles | Minimal, short feedback only when useful |
| Occasional modals/drawers/toasts | Standard UI motion can help continuity |
| Rare/first-time moments | More expressive motion may be justified |

Do not convert this table into an absolute ban on every visible transition after
a keyboard action. Functional state feedback may animate when it remains
immediate, interruptible, accessible, and does not slow expert use.

## 2. Timing and easing

Prefer project motion tokens when they exist. Otherwise use ranges as starting
points, not fixed laws:

| Interaction | Typical starting range |
|---|---|
| Press feedback | about 80-160 ms |
| Tooltip / small popover | about 125-200 ms |
| Dropdown / select | about 150-250 ms |
| Modal / drawer | about 200-500 ms depending on travel and complexity |
| Explanatory / marketing motion | may be longer when purpose justifies it |

Easing guidance:

- entering or exiting UI often benefits from responsive ease-out;
- motion between two visible on-screen positions often benefits from ease-in-out;
- colour/opacity feedback may use a simpler ease;
- constant-rate progress/marquee motion uses linear only when constant speed is the actual intent;
- avoid slow-starting ease-in when it makes an interaction feel delayed, but do not treat the keyword itself as a universal defect.

Use existing product curves before inventing new cubic-bezier values. Evaluate the
result in context rather than assuming one curve fits every component.

## 3. Physicality and origin

- Ordinary UI should not appear from `scale(0)` by reflex. Start near final size, use opacity/translation, or choose another transition that preserves continuity.
- Trigger-anchored popovers/menus should normally originate from the trigger or another spatially meaningful point.
- Centred modals and global overlays need not pretend to originate from a local trigger.
- Press feedback should be subtle and must not shrink hit targets or create layout shift.
- Do not require press scaling on every button. Use the product's interaction language.

## 4. Springs and direct manipulation

Use springs when velocity, interruption, drag, swipe, momentum, retargeting, or
an intentionally elastic product language benefits from physics-based motion.
Use deterministic easing when the transition should complete on a predictable
timeline.

Spring parameters are product/library specific. Start from existing tokens or
library defaults, then tune against the real interaction. Avoid decorative bounce
in dense or high-frequency workflows unless the selected product language calls
for it.

See `spring-decision.md` for the decision boundary.

## 5. Interruptibility

Rapidly retriggered or reversible interactions must continue smoothly from their
current state. CSS transitions, WAAPI, or a spring/tween system can all be valid
when they retarget correctly.

Keyframe sequences are appropriate for bounded one-shot choreography, but they
are a poor default for state that users can reverse mid-flight.

For direct manipulation:

- preserve pointer/touch ownership during drag;
- use velocity/momentum only when it matches the gesture model;
- apply resistance rather than abrupt invisible walls when the product expects elastic boundaries;
- protect against unintended multi-touch jumps;
- verify on real touch hardware when gesture feel matters.

## 6. Rendering and performance

Property cost and browser acceleration are not binary CSS-vs-JavaScript rules.
Measure the real candidate when performance matters.

### Rendering cost

- `transform` and `opacity` are the most widely reliable compositor-friendly properties and should be preferred for routine movement/fades.
- Geometry/layout properties such as width, height, margin, top, and left can trigger style, layout, and paint work. Avoid them for routine motion when a transform-based equivalent preserves semantics.
- Paint-heavy properties and large filtered/backdrop surfaces can also be expensive even when they avoid layout.
- Layout-property animation is not universally forbidden. Use it only when the visual requirement is real, the chosen platform technique supports it well, and verification shows acceptable behaviour.

### CSS, WAAPI, JavaScript, and Motion

- CSS and Web Animations API animations can run on the compositor for eligible properties and browser conditions. Do not claim that all CSS or WAAPI motion is off the main thread or GPU accelerated.
- `requestAnimationFrame` callbacks execute on the JavaScript main thread. Rendering cost still depends on what the callback changes.
- Motion can use WAAPI and can hardware-accelerate eligible animations. Its current performance guidance notes that independent transform values such as `x`/`scale` use CSS-variable composition and are not the same acceleration path as animating the full `transform` property directly.
- If main-thread contention is a measured problem and hardware acceleration is important, prefer direct `transform`/`opacity` animation where it preserves the intended behaviour, then profile the actual browser/device.
- Do not add `will-change` everywhere. Use it narrowly when profiling or a known first-frame issue justifies the extra compositing layer and memory cost.

For offscreen loops, RAF/canvas/WebGL work, observer gating, long-session slowdown,
or leak claims, switch to `motion-optimize` and `motion-performance.md`.

## 7. Visible by default

Core content must remain accessible without depending on entrance JavaScript or a
motion callback to reveal it. Progressive enhancement can animate an already
usable state.

If a first-render animation uses hidden initial styles, provide a reliable no-JS,
failed-JS, and reduced-motion path that leaves required content visible. A
screenshot of the happy path is not proof of this contract.

## 8. Accessibility and input capability

Respect `prefers-reduced-motion`. Remove or simplify non-essential spatial motion
for users who request reduction while preserving equivalent information and
usable feedback.

Gate hover-only effects to devices that actually support hover/fine pointer when
the effect would misfire on touch. Never make animation the only carrier of
state, success, error, or navigation meaning.

## 9. Sequencing and continuity

- Stagger only when grouping/order benefits comprehension or a rare expressive moment has an explicit budget.
- Do not block interaction while decorative stagger finishes.
- Enter/exit direction should preserve spatial story where one exists.
- Shared-element/layout continuity can be more useful than adding extra decorative effects.
- Blur, clip-path, masks, and 3D transforms are techniques, not quality signals. Use them only when the selected design needs them and performance/accessibility remain acceptable.

## 10. Review and debugging

When feel is uncertain:

1. inspect the animation at reduced playback speed;
2. check origin, coordinated property timing, interruption, and end state;
3. test rapid reversal/retriggering;
4. test reduced motion and relevant pointer modes;
5. test representative low/high-content states;
6. use browser performance tooling for performance claims;
7. use real devices for important touch/gesture interactions.

A motion review can block on craft or accessibility evidence without claiming a
runtime-performance root cause. Runtime jank/leak conclusions require the
separate profiling workflow.

## Current technical references

Performance statements were reconciled on 2026-09-04 against current MDN Web
Performance guidance and Motion's official animation-performance documentation.
Upstream craft lineage remains Emil Kowalski / `emilkowalski/skills` (MIT).
