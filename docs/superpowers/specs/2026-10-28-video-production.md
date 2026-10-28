# Video Production Skill Spec

## Intent

Add one canonical Agent Hub owner for creating, editing, reviewing, and rendering authored video artifacts without multiplying renderer-specific discovery surfaces.

## Goals

- Add `video-production` as the discovery owner for launch films, product promos, explainers, social clips, data videos, and other authored video output.
- Keep UI motion owned by `design-with-ai/motion-build`.
- Route existing Remotion projects to Remotion.
- Prefer HyperFrames for new agent-authored videos when no renderer is already selected and the task does not require Remotion-specific application/editor capabilities.
- Treat video-shotcraft as production methodology and shot vocabulary, not a competing top-level owner.
- Reuse an existing project design authority or `design-with-ai` durable design contract instead of creating a second brand/token source of truth.
- Keep framework-specific facts current through upstream docs/source rather than freezing large vendor corpora in Agent Hub.

## Non-goals

- Vendor HyperFrames, Remotion, or video-shotcraft source trees.
- Replace browser session recording in `playwright`.
- Replace transcript extraction in `youtube-transcript`.
- Turn `design-with-ai/motion-build` into a film-editing workflow.
- Add Penpot or diagram-design in this phase.

## Ownership

`video-production` owns the authored-video workflow and renderer selection.

Neighboring owners:

- `design-with-ai`: product UI, UI motion, visual direction, and durable product design truth.
- `playwright`: browser automation and diagnostic/session recording.
- `youtube-transcript`: transcript/caption extraction from YouTube.
- `source-driven-development`: explicit current-source grounding for renderer APIs.
- `read-github`: read-only upstream repository inspection.

## Renderer policy

1. Explicit user renderer choice wins.
2. Existing renderer/project structure wins unless migration is explicitly requested.
3. Existing Remotion project -> Remotion.
4. Video application/editor/player/batch-video product work -> Remotion.
5. New standalone authored film with no renderer selected -> HyperFrames default.
6. If neither renderer is available, produce a bounded plan/spec and report the missing execution surface rather than pretending a render occurred.

## Product-promo policy

Adopt video-shotcraft concepts selectively:

- inspect the real product before storyboarding;
- use real product captures for faithful product UI shots;
- derive film typography, colour, density, material, and motion language from the product/design contract;
- use one dominant motion idea per shot;
- leave holds/rest after key information lands;
- coordinate sound design and motion;
- beat-sync only when music is actually part of the brief;
- treat shot recipes as reusable vocabulary, not mandatory templates.

## Verification

A modifying video workflow must distinguish:

- source/contract checks;
- representative frame or preview review;
- final render verification when rendering is requested and executable;
- blocked execution when the renderer/toolchain is unavailable.

Do not claim a finished video from source-only inspection.

## Provenance

Primary upstreams reviewed for this phase:

- `heygen-com/hyperframes` - Apache-2.0
- `remotion-dev/remotion` - source-available with entity-size-dependent licensing; do not vendor
- `Vincentwei1021/video-shotcraft` - Apache-2.0
