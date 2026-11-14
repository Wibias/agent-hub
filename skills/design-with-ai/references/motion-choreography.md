# Motion choreography for coordinated elements

Load this **only when two or more elements move in response to the same event**
and their timing, overlap, layout or exit behavior must work together (for
example, a staggered list, a view swap, a multi-step transition or a compound
button effect). A single animated element belongs to `motion-build.md` and
`standards.md`; do not add this reference as mandatory context for it.

This is a selective Agent Hub adaptation of
[Emil Kowalski's choreograph skill](https://github.com/emilkowalski/skills/tree/c8a79627b59d72d764d6ab6f2c87c09a48169833/skills/choreograph)
(MIT, upstream `emilkowalski/skills@c8a79627b59d72d764d6ab6f2c87c09a48169833`).
`standards.md`, incumbent product tokens, accessibility, explicit user intent,
and actual render evidence remain authoritative. Do not import universal
timing bans or a new standalone route.

## Cast the moving elements

Inventory what visibly changes and why. Classify each participant:

| Role | Job | Default treatment |
|---|---|---|
| Lead | Communicates the main change | Largest/clearest justified movement |
| Support | Explains or reinforces the lead | Shorter or quieter movement, or none |
| Decoration | Nonessential accent | Opacity-only or static |
| Static | Context that should remain stable | No motion |

Start by removing animation that adds no information. **No animation** and zero
moving elements are acceptable outcomes. Avoid animating a parent entrance
and every child entrance if that doubles perceived wait without explaining a
relationship. Never make visible interaction depend on decorative motion
finishing.

## Choose a relationship, not independent delays

For each meaningful pair, select the smallest relationship that communicates
the event:

- **Together:** start in the same beat when the parts form one action or view.
  Prefer this for frequently used controls and exits that should not queue.
- **Overlap:** start the following part while the lead is moving when a brief
  wave clarifies reading order, attention or causality. Use a restrained
  stagger, with project motion tokens controlling total duration.
- **Sequence:** wait for a meaningful dependency, for example when two dense
  states would otherwise obscure each other. Avoid sequencing merely because
  one element appears later in the DOM.
- **Carry:** move the containing element when children should visibly travel
  together, rather than inventing independent animations for each child.

A uniform stagger is not inherently forbidden; reject it only when the observed
result is robotic, too slow or conflicts with the visual hierarchy. In high-
frequency or keyboard-driven UI, prefer Together or no animation to decorative
stagger. The content must be operable as soon as it is visible.

## Motion / React semantics

Use official API semantics rather than importing an upstream shortcut:

- `AnimatePresence mode="sync"` is the **default**: entering and exiting
  children start together, but the exiting child remains in normal layout.
  For a shared-container crossfade use explicit overlapping positioning, or
  `popLayout` if exiting content must leave layout immediately. Verify actual
  layout and focus rather than assuming the mode alone guarantees overlap.
- `AnimatePresence mode="wait"` intentionally sequences exit before enter and
  supports one child at a time. Use only when that pause carries meaning.
- `AnimatePresence mode="popLayout"` removes exiting children from layout
  immediately so siblings can reflow while the exit finishes. Check positioning
  and `forwardRef` for custom immediate children.

Authority: [Motion's AnimatePresence documentation](https://motion.dev/docs/react-animate-presence).
For non-React implementations, preserve the behavioral relationships and use
the existing framework/library primitives; never install Motion just for this.

## Plan and verify the shared event

Before coding, sketch a compact **timeline** with one row per moving element:
element, role, starts, duration, treatment and relationship. Include what
remains static. A planned sequence is not a license to add movement to every
part; cut decorative steps that delay use.

Then verify the rendered interaction at normal and reduced speed:

1. Does the event read as one intentional gesture rather than a queue of
   unrelated entrances? Compare with a static/less-moving candidate.
2. Can a user interact with the visible control without waiting for the
   timeline? Do rapid retrigger and reversal tests, including mid-flight exits.
3. Do sibling layout changes overlap appropriately with leaving elements?
   Check stable keys, focus, unmount/completion dependencies and layout shifts.
4. Under `prefers-reduced-motion`, collapse nonessential movement and delays
   while preserving state information and immediate feedback.
5. Check touch/pointer and realistic content sizes. Animation feel needs
   rendered evidence; runtime jank or GPU claims require `motion-optimize`
   profiling, not inference from a code snippet.

When a simpler single transition or immediate state swap communicates the
change, use that. Keep timing values as adjustable starting points, not absolute
cross-product requirements.
