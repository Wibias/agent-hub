# Statechart Formal Verification Design

## Intent

Add pstack's statechart capability to Agent Hub without creating a competing top-level routing owner. `formal-verification` remains responsible for property selection, code binding, proof claims, failure sensitivity, and verdicts. Statechart becomes a vendored modeling and visualization toolchain inside that skill.

## Goals

- Support `from-spec`, `from-chart`, and `render` workflows for TLA+/TLC-backed statecharts.
- Visualize TLC counterexamples as readable paths through observable states.
- Convert an agreed Mermaid statechart into a TLA+ skeleton for formal verification work.
- Keep the vendored runtime updateable against a pinned upstream revision.
- Preserve the existing boundary between formal verification and runtime verification.

## Non-goals

- Do not add a second top-level `statechart` skill or routing owner.
- Do not make a rendered chart itself count as proof.
- Do not vendor pstack's large upstream test corpus.
- Do not auto-edit product code when a counterexample exposes a bug.
- Do not require PNG rendering when Mermaid/TLA+ text is sufficient.

## Architecture

`skills/formal-verification/statechart/` contains the MIT-licensed pstack runtime pinned to `cursor/plugins` commit `076f4b2f57844ff9eb4ada914d4763884d40146e`. Runtime scripts are copied byte-for-byte from `pstack/skills/statechart/scripts/`. A local `UPSTREAM.md` records the pin, license, sync boundary, and refresh procedure.

`skills/formal-verification/references/statechart.md` is the Agent Hub integration contract. It keeps the useful pstack workflow semantics but states that formal-verification owns the proof claim. `SKILL.md` routes statechart-shaped work through that reference and requires code-bound replay for implementation findings.

Agent Hub tests cover the integration boundary, the vendored CLI's local help path, relative-import closure, and the upstream pin. Network/toolchain-dependent TLC and PNG rendering are runtime capabilities, not CI prerequisites.

## Approaches considered

1. **Embed the entire statechart workflow directly in `formal-verification/SKILL.md`.** Rejected because the large tool-specific procedure would bloat the general verification owner and make upstream refreshes hard to audit.
2. **Add a new top-level `statechart` skill.** Rejected because it would overlap routing with `formal-verification`, require a second catalog owner, and let chart rendering drift into proof claims.
3. **Vendored nested toolchain with a formal-verification reference.** Chosen. It preserves one owner while keeping the upstream runtime isolated and refreshable.

## Constraints

- Upstream pstack statechart is MIT licensed; preserve its copyright/license text.
- Pin the runtime to upstream commit `076f4b2f57844ff9eb4ada914d4763884d40146e`.
- Do not modify vendored runtime files unless the divergence is recorded explicitly in `UPSTREAM.md`.
- TLC/Java discovery and Pele/resvg rendering retain upstream behavior.
- A statechart/TLC finding becomes a product bug only after the model is tied to current code and the counterexample is feasible against that code.
- Generated artifacts should live in scratch/project-owned output locations, never hidden conversation state.
