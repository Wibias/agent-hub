# New important product surface

## Command contract: `build-product-surface`

**Inputs**
- Quality profile: `standard | deep` (default `deep`).
- Surface name and product context.
- Locked product, brand, a11y, i18n, and technical constraints (must be inventoried before step 1).

**Output contract**
- `core-design-workflow.md` loaded immediately after this workflow reference.
- Surface classification, contract ledger, purpose brief, content model, route
  and task model answered before any pixels or code.
- Complete state surface map (entry, loading, empty, success, error, disabled, partial, overflow, narrow, recovery).
- Anti-slop inventory recorded before implementation: one intended dominant
  title/focal, semantic heading order, declared palette roles, and an intentional
  icon-family/utility decision.
- Structural approach documented; for `deep`, 2–3 approaches compared and one chosen with evidence.
- Visual-world specificity verdict recorded; deep compares at least two
  distinct visual worlds separately from structural approaches.
- Changed files listed in dependency order; polish chain and critique/revision passes evidenced.
- Internal taste guidance and `verification-contract.md` loaded; motion candidates handed to `motion-opportunities`.
- Conditional data-viz/native/durable-contract references loaded only when the concrete surface requires them.
- Screenshot or live-route evidence per affected viewport and meaningful state; labeled "not verified" if unavailable.

**Failure / stop handling**
- Target surface cannot be scoped from the request → stop; ask for audience, job, and product constraints.
- Browser or visual verification unavailable → label all visual claims "not verified"; do not mark done.
- Required script or gate missing or failing → report exact error and stop.
- Project rule or security boundary conflict → project rule wins; state the conflict and stop if user authority is needed.
- Missing required reference → stop and report.
- User authority required (new token system, destructive choice, locked constraint change) → stop and ask.
- Three materially different attempts fail the same gate → report the failing layer and all three attempts; stop.

Route `build-product-surface` here. Default to the deep profile for a
ship-critical surface.

After this file, load `core-design-workflow.md`, then `source-evidence.md`,
before conditional intelligence, taste, or external reference work.

1. Load `core-design-workflow.md`, classify the surface, and establish meaning
   before pixels:
   - Who uses it, in what context?
   - What job must become easier or clearer, and why does this surface own it?
   - What should it feel like?
   - Which product, brand, accessibility, i18n, and technical constraints are
     already locked?
2. Build the contract ledger and map content disposition, route/entry points,
   primary task, secondary surfaces, and return paths. Do not default to a
   dashboard, sidebar, hero, or card grid without product evidence.
3. Map the complete state surface: entry, loading, empty, success, error,
   disabled, partial data, overflow, narrow viewport, and recovery.
4. Inspect existing tokens and primitives. Reuse the system where it works;
   introduce a new primitive only when the product need is genuinely new.
5. Load conditional intelligence from concrete target evidence:
   - charts/analytical encodings -> `data-visualization.md`; query `design-guidance.md` only for unresolved chart/interaction choices;
   - native/mobile platform behavior -> `native-mobile.md`; use the guidance catalog only for one specific unresolved outcome;
   - explicit reusable multi-surface design truth -> `durable-design-contract.md`.
6. Load `taste-workflow.md`; choose genre, density, palette logic, typography,
   materiality, icon language, one signature move, and explicit anti-slop
   refusals. Use `dials.md` and `color-strategy.md` only when those dimensions
   are open.
7. Before implementation, record the anti-slop inventory:
   - one intended dominant page title or focal in the initial viewport;
   - heading levels from the document outline with descending visual emphasis;
   - colors mapped to surface, text, border, accent, status, or data-viz roles,
     with no arbitrary color-count cap;
   - one icon family and a functional job for every repeated icon pattern.
8. Define IA and structure before implementation. For deep work, compare 2–3
   orthogonal interaction/IA approaches and at least two distinct visual worlds.
   Annotate usability evidence, domain references, and outside-domain visual
   references separately.
9. Apply the competitor-reuse test: "A competitor in this category could / could
   not reuse this visual world unchanged." If `could`, revise the semiotics,
   type voice, palette logic, materiality, or signature before implementation.
10. For deep work, render a representative high-consequence slice and narrow
   state. Reject generic or purpose-ambiguous work before building the whole.
11. Build component by component in dependency order. Never request or emit a
   one-shot full product surface.
12. Keep content and controls visible by default. Add motion only after static
   hierarchy and interaction are correct; route candidates through
   `motion-opportunities`.
13. Run the mandatory polish chain on the integrated surface, then any explicitly
   selected bounded specialist critique, revision, and applicable audit.
14. Apply `references/verification-contract.md` to every affected route and
   meaningful state.

The standard profile may choose one structure and visual world after a brief
comparison. The deep profile includes explicit purpose/IA selection, visual
world selection, representative-slice rejection, edge-state coverage, and
multiple rendered critique/revision passes.
