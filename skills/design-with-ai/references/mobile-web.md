# Mobile web product UI

Load only when the resolved target is browser/PWA UI on phones or tablets and
browser platform behavior materially affects the result. This reference is not
for SwiftUI/Compose/React Native/Flutter; those use `native-mobile.md` (and
`react-native-motion.md` for React Native motion).

Project support policy and current browser documentation beat this reference.
When exact support, meta-tag semantics, framework integration, or browser-specific
behavior is material, compose with `source-driven-development` and current
official browser/framework sources.

## Capability first, never device sniffing

Touch and mouse can coexist. Gate behavior by capability instead of user-agent or
screen-name guesses:

```css
@media (hover: hover) and (pointer: fine) {
  .control:hover { /* hover-only treatment */ }
}
```

A hover affordance cannot be the only way to reveal an essential action. Touch
still needs a pressed/selected state through the product's existing interaction
language.

## Remove browser tells without removing accessibility

- WebKit tap highlight can fight a deliberate press state; if the product removes
  it, ensure an equivalent visible pressed response exists.
- Do **not** disable pinch zoom with `user-scalable=no` or tiny maximum-scale
  values. Fix the layout/input cause instead.
- Avoid `user-select: none` on content. It is appropriate only for control labels,
  drag handles, or other surfaces where selection is accidental; preserve copy on
  addresses, IDs, errors, and user content.
- Long-press/callout suppression is likewise control-specific, not a global body
  rule.

## Viewport height

`100vh` is often the wrong mental model for browser chrome that expands/collapses.
Use the modern viewport unit whose semantics match the surface:

- `dvh` when an app shell/sheet should track the currently visible viewport;
- `svh` when a first screen/hero must remain stable and fit even with browser
  chrome visible;
- keep a legacy fallback only when the product's support matrix requires it.

Do not mechanically replace every `vh`: dynamic units can introduce visible
resize during scroll, which is undesirable for some document/marketing layouts.

## Inputs and soft keyboard

- On iOS Safari, small input text can trigger focus zoom. Use a legible input font
  size (commonly 16 CSS px or larger on affected touch contexts) instead of
  disabling zoom.
- Set semantic input type/inputmode/autocomplete/autocapitalize/enter-key hints
  according to the field rather than fighting the keyboard in JavaScript.
- Verify focused controls with the software keyboard open; fixed bottom actions,
  sheets, and chat composers must not disappear behind it.

## Touch ownership and scrolling

Use CSS/platform primitives before JS gesture interception:

- `touch-action: manipulation` can remove unnecessary gesture ambiguity on simple
  tappable controls when appropriate;
- a custom horizontal drag surface should preserve vertical page panning through
  the correct `touch-action` contract; values name what the **browser** still owns;
- prefer native scrolling + scroll snap for ordinary carousels when it satisfies
  the interaction before hand-rolling physics;
- use `overscroll-behavior` deliberately to prevent page scroll chaining or
  pull-to-refresh conflicts on app-like roots/inner scrollers; do not globally
  suppress platform behavior without a product reason;
- avoid non-passive `touchmove` + `preventDefault()` as a generic scroll fix.

## Safe areas and browser chrome

For edge-to-edge mobile web/PWA surfaces, verify whether the project needs
`viewport-fit=cover`, then pad fixed chrome/content using
`env(safe-area-inset-*)` where supported. Do not add safe-area padding to every
container; apply it to the surfaces that actually touch system edges.

Theme/status browser chrome should match the product's actual top surface and
supported color schemes. Use the platform/framework's current supported
`theme-color`/manifest mechanisms rather than hard-coded stale integration
patterns.

## Verification contract

Desktop device emulation is useful for layout but is not final evidence for
mobile-web feel. Important mobile-web changes should cover, when applicable:

- real phone/tablet hardware on supported browsers;
- sticky-hover and press behavior;
- browser chrome expanding/collapsing;
- safe-area/notch/home-indicator geometry;
- input focus + software keyboard;
- overscroll and nested scroll containers;
- orientation change;
- large text/zoom and reduced motion;
- installed PWA/standalone mode if the product targets it.

If hardware is unavailable, state which claims were verified from source/emulation
and which remain device-blocked. Never silently promote device-only assumptions
to verified behavior.

Source lineage: adapted from `emilkowalski/skills` `mobile-native` (MIT), narrowed
into Agent Hub's browser-on-mobile platform branch and reconciled with existing
native/mobile ownership.
