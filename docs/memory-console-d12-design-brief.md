# D12 Memory Console: design-with-ai improvement brief

**Workflow:** `improve-existing standard` targeting the Memory Console Graph tab and adjacent Inspector on the existing `/` UI. **First-screen task:** decide which memories are connected, what authority each has, and whether repository-backed claims can currently be verified.

## Locked contracts

- Existing MemoryEngine canonical schema, D4-D11 trust/freshness semantics, APIs, project/branch scope, lifecycle actions, no implicit database write, no inferred trust upgrade.
- Existing dark restrained interface, non-generic operator workspace, neutral surfaces with restrained cyan accent; no gradients/glow/mascot/new UI framework.
- Seven tabs and existing navigation/actions remain available; Graph remains read-only.

## Design direction

**Precision without instrumentation noise.** Graph canvas is the primary work area; an honest verification ribbon guides inspection, while the inspector is a quieter explanation surface. Promote the current state and the selected node's meaning; demote raw class names, revision hashes and counters. No new animation. Use the incumbent tokens rather than a new visual system.

**Disposition:** Promote scope verification and active node content. Keep graph and inspector topology, search/filter functions and provenance. Demote raw technical labels to supporting details. No invented claims, sensors or live dashboard. Transpose layout to one column on smaller screens.

## Prior findings, frozen before UI modification

- **D12-UX-01 HIGH WORKFLOW:** Graph search reconstructs innerHTML on every input event, discarding keyboard focus and cursor continuity.\n  - Acceptance: Typing successive characters keeps the search field focused, preserves selection and filters matching nodes.\n  - Evidence: memory-ui/app.js:1189-1192 (main 466ec57)
- **D12-UX-02 HIGH WORKFLOW:** Click or Enter on a graph node replaces its DOM without restoring focus, interrupting keyboard exploration.\n  - Acceptance: Selecting a node by keyboard retains visible focus on the selected node after graph rerender.\n  - Evidence: memory-ui/app.js:1206-1218 (main 466ec57)
- **D12-UX-03 HIGH DETAIL:** Git status and repository evidence availability are shown as technical fragments, while node freshness and authority are not clearly distinguished in the graph hierarchy.\n  - Acceptance: A prominent graph scope summary accurately differentiates unverified Git, no repository claims, fresh, stale and unchecked states; inspector separates evidence authority from Git verification.\n  - Evidence: memory-ui/app.js:978-1128 (main 466ec57)
- **D12-UX-04 MEDIUM VISUAL:** Graph meta text is 9.5px, origin labels 8px, and graph relationship metadata 9px, creating difficult reading at normal zoom.\n  - Acceptance: Graph context, node relationship labels and essential metadata use a readable type scale without obscuring the primary graph.\n  - Evidence: memory-ui/styles.css:924-1100 (main 466ec57)
- **D12-UX-05 MEDIUM VISUAL:** Body min-width 860px and graph min-width 560px plus inspector min-width 300px force narrow-window clipping rather than responsive transposition.\n  - Acceptance: At 760px and 390px viewport widths all primary graph controls, graph canvas and inspector remain accessible without horizontal viewport scrolling.\n  - Evidence: memory-ui/styles.css:32-39,901-906,1157-1194 (main 466ec57)
- **D12-UX-06 MEDIUM DETAIL:** Raw authority classes and inferred/typed relation origins need domain-accurate explanatory labels and separation from proof claims.\n  - Acceptance: The graph clearly describes how canonical, advisory typed and optional similarity edges differ, and never equates agent-derived inference with verified Git provenance.\n  - Evidence: memory-ui/app.js:930-959,978-1127 (main 466ec57)

## Verification boundaries

Source inspection is the pre-edit baseline; no representative before screenshot or live browser session was available at baseline. Comparisons of visible quality therefore require independent rendered evidence before they can be called complete. Regression tests validate interaction and truthful labels independently of design taste. Do not weaken D1-D11 gate conditions.
