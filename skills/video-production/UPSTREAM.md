# video-production upstreams

`video-production` is an Agent Hub orchestration layer. It owns discovery,
renderer selection, cross-renderer production boundaries, progressive loading,
and completion policy. Upstream projects provide renderer contracts and production
craft guidance.

| Source | Reviewed snapshot | Local role | Licence / provenance |
|---|---|---|---|
| `heygen-com/hyperframes` | `3ca1005a81e76565a69d5874371c857321b66d59` reviewed 2026-10-28 | Default backend model for new standalone authored films when no renderer is selected; deterministic HTML/media/timeline rendering concepts | Apache-2.0 |
| `remotion-dev/remotion` | `4725fadc9d4bab2779af5846554b18adff1613c6` reviewed 2026-10-28 | Existing Remotion projects; React/video application, editor/player, and batch-render architecture; maintained upstream Agent Skills | special Remotion licence; do not vendor; verify current official terms when material |
| `Vincentwei1021/video-shotcraft` | `5a2e98daade313c4f376120f38427eb19a108e8c` reviewed 2026-10-28 | Product inspection, real-screen capture discipline, product-derived art direction, shot vocabulary, holds/rest, sound and conditional beat-sync methodology | Apache-2.0 |

## Deliberate non-adoptions

- No renderer source tree or upstream Agent Skill catalog is copied into Agent Hub.
- HyperFrames' renderer-specific design files do not become a second Agent Hub
  design source of truth. Project-native design authority and
  `design-with-ai`'s durable design contract remain authoritative.
- Remotion package APIs, licence thresholds, pricing, cloud limits, and other
  drift-prone facts are not frozen into this skill.
- video-shotcraft's large demo, media, and shot-asset corpus is not vendored.
  Named shot implementation details are read from current upstream when needed.
- UI/component motion remains under `design-with-ai/motion-build`.

## Refresh policy

An upstream refresh is normally `EXTEND`, not a reason to create new top-level
HyperFrames, Remotion, or shotcraft discovery owners. Promote a new discovery
surface only when it owns a genuinely different user problem rather than a new
renderer command or upstream sub-skill.

When refreshing:

1. compare the current upstream contract against the reviewed pin;
2. classify the delta against existing `video-production` ownership;
3. preserve explicit renderer choice, existing-stack authority, design-contract
   authority, privacy rules, and verification semantics;
4. update this provenance file with the newly reviewed immutable commit.
