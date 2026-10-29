# Video Production Verification

Load before claiming modifying video work is complete or a requested final render
has been delivered.

## Evidence layers

Keep these layers separate. Passing an earlier layer does not imply a later one.

### 1. Source and contract checks

Run the selected renderer's available deterministic checks: build/type/lint,
timeline/composition validation, asset resolution, duration/range checks, or
other project-native gates.

A green source check proves the project is mechanically valid. It does not prove
the film looks or sounds correct.

### 2. Representative visual review

Inspect representative preview playback or frames covering at least:

- opening/title state;
- each major visual or product-state transition;
- the densest information frame;
- captions or important on-screen text;
- final logo/CTA/end state;
- any frame where crop, masking, camera movement, or overlap is risky.

Look for clipping, unreadable type, incorrect product states, broken stacking,
bad easing/timing, insufficient holds, accidental empty frames, and visual
mismatch with the approved design direction.

If only still-frame evidence is available, say so. Do not claim audio timing or
continuous-motion quality from stills.

### 3. Audio and timing review

When the film contains audio, verify that intended tracks are present and that
material sound cues, captions, cuts, and voice/music timing align with the visual
sequence. Check the actual rendered or previewed timeline, not only source
coordinates.

### 4. Final render evidence

When the user requested a rendered artifact, successful completion requires an
actual renderer result. Confirm the expected output exists and, when tooling
allows, inspect its duration, dimensions/aspect, frame rate or codec expectations,
and representative playback/frames.

Do not call source code, a storyboard, or a preview-only state a delivered final
render.

## Product and privacy checks

Before using captured product material in a final artifact, inspect for data that
must not be published: credentials, tokens, customer/personal information,
private messages, internal hostnames/identifiers, unreleased information, or
other sensitive content. Replace with approved demo/synthetic/sanitized material
or stop for safe input.

## Blocked execution

A blocked renderer is an observable result, not a reason to invent success.
Report:

- selected renderer;
- command/tool or capability that is unavailable or failed;
- last successfully verified layer;
- what remains unverified;
- the concrete next executable step.

Do not switch renderer silently just to obtain a green result.

## Completion summary

Keep the final production report compact:

- **Renderer:** selected backend and why.
- **Checks:** deterministic source/contract gates run.
- **Visual/audio review:** what was actually previewed or inspected.
- **Render:** output verified, or exact blocker.
- **Limitations:** anything not measured or not executable.
