# Interactive design playground (conditional UI prototype)

Use when the user wants to **tune an existing design direction** in a live control panel, explore a bounded continuous range (spacing, density, type, contrast, geometry), or say "let me adjust it and copy the resulting instructions." This is an **optional shape of the UI branch** of `prototype`; it is not a new top-level skill, new design authority or a general-purpose page builder. Adapted from Anthropic `claude-plugins-official/plugins/playground` (main tree `df9699a55c56707e9948a32951ea356638ea8519`, reviewed 2026-11-19; Apache-2.0 repository). No upstream code was imported.

## Choose the right question

- **Structurally different navigation, hierarchy, screen organization or primary interaction?** Use `UI.md` with distinct switchable directions. Do **not** replace that empirical comparison with sliders that only recolor the same layout.
- **One accepted base design, with reversible style/density choices left open?** Use this playground. If the underlying product intent or palette is still an unapproved decision, demonstrate options without selecting a winner.
- **Need a production-ready implementer specification, not an explorer?** Return to `design-with-ai` `design-spec handoff`. A copied playground prompt is not an implementation or authorization to change locked product behavior.

## Build the smallest useful explorer

1. Resolve the real target and product constraints first. Inspect the existing design tokens, component structure, relevant viewport and approved copy. Use the host project's frontend runtime when an embedded preview is essential; otherwise start with `templates/design-playground.html` as a self-contained, offline HTML document.
2. Name **one decision** and select only **two to five controls** that expose it. Prefer stable, meaningful variables: token-based spacing, density, type scale, border posture or a specifically open color role. Do not add a control merely because a preset template contains one. Keep existing project values as the baseline; if unknown, say **illustrative baseline** and never export fabricated production tokens.
3. Use a neutral, **clearly labeled illustrative** preview only when no authorized rendered product/component is available. If the existing route and realistic content can be used safely, preserve them instead. Never silently make actual app writes, invoke protected APIs, or display private product data in a shareable HTML file.
4. Keep one in-memory state object, one render/update function and an immediate visible preview. Add at most three named presets with distinct tradeoffs. Reset must return to the exact baseline. No localStorage, network dependency, analytics or hidden file writes.
5. Generate a **readable change request** with the exact target and chosen values. Describe only changes from the baseline, plus the preserved intent/locked constraints. Make the copy action work in local/offline context or let the user select and copy the text manually. This output is a proposal until the user accepts it.
6. Support semantic form labels, visible keyboard focus, readable value feedback, keyboard-operable controls, usable narrow viewport and reduced motion. Never disable focus or rely on color alone to show state.

## Evidence and delivery

- The included HTML file is an **editable starter**, not a claim to match the user's screen. Adapt the preview to the selected component before treating a playground comparison as product evidence.
- Manually open the resulting local HTML or the project's throwaway route and verify: changing each control updates the relevant rendered property **and** change request, presets and reset remain coherent, keyboard focus works, and copy/fallback does not assert success on failure. Browser evidence is required before calling an interactive explorer verified, when a browser is available.
- Return the one-command run/open instruction and the exact target. Say which properties were measured and which are illustrative. Keep any accepted choice in the existing project design authority or the user's approved implementation task; discard the prototype file and switchers afterwards.
- A playground does **not** replace the existing DWA rendered implementation Gate or the `prototype/UI.md` structural-variation workflow.

## Starter contract

`templates/design-playground.html` is the maintained single-file reference implementation. Its default sample is deliberately generic and labeled **demo only**. For a task, customize the header, sample content, baseline, controls and natural-language prompt to the real target, without adding packages or external dependencies. The repo's template/browser smoke is a test of that reusable starter, **not** a mandate to add unit tests to every throwaway exploration.
