# Motion runtime performance

Use for `motion-optimize`: animation jank, offscreen work, RAF/canvas/WebGL loops,
long-session slowdown, leak risks, and CPU/GPU reduction.

## Core rule

Measure the real page before editing. The goal is not to remove motion; it is to
stop work that should not run, preserve useful visible motion, and release
long-lived resources on route/unmount.

Use the available browser/profiling capability for the real route. Source review
is necessary but is not live runtime evidence.

## 1. Inspect source

Read repository instructions and inspect the exact route owners. Map:

- animation hooks and CSS keyframes;
- `requestAnimationFrame` loops;
- intervals/timeouts;
- canvases/WebGL/Three/physics;
- media elements and streams;
- GSAP timelines/tweens;
- `IntersectionObserver`, `ResizeObserver`, `MutationObserver`, and custom
  subscriptions;
- global/window/document listeners;
- async loaders that can complete after unmount;
- effect cleanup paths.

Keep unrelated dirty work out of scope and plan narrow staging when the worktree
is not clean.

## 2. Capture a live baseline

Open the exact route and sample representative top, middle, and lower states,
plus mobile when layout can change what is visible/running.

For CSS animation evidence, count computed `animationName` and
`animationPlayState` for visible/offscreen owners, including `::before` and
`::after` when relevant. Inspect canvas/WebGL/RAF activity separately; CSS
profiling cannot prove JavaScript loops are stopped.

For leak or long-session asks, record bounded evidence such as:

- element/canvas/image/iframe/media counts;
- available JS heap metrics;
- an idle sample;
- repeated route-enter/leave cycles;
- active observer/listener/RAF debug state where observable.

If heap APIs or browser instrumentation are unavailable, state that limitation.
Stable DOM/canvas counts plus source cleanup review are useful evidence, but they
do not become proof of "no leak". Keep stress probes bounded and do not
attribute a browser crash beyond what a minimal reproduction supports.

Use `browser-profiling.md` for the reusable evaluator.

## 3. Patch the smallest owner

Prefer an existing project visibility/animation hook. Otherwise use the smallest
owner that can stop the unwanted work.

### CSS motion

- Observe the section/card/component that actually owns the animation.
- Toggle a stable offscreen state.
- Pause only the targeted animated descendants or tracks.
- Include pseudo-element glimmers when they own separate animations.
- Avoid ancestor selectors broad enough to pause visible hero/content motion.

Example pattern:

```css
main > section.is-offscreen .expensive-animation,
.expensive-animation.is-offscreen {
  animation-play-state: paused !important;
}
```

An `IntersectionObserver` threshold near `0.01` is a useful starting point for
visibility gating, not a universal constant. Reuse project conventions first.

### RAF / canvas / WebGL / physics

CSS `animation-play-state` cannot stop JavaScript render loops. Gate the loop
directly:

- start/resume only when the canvas/container is eligible and visible;
- cancel the RAF handle offscreen and before restarting;
- cancel it again on unmount;
- disconnect visibility observers in cleanup;
- expose a non-visual debug state such as `data-animation-active` when useful for
  verification;
- cap simulation delta after long pauses so resume does not run an oversized
  update.

### Cleanup matrix

When the owning effect creates a resource, its cleanup must release it:

- timeout/interval -> clear it;
- RAF -> cancel it;
- observer/subscription -> disconnect/unsubscribe;
- global listener -> remove with the same handler reference;
- Three/WebGL texture/material/geometry/renderer -> dispose it and remove owned
  renderer DOM nodes;
- GSAP tween/timeline -> kill owned work, including mutable target objects such as
  uniforms when applicable;
- media stream -> stop tracks; detached video/audio -> pause/release owned source;
- async loader -> guard with disposal state and dispose late-arriving resources.

In React effects, capture the cleanup node/value at effect setup when a mutable
ref may point somewhere else by cleanup time.

Respect existing reduced-motion handling and do not introduce React render loops
just to track scroll/animation state.

## 4. Reprofile the same states

Repeat the same route, viewport, and state samples. The target for the scoped
sections is zero unintended offscreen running work, not zero motion globally.

Confirm:

- visible motion still runs or resumes correctly;
- offscreen CSS/RAF/canvas work is actually inactive;
- route/unmount cycles return observable counts to a stable baseline, allowing
  for expected async content;
- normal interaction still works after observer/gating changes;
- fresh console warnings/errors do not reveal new failures.

## 5. Local gates and report

Run repository-native format/lint/type/build/test gates that cover the change.
For each result, distinguish pass/fail from known unrelated warnings.

Report:

- exact sampled routes/states/viewports;
- before/after runtime evidence;
- source-audit risks fixed or remaining;
- route-cycle/idle evidence when relevant;
- local checks;
- every unavailable metric or blocked instrument.

Do not claim a memory leak is fixed from one unavailable heap counter or from a
single screenshot.

## Good patterns

- section-level plus element-level visibility gates for long sections;
- one shared route visibility selector rather than ad hoc observers per leaf;
- direct RAF loop control for canvas/WebGL work;
- short bounded idle/route-cycle probes;
- captured cleanup nodes for mutable React refs;
- disposal guards for async image/video/texture/data loaders;
- source-visible debug attributes that make runtime state verifiable without
  altering the visual UI.

## Avoid

- Removing all motion just to make counters green.
- Pausing visible hero motion through broad ancestor selectors.
- Assuming CSS pause rules cover RAF/canvas/WebGL work.
- Trusting one top-of-page sample on a long route.
- Treating unavailable heap counters as proof there is no leak.
- Unbounded browser stress loops.
- Screenshots as runtime-performance proof.
- Mixing unrelated local hunks into the change.

Source lineage: MengTo/Skills `optimize-web-animations` (MIT), adapted into the
`design-with-ai` runtime motion branch.
