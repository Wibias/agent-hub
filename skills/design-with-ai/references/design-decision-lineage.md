# Design decision lineage (conditional, deep UI decisions)

Use this reference only when a concrete design decision must survive a review, session, agent, or implementation handoff. This extends DWA's existing workflow, findings ledger, and design authority; it is **not** another skill, event store, approval system, or substitute for rendered evaluation.

## Activation and authority

Load after `references/core-design-workflow.md` for:
- `redesign-existing deep` with an unresolved structural direction (its existing human-approval implementation lock remains mandatory);
- `build-product-surface deep` when a new structural direction is selected before implementation;
- an explicit selection among proposed structural directions;
- a representative design slice passed across an agent/session boundary; or
- `design-spec handoff` based on an approved deep design.

Do **not** load for `audit-surface`, ordinary `improve-existing`, quick polish, a fixed-direction restyle, or a bounded spec that already has adequate accepted source identity. A handoff does not reopen the design process. The target project's existing design authority and locked contracts always win.

A user's authorization to do design work does not by itself approve a particular direction. In workflows with a mandatory human lock (notably `redesign-existing deep`), proceed to implementation only after an explicit human selection of the displayed direction. Elsewhere, explicit design-decision delegation may be recorded as `AGENT_SELECTED_UNDER_DELEGATION`, with the delegation source and scope; **never** call it `HUMAN_SELECTED` or `HUMAN_APPROVED`. Delegation does not bypass a route's mandatory human-approval gate.

## Thin lifecycle, not a runtime state machine

`BRIEF_READY -> DIRECTIONS_READY -> HUMAN_SELECTED -> REPRESENTATIVE_SLICE_READY -> ACCEPTED_FOR_HANDOFF`

This is a conceptual ordering for a human-approved flow, not a requirement to generate five files or a universal command sequence. Authorized delegated flows label the selection `AGENT_SELECTED_UNDER_DELEGATION` rather than `HUMAN_SELECTED`. Critique and refinement can occur after the representative slice and before handoff. A missing required decision is a **hold**, not an implicit approval.

## Versioned decision packet

Keep a compact, non-sensitive decision packet in the authorized task/PR record or existing handoff. Use an existing project-owned artifact location if one is established; do not introduce a second project rulebook, findings ledger, or `.taste-compiler` folder. Treat unpersisted conversation context as an honest continuity limitation.

Required for a checkpoint-dependent decision:
- `checkpointRef`: stable identity of the exact presentation, not an interchangeable title or `latest`;
- `briefRef`: the frozen purpose, constraints, content/data model, users, and success criteria;
- `directionSetRef`: exact, versioned set shown to the owner, with **2-3** genuinely different directions when the deep route requires alternatives;
- `directions[]`: stable candidate IDs, each tied to the same brief and content problem;
- `recommendation`: agent advice only, never owner input;
- `selection`: absent until an actual owner decision or a separately recorded permitted delegation.

Present the full candidate meaning and distinguishing tradeoffs, not just names. The reviewer must be able to identify the actual direction that would be implemented. Version identity can initially be an immutable, source-backed reference in the task record; canonical JSON/hash validation is introduced separately. Do **not** claim cryptographic integrity before it is measured.

A human decision records `checkpointRef`, `selectedDirectionId` (or explicit `REJECT_BOTH` / rework), `actorKind: HUMAN_OWNER`, an attributable owner response, and rationale where available. Do not fabricate a rationale, actor identity, approval, or channel. Ambiguous input requires clarification. If the owner rejects the proposed set, establish new directions and a new checkpoint instead of silently reusing the old identity.

## Immutable presentation, explicit response, safe resume

- An agent's recommendation, default order, silence, "continue", a resumed chat, or a display-only reaction cannot approve a direction.
- The selected ID must exist **exactly once** in the displayed set. Candidate titles are descriptive, not stable identifiers.
- A new brief version or modified candidate payload invalidates dependent direction approval. An old response must never be applied to a newly generated alternative.
- While awaiting a choice, do not rewrite or regenerate the displayed packet. Create a new checkpoint and ask again if the proposal changes.
- Resume by presenting the **same** pending checkpoint and candidates. Do not substitute semantically similar newly generated content under the old ID.
- If the original displayed packet or the correlation between presentation and reply is lost, mark approval **UNVERIFIED**, stop any human-locked implementation, and re-present an identifiable checkpoint.
- Source references identify specific versions; `latest`, unversioned names, or content inferred from memory are not sufficient.
- Handoff and post-hoc agent claims cannot mint or upgrade a human approval.

## Representative slice contract

Bind the slice to the selected `sourceDirectionRef` and identify the actual representative artifact. A deep representative slice records, at the level applicable to the flow:
- named high-consequence `flow` and `representativenessRationale`;
- `coveredContent` and explicitly `omittedContent`;
- 1-3 connected `views` / meaningful states, with hierarchy and `contentPlacements`;
- `interactions`, `criticalStates`, `transitions` and reachability, including error and permission boundaries where applicable;
- `responsiveBehavior`, `visualDecisions`, and honest `tradeoffs`.

Keep omission explicit; a slice is not full-product coverage. For linked views, explain each reachable transition and the state it depends on. Do not invent backend states or claim a visual concept is implemented. Continue DWA's real rendered review, responsive and accessibility verification, existing pre-code/kill gates, and actual product-quality judgment.

## Critique, refinement, and handoff

Where a versioned slice is used, critique must identify `sourceArtifactRef`, each relevant finding ID, and the specific observed problem. A refinement references its source and result versions and `causedByFindingIds`; preserved or unresolved findings remain visible. Structural change is not automatically improvement; use actual paired rendered evidence before `RESOLVED` claims.

A developer handoff may carry `briefRef`, `directionSetRef`, `ownerDecisionRef`, `representativeSliceRef`, `critiqueRef`, `refinementRef`, and `approvedDesignContractRef` when present. Omissions are explicit, not filled with imagined artifacts. The handoff **cannot** itself approve anything. If implementation modifies the approved design, report the divergence and re-establish the appropriate approval or verification before claiming conformance.

## Mechanical vs product proof

Identity, candidate membership, source chains, and stale references can be validated mechanically. Structural distinctness, representativeness, design quality, accessibility, and task success still require human/product judgment and DWA's existing real-render/runtime proof. Never report a structural pass as a visual acceptance.
