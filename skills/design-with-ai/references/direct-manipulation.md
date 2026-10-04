# Direct manipulation mechanics

Load for drag, swipe, throw, reorder, sheet/drawer gestures, or another interaction
where the user's pointer/finger directly controls motion. These are interaction
mechanics, not an Apple visual style.

## 1. Track 1:1 during the gesture

The manipulated object should stay attached to the pointer/finger while the
gesture is active. Preserve the offset from where the user grabbed the object;
do not jump the object center under the pointer on pointer-down.

On the web, use Pointer Events and pointer capture when appropriate so ownership
continues when the pointer leaves the element. On native platforms use the
project/framework gesture primitive. Version-sensitive APIs belong to current
official docs via `source-driven-development`.

## 2. Decide intent with hysteresis, not latency

Small accidental movement around a press should not immediately become a drag.
Use the product/platform's existing gesture threshold or a small deliberate
hysteresis before committing an axis/direction. Do not add a long recognition
delay that makes direct manipulation feel detached.

When several gestures are plausible, observe them in parallel until intent is
clear, then cancel the losing interpretation. Avoid APIs that report only a final
swipe direction when continuous feedback is required.

## 3. Interrupt from the presentation state

A new gesture or reversal starts from what is currently on screen, not from the
old logical target. Users must be able to grab a moving sheet/card and redirect
it immediately. Never disable input merely because an animation has not finished.

The implementation mechanism must preserve continuity when retargeted. If a
library/API cannot be interrupted without a visible jump, it is the wrong tool for
that interaction.

## 4. Hand off velocity

When direct manipulation releases into animated settling, preserve the release
velocity when the selected platform/library supports it. A sudden velocity reset
creates a visible seam between the user's movement and system motion.

Do not invent units or conversion formulas from memory. Confirm the library's
velocity units and spring API from current official docs when they affect code.

## 5. Project intent, then choose a snap target

For flick/throw interactions, the nearest target to the raw release position is
often wrong. When the product interaction calls for momentum, project the motion
forward using the platform/library's established decay model, then choose the
appropriate snap point and settle there while handing off velocity.

This is not required for every drag. Sliders, precision handles, and bounded
reorder interactions may intentionally use position rather than momentum.

## 6. Use soft boundaries deliberately

Where the product expects elastic physical feedback, crossing a boundary should
increase resistance rather than hit an invisible brick wall. Rubber-banding must
remain bounded and must not imply that unavailable content can actually be
reached.

Hard boundaries are still correct for precision/security/semantic constraints.
Choose from the interaction meaning, not from a universal desire for bounce.

## 7. Preserve causality

Visual, optional haptic, and optional audio feedback should correspond to the
same causal moment: detent captured, reorder committed, dismissal accepted, or
operation failed. Supporting channels must never be the only confirmation.

## Verification

For meaningful direct manipulation, verify:

- grab offset and pointer capture/ownership;
- threshold behavior and axis disambiguation;
- rapid reversal mid-flight;
- release at low and high velocity;
- cancel/re-grab while settling;
- boundary resistance and snap targets;
- reduced motion;
- real touch hardware when touch feel matters.

If hardware or runtime tooling is unavailable, state that feel/performance remains
blocked rather than claiming it from code inspection.

Source lineage: direct-manipulation principles selectively adapted from
`emilkowalski/skills` `apple-design` (MIT) and Apple's public fluid-interface
principles, without importing an Apple visual/material house style.
