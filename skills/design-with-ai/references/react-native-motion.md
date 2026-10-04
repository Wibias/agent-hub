# React Native and Expo motion

Load only after the target is resolved as React Native or Expo and the task
actually involves motion/gestures. General native/mobile layout, safe areas, text
scaling, focus, and platform semantics remain in `native-mobile.md`.

This file carries durable engineering principles, not a frozen Reanimated/Expo
API snapshot. Detect the project's Expo SDK, React Native version, animation and
gesture packages first. For exact package compatibility, current APIs,
deprecations, setup, router/native component options, or compiler requirements,
compose with `source-driven-development` and current official Expo/React Native/
Reanimated/Gesture Handler documentation.

## Runtime ownership

Per-frame interaction state should not force React renders. Keep continuous
values in the animation/gesture runtime supported by the project's stack and map
them directly to animated styles/props. React state remains for semantic/product
state, not 60/120 Hz pointer updates.

Avoid scheduling work back to the JS/React runtime on every gesture or scroll
frame. Cross runtime boundaries at meaningful semantic moments (commit, threshold,
end) rather than continuously.

## Choose the platform primitive before rebuilding it

Prefer platform/native navigation, sheets, tabs, refresh controls, context menus,
keyboard-following primitives, and accessibility behavior when they satisfy the
product. Hand-rolled motion is justified when the interaction itself is custom,
not merely because an animation library is available.

Package/API names move quickly. Verify current project and official docs before
recommending a specific Expo Router or native-component API.

## Properties and layout

Prefer transforms/opacity for routine per-frame movement. Layout-affecting values
can be valid when the element/interaction requires geometry changes and the
chosen runtime supports them efficiently; verify on representative hardware
instead of turning this into an absolute ban.

Avoid animating expensive shadows/blur or forcing sibling layout every frame when
a composited/static-layer alternative preserves the design.

## Timing vs spring

If the user's finger directly drove the value, settling usually benefits from an
interruptible physics model with velocity handoff. Predetermined state changes
usually benefit from timing/easing. Use project tokens/configs first and
`spring-decision.md` for the conceptual boundary.

Never freeze exact upstream spring configs as universal values. Library versions,
units, product feel, and platform defaults matter.

## Gesture continuity

Use `direct-manipulation.md` for drag/swipe mechanics. In particular:

- visual response begins with the gesture, not after release;
- continuous movement stays out of React render loops;
- re-grabbing a settling element starts from the current presentation value;
- velocity/momentum survives the handoff when the library supports it;
- platform/system gestures retain priority where expected.

## Haptics

Haptics are supporting feedback. Use them sparingly at causal moments such as a
selection detent, snap/commit, success, or error. They must align with the visual
state change and never become the sole carrier of meaning.

Exact haptic APIs and platform availability are version-sensitive; verify current
official docs.

## Reduced motion and text scaling

Respect system reduced-motion preference. Preserve opacity/color/state feedback
while removing or reducing large translation, parallax, bounce, or vestibular
movement as appropriate.

Text scaling can invalidate hard-coded measured heights. Avoid motion contracts
that assume default font metrics when content may scale materially.

## Verification

Motion feel is not verified in a desktop browser or simulator alone. Important
React Native/Expo motion should be checked in a release-like build on real
supported hardware, including a slower representative device when performance is
material.

Cover, as applicable:

- rapid/repeated interaction while JS/React work is busy;
- gesture interruption and reversal;
- low/high release velocity;
- keyboard transitions for input-adjacent UI;
- reduced motion and large text;
- both supported platforms where behavior differs;
- high-refresh devices only when the product/runtime actually supports them.

If runtime/device evidence is unavailable, distinguish implementation review from
verified feel/performance.

Source lineage: selectively adapted from `emilkowalski/skills` `animate-expo`
(MIT), with version-sensitive APIs intentionally delegated to current official
sources.
