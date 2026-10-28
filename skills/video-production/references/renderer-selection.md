# Renderer Selection

Use this reference for every modifying or render-capable `video-production` request.
The job is to select the renderer with the least unnecessary migration and the
strongest fit to the actual artifact.

## Decision order

Apply these rules in order. Stop at the first rule that resolves ownership.

1. **Explicit choice wins.** If the user explicitly requests HyperFrames or
   Remotion, use that renderer unless execution is impossible or unsafe. Surface
   the blocker rather than silently switching renderers.
2. **Existing project renderer wins.** Detect the actual project before choosing.
   Existing Remotion compositions stay Remotion. Existing HyperFrames
   compositions stay HyperFrames. Do not migrate merely because another backend
   is the Agent Hub default.
3. **Remotion owns video products.** Prefer Remotion when the deliverable is a
   video application/editor/player, a React-native video composition system, or
   batch/server rendering infrastructure where Remotion is already the product
   architecture.
4. **HyperFrames is the default for a new standalone authored film.** Use it for
   a new launch film, promo, explainer, social clip, or similar artifact when no
   renderer or existing video project has already been selected.
5. **No executable renderer means no render claim.** Produce the useful planning
   or implementation specification that is possible, state which execution
   capability is missing, and leave final rendering blocked.

## Detect existing ownership

Inspect only enough project evidence to classify the stack. Useful signals
include dependency manifests, renderer config, composition roots, imports, and
existing render scripts.

Do not classify from filenames or user-facing copy alone. A web product built in
React is not automatically a Remotion video project.

When both renderers genuinely coexist, bind the task to the existing composition
or output path the user named. If the target remains ambiguous, do not migrate or
rewrite both stacks on speculation.

## HyperFrames lane

HyperFrames is a web-native authored-video backend. Current upstream provides an
HTML/CSS/media composition model, seekable deterministic animation, preview and
render tooling, and a component registry. Use current upstream documentation or
source for exact CLI/API behavior when implementing against it.

Agent Hub does not vendor HyperFrames skills or registry content. Renderer facts
that can drift stay upstream.

## Remotion lane

Remotion is the natural lane for an existing Remotion project and for systems
where React compositions, player/editor behavior, batch rendering, or Remotion
application architecture are already material.

Remotion has its own maintained Agent Skills and current documentation. Reuse
those sources when available rather than copying them into Agent Hub.

### Licensing boundary

Remotion uses a special licence whose eligibility can depend on the legal entity
and intended use. Before relying on a free-use assumption for material commercial
execution, check the current official Remotion licence. Do not freeze employee
thresholds, pricing, or other changeable terms into implementation logic.

The licence check is not permission to derail unrelated video planning. It
becomes blocking only when the intended execution actually depends on Remotion
eligibility.

## Migration requests

A renderer migration is a separate migration task, not an incidental production
choice.

When migration is explicit:

- preserve observable video behavior and approved design intent;
- inventory renderer-specific features before promising parity;
- use current upstream migration/source guidance;
- verify representative frames and timing against the source artifact;
- report unsupported or intentionally changed behavior explicitly.

## Current upstream snapshots used for this reference

The provenance file records reviewed snapshots. Those pins establish what was
reviewed, not a permanent claim that latest upstream behavior matches them.
