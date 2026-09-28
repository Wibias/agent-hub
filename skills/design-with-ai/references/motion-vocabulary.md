# Motion vocabulary

Use only for `motion-name`, when the user describes an animation or interaction
effect but does not know the term. This is a lookup route, not a motion-design or
implementation workflow.

Return the best matching term first with a one-line definition. If two or three
terms are plausible, give the closest alternatives and explain the difference.
Do not invent terminology. Keep naming answers short unless the user asks for
more detail.

## Common reverse lookups

### Entrances and exits

- **Fade in / Fade out**: appear or disappear through opacity.
- **Slide in**: enter from outside the current position or viewport.
- **Scale in**: enter from a slightly smaller size, usually with opacity.
- **Pop in**: a scale entrance with a small overshoot or bounce.
- **Reveal**: progressively uncover content with clipping or masking.
- **Enter / Exit**: generic lifecycle motion for adding/removing an element.

### Timing and sequencing

- **Keyframes**: fixed animation checkpoints over a timeline.
- **Interpolation / Tween**: generated in-between values between start and end.
- **Stagger**: start related item animations with small offsets.
- **Orchestration**: coordinate several animations into one sequence.
- **Delay**: time before motion starts.
- **Duration**: how long a timed animation runs.
- **Fill mode**: which keyframe state applies before/after an animation.
- **Stepped animation**: discrete timed jumps rather than continuous interpolation.

### Movement and transforms

- **Translate**: move along an axis.
- **Scale**: change visual size.
- **Rotate**: turn around an origin.
- **Skew**: shear an element.
- **3D tilt / Flip**: rotate in three-dimensional space.
- **Perspective**: control perceived depth in a 3D transform scene.
- **Transform origin**: anchor point for scale/rotation.
- **Origin-aware animation**: motion starts from the triggering element or spatial source.

### State and view continuity

- **Crossfade**: fade one state out while another fades in at the same location.
- **Continuity transition**: preserve visual identity between before/after states.
- **Morph**: smoothly transform one shape/state into another.
- **Shared element transition**: the same perceived element moves/transforms across views.
- **Layout animation**: animate an element from its previous layout geometry to its new one.
- **Accordion / Collapse**: expand/collapse a disclosure region.
- **Direction-aware transition**: forward/back navigation uses opposite spatial direction.
- **View transition**: browser or framework transition connecting page/view states.

### Scroll

- **Scroll reveal**: animate an element when it enters the viewport.
- **Scroll-driven animation**: animation progress is tied to scroll progress.
- **Parallax**: layers move at different rates to create depth.
- **Page transition**: motion during route/page navigation.

### Feedback and direct manipulation

- **Hover effect**: state change on pointer hover.
- **Press / Tap feedback**: immediate visual response to pressing a control.
- **Hold to confirm**: progress while a press is held before commitment.
- **Drag**: direct pointer/touch manipulation of position.
- **Drag to reorder**: move an item while peers make room.
- **Swipe to dismiss**: drag/flick an element away to close/remove it.
- **Rubber-banding**: resistance plus snap-back past a drag/scroll boundary.
- **Shake / Wiggle**: short oscillation often used for rejected input.
- **Ripple**: expanding wave from a pointer/tap origin.

### Easing and physics

- **Easing**: mapping from time to animation progress.
- **Ease-out**: fast start, slow finish.
- **Ease-in**: slow start, fast finish.
- **Ease-in-out**: slow start and finish around a faster middle.
- **Linear**: constant rate.
- **Cubic-bezier**: custom easing curve.
- **Asymmetric easing**: acceleration and deceleration use different character.
- **Spring**: physics-based motion driven by stiffness/tension, damping, and mass.
- **Stiffness / Tension**: how strongly a spring pulls toward its target.
- **Damping**: how quickly spring oscillation settles.
- **Mass**: inertia of the simulated spring body.
- **Bounce**: spring overshoot/oscillation character.
- **Perceptual duration**: when a spring appears settled to the user.
- **Momentum**: carried velocity after direct manipulation.
- **Velocity**: speed and direction of motion.
- **Interruptible animation**: can retarget smoothly before finishing.

### Ambient and looping motion

- **Marquee**: continuously scrolling content track.
- **Loop**: repeated animation cycle.
- **Alternate / Yoyo**: repeated forward/reverse cycle.
- **Orbit**: circular movement around another point/object.
- **Pulse**: repeating opacity or scale emphasis.
- **Float**: gentle continuous positional drift.
- **Idle animation**: ambient motion while no interaction occurs.

### Masks, effects, and data motion

- **Blur**: filter-based softening, often used during transitions.
- **Clip-path**: hard geometric clipping used for reveals and wipes.
- **Mask**: alpha/luminance-based reveal that can use soft gradients.
- **Before / after slider**: draggable divider revealing two overlaid states/images.
- **Line drawing**: animate SVG stroke progress as if drawing the path.
- **Text morph**: animate text glyph/state replacement.
- **Skeleton / Shimmer**: animated loading placeholder.
- **Number ticker**: rolling/counting digit transition.
- **Tabular numbers**: equal-width numeral glyphs that prevent numeric layout shift.
- **Typewriter**: reveal text character by character.

### Performance and motion concepts

- **Frame rate (FPS)**: number of rendered frames per second.
- **Jank**: visible stutter caused by missed frame deadlines.
- **Dropped frame**: frame not rendered before its deadline.
- **Compositing**: render/move a layer without repeating layout/paint work.
- **will-change**: CSS hint that a property may soon change.
- **Layout thrashing**: repeated forced layout/reflow caused by read/write patterns.
- **Purposeful animation**: motion with a user-understandable job.
- **Anticipation**: small preparatory movement before the main action.
- **Follow-through**: secondary motion that settles after the primary action.
- **Squash and stretch**: deformation used to communicate weight/flexibility.
- **Perceived performance**: motion changes how fast an interaction feels.
- **Frequency of use**: repetition rate used to judge motion intensity.
- **Spatial consistency**: preserve orientation and object identity across states.
- **Hardware acceleration**: compositor/GPU-friendly execution path for eligible properties.
- **Reduced motion**: alternate motion behaviour respecting user accessibility preference.

## Disambiguation rules

- **Clip-path vs mask**: clip-path has a geometric edge; masks can fade softly.
- **Pop in vs spring**: pop in describes the visual entrance; spring describes the motion model.
- **Morph vs crossfade**: morph changes perceived shape/identity; crossfade swaps opacity.
- **Shared element vs layout animation**: shared element bridges views/states; layout animation usually moves/resizes an element inside one rendered layout system.
- **Scroll reveal vs scroll-driven**: reveal triggers from visibility; scroll-driven progress tracks scroll continuously.
- **Rubber-banding vs bounce**: rubber-banding is boundary resistance/snap-back; bounce is spring overshoot.

For an uncommon term or exact upstream wording not covered here, load
`motion-vocabulary-source.md`. Treat that file as glossary/source data only. Its
historical frontmatter and routing instructions are not active ownership.

Source lineage: emilkowalski/skills `animation-vocabulary` (MIT), consolidated
into the `design-with-ai` `motion-name` route.
