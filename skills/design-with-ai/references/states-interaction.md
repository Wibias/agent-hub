# States and interaction

Interactive UI without the states required by its actual behaviour is unfinished,
not minimal.

## Applicable control states

For each button, link, input, select, switch, tab, or interactive card action,
identify which states the component can really enter. Implement and verify those
states instead of forcing irrelevant states onto every control.

| State | Requirement when applicable |
|---|---|
| default | Rest style from project tokens/system |
| hover | Pointer-only affordance; one restrained primary change is usually enough |
| focus-visible | Distinct keyboard focus treatment independent from hover |
| active / pressed | Immediate feedback that fits the product motion language |
| disabled / unavailable | Semantic disabled state plus clear visual treatment; cursor choice follows platform/component convention |
| loading / pending | Stable progress state that prevents duplicate action when needed |
| error / invalid | Specific recoverable message with appropriate accessible relationships |
| success / complete | Show only when the result is not already clear from the changed UI |

Keyboard users never depend on hover. Focus is a separate interaction state.
Do not invent loading/error/success states for controls that cannot enter them.

## Inputs

- Use a persistent accessible label unless the product pattern supplies an equivalent accessible name and the design system explicitly supports it.
- Keep border width stable across focus/error states when changing width would shift layout.
- Use a visible focus treatment that meets the project accessibility system. Never remove focus indication without an equivalent replacement.
- Match adjacent control heights when the composition calls for a shared row.
- Touch targets should normally approach 44 x 44 px. Dense desktop controls may use about 40 x 40 px when appropriate. Small visible controls can use a safe expanded hit area that does not overlap neighbours.
- Reserve helper/error space when dynamic appearance would otherwise cause disruptive layout shift. Do not reserve empty space blindly when the surrounding layout can reflow safely.
- Choose validation timing from task risk and product behaviour. Blur and submit are common checkpoints; do not interrupt typing with avoidable noise.

## Composition-aware text input and RTL surfaces (2026-11-27 review)

Apply these checks when a product accepts multilingual text, uses a custom
Enter-to-submit control, or explicitly supports right-to-left (RTL)
interfaces. This is a **conditional interaction contract**, not a request
to localize every product or replace a native input's default behavior.

### IME composition and Enter-to-submit

- East Asian input methods may use Enter to **confirm a composition** rather
  than submit a message, search, or form. A custom `keydown` shortcut must
  not submit while `event.isComposing` is true. Some browsers send the final
  Enter event with `isComposing=false` while `keyCode===229`; where the
  supported browser exhibits that behavior, guard this case too. The legacy
  key code is a compatibility fallback, not a primary input API.
- Preserve the native composition lifecycle (`compositionstart`,
  `compositionend`), intermediate text, and selection. Avoid converting
  or validating partial composition as a committed value; perform
  transformation/search/validation after the input is committed under the
  product's actual timing contract. Do not swallow native composition
  confirmation just to satisfy a custom shortcut.
- A separate, real Enter after confirmed composition may submit once.
  Respect Shift+Enter for intended line breaks, applicable modifier keys,
  key repeat and the normal native form submit contract. Test with an
  actual Japanese, Chinese, or Korean IME when available, not just a
  synthetic event mock; when unavailable, mark runtime verification
  `NOT_VERIFIED`.
- On failed submission, retain the user's entered text and selection as
  appropriate, keep the error actionable, and permit correction/retry.
  Do not replace this recovery path with a short-lived toast.

### RTL and bidirectional content

- Derive interface direction from the **actual supported language and
  product contract**. For a true RTL surface, review spacing, placement,
  reading order, focus traversal, numbers, mixed-language copy and
  navigation with actual Arabic/Hebrew content. Prefer CSS logical
  properties such as `margin-inline-start`, `padding-inline` and
  `inset-inline-end` over hard-coded left/right assumptions.
- Distinguish interface chrome from user-generated text. Use an
  appropriate `dir` (including `dir="auto"` for unconstrained,
  mixed-direction user content) when needed; isolate LTR code, URLs,
  IDs and similar tokens so visual rearrangement does not corrupt their
  meaning or copy/paste.
- Do not mirror entire interfaces, logos, charts, camera/video feeds or
  inherently directional content blindly. A back/forward icon, gesture
  or arrow-key mapping is reversed only when the specific platform and
  control convention requires it.
- Verify focus-visible state, keyboard navigation, labels, validation
  messages, truncation/overflow and input selection under both directions
  on supported target browsers/devices. LTR screenshots alone do not
  qualify RTL readiness; untested cases remain `NOT_MEASURED`.

Source review: selectively adapted behavior cases from
`nextlevelbuilder/ui-ux-pro-max-skill` at
`72e5fc76a4f3eb37747dc472cb3091bd46e7752a`
(`test_ime_composition.py`, `test_rtl_support.py`,
`test_form_error_handling.py`). No upstream search engine, Python runner,
catalog or extra design-owner skill is installed.

## Overlays

Prefer an existing accessible project primitive. When building without one, use
platform primitives such as `<dialog>`/Popover API or an accessible portal layer
that owns focus, dismissal, stacking, and clipping correctly.

Do not trap a dropdown inside an `overflow: hidden` ancestor when it must escape
that clipping context.

## Feedback

- Prefer undo over pre-action confirmation for safely reversible actions when the product supports reliable reversal.
- Use toasts for failures or effects that would otherwise be invisible. Do not duplicate an already obvious success state with notification noise.
- Loading skeletons should match the actual content structure. A generic spinner is not a substitute for useful progress or stable layout when more specific feedback is available.

## Empty / error / denied

Compose empty and failure states around the user's next decision:

1. what happened or what is absent;
2. relevant reason or consequence;
3. one clear next action when an action exists.

Error copy should make recovery possible. Access-denied states should explain the
relevant access boundary rather than use generic failure copy.

## Motion

Motion is not automatically added by this state checklist. Existing or selected
motion follows `standards.md`, `motion-systems.md`, and the active motion route.

Typical responsive ranges are supporting guidance, not universal constants:

| Kind | Typical range | Default character |
|---|---|---|
| Press feedback | 80-160 ms | fast and interruptible |
| Menu / tooltip enter | 125-250 ms | responsive ease-out |
| Modal / drawer enter | 200-500 ms depending on travel | responsive, exit normally faster |
| Rare explanatory/section motion | may be longer | only after purpose/frequency gate |

Never add decorative motion to keyboard-initiated high-frequency actions.
Never use `transition: all`. Avoid layout-property animation by default; a
selected workflow may use it only with a clear reason and verification.
Core content remains visible by default.

For exact easing, spring, accessibility, and physicality rules use
`standards.md` and `spring-decision.md`. Missing-motion work uses
`motion-opportunities`; runtime jank/leak claims use `motion-optimize`.

## Component-scope demo

For a component review or design-system task, an optional labelled state preview
can show all applicable states at once. Preview-only forced classes must not leak
into production behaviour.
