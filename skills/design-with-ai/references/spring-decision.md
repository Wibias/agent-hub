# Spring vs easing

Use this only when a motion workflow needs to choose between deterministic easing
and physics-based motion.

## Prefer easing

Use CSS/WAAPI easing for predetermined UI transitions: popovers, dropdowns,
small enter/exit transitions, colour/opacity changes, and motion that should end
on a predictable schedule.

- enter/exit: strong ease-out
- on-screen movement: ease-in-out
- constant progress/marquee: linear
- avoid UI ease-in

## Prefer springs

Use a spring when velocity, interruption, direct manipulation, or retargeting is
part of the interaction: drag, swipe/dismiss, momentum, rubber-banding, or an
“alive” element that must continue naturally from its current velocity.

Keep bounce restrained unless playfulness is a product requirement.

## Frequency gate

Do not add spring motion to high-frequency or keyboard actions. If motion itself
is not already justified, run `motion-opportunities` first.

## Related internal references

- exact motion values and physicality: `standards.md`
- missing-motion gate: `opportunities.md`
- micro interaction implementation details: `animations.md`, `surfaces.md`
- product motion language: `motion-systems.md`
