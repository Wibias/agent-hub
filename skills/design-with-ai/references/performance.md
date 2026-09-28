# Micro-motion performance

Craft-level performance guidance for transitions. This file does not replace
`motion-optimize`: source inspection can identify risk, but live jank/offscreen/
CPU/GPU/leak claims require runtime profiling.

## Transition only what should change

Prefer explicit transition properties. Avoid `transition: all` because unrelated
state/style changes can begin animating unexpectedly.

```css
.button {
  transition:
    transform 150ms var(--ease-out),
    background-color 150ms ease;
}
```

Framework/utility shorthands vary by version. Do not assume a utility named
`transition` literally maps to `all`; inspect the project's generated CSS or
framework documentation when that distinction matters. Even when the shorthand
expands to a finite list, use a narrower property list when the component only
needs one or two properties.

## Property choice

For ordinary UI motion, prefer compositor-friendly `transform` and `opacity`.
Other properties can be valid when the visual effect genuinely requires them,
but understand their paint/layout cost rather than treating "GPU" as a binary
label.

- `transform`, `opacity`: default motion workhorses.
- `filter`, `clip-path`: useful in bounded cases but can still be expensive,
  especially on large surfaces or some browsers/devices.
- `width`, `height`, `top`, `left`, margin/padding: can trigger layout and should
  not be the habitual animation path.
- colour/background/border/shadow transitions can be fine for small bounded
  components but are not equivalent to transform-only compositor work.

Use the browser profiler when actual cost is material to the task.

## `will-change`

`will-change` is a targeted hint, not a default class for anything animated.
Extra compositing layers consume memory and can make performance worse.

Rules:

1. Do not use `will-change: all`.
2. Do not add `will-change` pre-emptively to a whole component family.
3. Use it only for a property/browser case where profiling or a confirmed
   first-frame issue justifies the hint.
4. Prefer applying/removing it around active motion rather than leaving it on
   permanently.
5. Reprofile if the hint is introduced for performance reasons.

```css
/* Bounded use around active motion */
.card[data-animating='true'] {
  will-change: transform, opacity;
}
```

## Craft review questions

- Does the transition list include properties that never animate?
- Can a broad utility/shorthand animate an unrelated future state change?
- Is a layout property moving because the implementation was convenient rather
  than because the effect requires it?
- Is blur/filter area larger than necessary?
- Is `will-change` persistent without evidence?
- Is JavaScript updating style/state every frame where CSS/WAAPI could own a
  predetermined effect?
- Does this observation require `motion-optimize` before making a runtime claim?

## Boundary with runtime optimisation

Route to `motion-optimize` when the question involves:

- dropped frames/janky scrolling;
- offscreen animations that may still run;
- RAF/canvas/WebGL/physics loops;
- CPU/GPU usage;
- observers/timers/listeners and long-session cleanup;
- memory/leak behaviour;
- route-cycle performance.

The runtime workflow measures the real page and patches the smallest owner. This
micro reference only prevents obvious transition-level footguns during Craft.

Source lineage: jakubkrehel/make-interfaces-feel-better (MIT), reconciled with
the unified runtime-performance boundary.
