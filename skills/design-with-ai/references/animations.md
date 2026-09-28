# Micro-animation craft

Use only during the Craft phase for motion that already exists or has been
approved by a selected motion workflow. `standards.md` is canonical for purpose,
frequency, easing, duration, physicality, accessibility, and performance. When an
older recipe conflicts with `standards.md`, the standard wins.

## Interruptibility first

Users change intent mid-interaction. Rapidly retriggered or reversible UI must
retarget from its current state instead of restarting from zero.

| Technique | Best fit |
|---|---|
| CSS transition | interactive state that can reverse/retrigger |
| spring | direct manipulation, velocity, gesture retargeting |
| keyframes | predetermined one-shot sequence that does not need retargeting |
| WAAPI | programmatic predetermined motion with browser-native control |

Do not choose keyframes merely because the syntax is convenient.

## Entrances

Motion must preserve visible-by-default content. Do not leave core UI at
`opacity: 0` waiting for hydration/JavaScript.

Prefer progressive-enhancement patterns such as `@starting-style` when the
browser support/project allows it:

```css
.notice {
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity 180ms var(--ease-out),
    transform 180ms var(--ease-out);

  @starting-style {
    opacity: 0;
    transform: translateY(6px);
  }
}
```

For framework motion, verify the server/default state remains usable and visible
without the entrance completing. Do not hide primary page content solely to stage
an animation.

### Split and stagger

A selected entrance may split semantic groups instead of moving one giant
container. Keep stagger restrained, normally 30-80 ms between items, and never
block interaction while the sequence completes. Dense/high-frequency product UI
usually needs no staged entrance.

## Exits

Exits should preserve continuity without competing for attention. Use short,
subtle motion and the canonical easing rules from `standards.md`. An instant exit
is acceptable when frequency, reduced-motion preference, or task speed makes
motion harmful.

```css
.item-exit {
  opacity: 0;
  transform: translateY(-6px);
  transition:
    opacity 140ms var(--ease-out),
    transform 140ms var(--ease-out);
}
```

Do not use `transition: all`, oversized translations, dramatic scale collapse,
or UI `ease-in` as a default exit recipe.

## Contextual icon changes

Animate icon changes only when the state transition benefits from continuity.
Static navigation/decorative icons do not need motion.

Good candidates:

- play -> pause;
- selected -> unselected state;
- contextual action appearing in an occasional toolbar;
- loading -> success where the state change matters.

Use modest opacity/scale/blur and keep the icon's container geometry stable.
For ordinary product UI, begin near final scale (normally around 0.9-0.97), not
from an exaggerated tiny value. Exact values follow `standards.md` and product
personality.

If the project already uses Motion, `AnimatePresence initial={false}` can prevent
default-open/stateful chrome from replaying an entrance on first mount. Do not
use `initial={false}` where the component legitimately relies on an approved
first-time entrance. Verify full-page refresh behaviour.

If the project does not already ship a motion library, do not add one solely for
an icon cross-fade. CSS transitions with both states present can preserve
interruptibility and bundle discipline.

## Press feedback

Press scale is optional feedback, not a universal button tax. When appropriate:

- keep it subtle, usually about 0.96-0.98;
- use an interruptible transition;
- do not shrink disabled/static controls;
- preserve the accessible hit area;
- follow existing project motion tokens when they exist.

```css
.pressable {
  transition: transform 140ms var(--ease-out);
}

.pressable:active:not(:disabled) {
  transform: scale(0.97);
}
```

High-frequency/keyboard actions may be better with no motion. The interaction
frequency rule in `standards.md` overrides this recipe.

## Origin and continuity

- Trigger-anchored popovers scale/move from their trigger origin.
- Centred modals may remain centred.
- Add/remove/reorder interactions should preserve object identity when possible.
- Swipe/drag motion belongs to spring/gesture guidance when velocity and
  resistance are part of the interaction.

## Reduced motion and pointer capability

Provide a gentler reduced-motion path for movement-heavy transitions while
retaining useful opacity/colour feedback. Hover-only motion must be gated to
hover-capable fine pointers.

## Verification

For touched motion, check:

- interrupt/reverse during the transition;
- initial page load and hydration;
- keyboard-triggered paths;
- reduced-motion preference;
- touch versus hover-capable pointers;
- transform origin;
- no clipping/layout jump;
- no new runtime-performance claim without `motion-optimize` evidence.

Source lineage: jakubkrehel/make-interfaces-feel-better (MIT), reconciled with
the unified `design-with-ai` motion standards.
