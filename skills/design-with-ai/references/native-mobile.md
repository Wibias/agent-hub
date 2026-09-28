# Native and mobile product UI

Load only when the target is a native/mobile app or an explicitly native-like surface: SwiftUI/iOS, Android/Compose, React Native, Flutter, or another platform where safe areas, system text scaling, native gestures, and platform control semantics materially affect the design.

Do not apply native units or gesture assumptions 1:1 to desktop web.

## Platform truth first

- detect the actual target platform and framework before recommending implementation details;
- project components and the platform's current design/accessibility guidance beat this reference;
- use `source-driven-development` or official current documentation for framework/API details that may have changed;
- preserve native navigation, input, focus, and system-gesture conventions unless the product has a deliberate reason to diverge.

## Touch and system geometry

- approximately 44pt on iOS and 48dp on Android are useful baseline touch targets; verify the current platform requirement and the real hit region;
- a visual icon may be smaller when the non-overlapping hit area remains sufficiently large;
- fixed headers, tab bars, sheets, and CTAs respect safe-area/system-chrome insets;
- keep primary controls away from camera cutouts, home indicators, edge gestures, and system bars;
- scroll content must not disappear behind fixed chrome.

When the decision is unclear, load `design-guidance.md` and query `native` or `interaction` with one specific outcome.

## Text and responsive composition

- use platform text roles where appropriate rather than hard-coding screenshot sizes;
- verify large accessibility text / Dynamic Type equivalents; essential content and actions reflow instead of clipping;
- test representative phone sizes plus landscape; include tablet/foldable/windowed states when the product supports them;
- increase or transpose layout deliberately on larger device classes instead of stretching the phone composition;
- long values, badges, and controls must survive localization and text scaling.

## Controls, gestures, and feedback

- prefer semantic native controls/primitives for primary interactions;
- do not redefine system gestures casually;
- critical actions cannot be gesture-only;
- author-controlled drag/reorder/swipe interactions need an equivalent visible or assistive path when the result cannot otherwise be achieved;
- pressed/selected/disabled/loading states remain semantically correct even if visual feedback is interrupted;
- haptics and motion are supporting channels, never the only confirmation of state.

## Accessibility

- screen-reader order follows the meaningful visual/task order;
- icon controls have accessible names and applicable state;
- decorative icons are removed from the accessibility tree;
- authentication supports password managers and paste unless a real security contract requires otherwise, and provides a non-cognitive path where applicable;
- enlarged text, software keyboard, sheets, and sticky chrome must not obscure the focused control;
- color is never the only state channel.

## Themes and materials

Light/dark or platform material variants are not automatic deliverables unless product/platform requirements call for them. When both exist, verify contrast, borders, disabled/pressed/focus states, overlays, and system chrome independently rather than mechanically inverting tokens.

## Verification

For changed native/mobile UI, capture evidence on the actual supported platform/runtime when suitable tooling exists. At minimum cover:

- touch targets and safe areas;
- large text / localization pressure;
- screen-reader/focus order where testable;
- orientation/device-class changes;
- keyboard/input overlap;
- disabled/loading/error/recovery states;
- reduced motion and interrupted interaction;
- light/dark variants when the product supports both.

Source lineage: native/mobile quality concepts adapted from `nextlevelbuilder/ui-ux-pro-max-skill` snapshot `f3ac195224eac1eb0dfe1a3059c2a6add78ffbe3` (MIT), narrowed to platform-aware product UI rather than web-wide defaults.
