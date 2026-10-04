# Emil Skill Adoptions Design

## Goal

Adopt the durable, non-duplicative improvements from `emilkowalski/skills` into Agent Hub while preserving one canonical owner per domain and current-source discipline for fast-moving toolchains.

## Ownership decisions

1. `fortify` remains the sole owner for visible-UI resilience and gains an executable worst-case-data mode inspired by `break-ui`.
2. `design-with-ai` remains the sole visible-UI/motion owner. It gains mobile-web platform guidance, a `motion-build` route, conditional React Native/Expo motion guidance, and direct-manipulation mechanics. No new `animate`, `animate-expo`, or `apple-design` sibling skills are created.
3. `prototype` keeps its existing empirical/visual exploration ownership and tightens UI divergence: every variant has a named axis, realistic working content, and explicit win/cost tradeoffs.
4. `write-swift` is created as the one Swift engineering owner. Durable language principles live locally; version-sensitive compiler/toolchain/API claims must be verified from current official Swift sources through `source-driven-development` rather than frozen as evergreen truth.
5. Sonner/library-selection and the existing Emil motion review/audit/opportunity/vocabulary skills are not duplicated because current owners already cover them.

## Fortify worst-case mode

Add an explicit `worst-case <surface>` mode. It must:

- map every rendered field to source/type/limit/optionality;
- prefer schema-backed or plausible real-world extremes, never nonsense filler;
- inject stress data through the same fixture/props/API boundary as normal data;
- support dev-only comparison states such as Demo, Worst case, Empty, One, and large-list pressure when applicable;
- test realistic widths plus 320px, large zoom/text, RTL, dark mode, touch, and supported states when tooling permits;
- report breaks before fixing, with Broken/Ugly/Fragile severity and concrete causes/fixes;
- keep reusable worst-case fixtures as regression assets when appropriate, while never shipping the toggle to production.

## Design-with-AI additions

### Mobile web

Add `references/mobile-web.md` for browser/PWA-on-phone behavior: capability-gated hover, tap highlight, `dvh`/`svh`, iOS input zoom, `touch-action`, overscroll, safe areas, selection/callout behavior, carousel gesture axes, theme color, and real-device verification. It must distinguish mobile web from native/mobile guidance and avoid user-agent sniffing or disabling zoom.

### Motion build

Add `motion-build <target-or-description>` as the implementation owner for intentional motion. The route runs the decision sequence: justify motion by purpose/frequency, choose the cheapest appropriate mechanism, choose properties, timing/easing/spring, interruption/exit behavior, accessibility/input capability, then verify. Existing project tokens and `standards.md` remain authoritative over imported fixed values.

### React Native / Expo

Add a conditional `references/react-native-motion.md` loaded only for resolved React Native/Expo targets. Durable principles include keeping per-frame work off React renders, direct gesture continuity, velocity handoff, platform-native navigation/sheets where appropriate, haptics as supporting feedback, reduced motion, and real-device/release-build verification. Exact APIs/package versions must be verified against current official docs when material.

### Direct manipulation

Add `references/direct-manipulation.md` for gesture mechanics: 1:1 tracking, grab offset, pointer capture, interruption from presentation state, velocity handoff, projected endpoints, rubber-banding, hysteresis, and never locking input while motion finishes. These are interaction mechanics, not an Apple visual style.

## Prototype refinement

UI prototypes keep the current host-page-first approach. Before implementation each variant must name its divergence axis. Each variant must contain realistic content and working interactions sufficient to judge the direction. Handoff must state both when each direction wins and its cost/tradeoff; no preselected favorite unless the user asks.

## Write Swift

Create a compact Swift skill organized around stable defaults:

- value types and narrow mutability first;
- explicit errors and invariants;
- structured concurrency before detached/unstructured work;
- concurrency only when latency or measured CPU work requires it;
- actor/isolation and Sendable choices based on ownership boundaries;
- `some` before `any` when heterogeneity is not required;
- profile before unsafe/performance-specialized constructs;
- modern Swift Testing and toolchain-aware verification.

The skill must detect the project's Swift language/toolchain context before version-sensitive advice. When a recommendation depends on current compiler behavior, SwiftPM, Xcode, framework APIs, or release-specific features, compose with `source-driven-development` and current official Swift documentation. As of this design, Swift 6.4 is the current released language, but the skill must not encode that as a timeless baseline.

## Verification

Every changed/new skill must have canonical Skill Ratchet evals. A deterministic catalog test validates the adoption contract and structural validity for `fortify`, `design-with-ai`, `prototype`, and `write-swift`. The generated knowledge index must be refreshed. Non-trivial changed skills require Strong + distinct Weaker qualification against their own final content digests before merge.