# Baseline UI

Fast quality floor for the Baseline phase. Apply after Direction is known. This
is not a second router; it is one internal pass in the unified quality stack.

## Stack defaults

- Existing project tokens, components, primitives, and libraries beat generic
  defaults.
- Tailwind defaults are acceptable only when the project has not already defined
  stronger tokens/conventions.
- Prefer one accessible primitive system per interaction surface. Use the
  project's existing Base UI, React Aria, Radix, or equivalent before adding a
  second system.
- Use the project's existing class-merging helper when present rather than
  inventing another utility.
- Icon-only controls need accessible names.
- Do not hand-roll keyboard/focus behaviour when an established accessible
  primitive already owns it.
- Prefer render logic over effects for derived UI state.

## Interaction

- Destructive or irreversible actions require an appropriate confirmation
  pattern such as the project's AlertDialog equivalent.
- Loading uses structural skeletons that match the real layout, not unrelated
  generic bars.
- Errors belong near the action that caused them.
- Never block paste or password-manager completion without a real product/security requirement; authentication should preserve a non-cognitive path where applicable.
- Fixed/mobile chrome respects safe-area insets.
- Prefer dynamic viewport units (`dvh`) over legacy full-screen assumptions where
  mobile browser chrome matters.
- Validate keyboard focus order and visible focus state for touched controls.
- Sticky UI, overlays, banners, and virtual keyboards must not obscure the focused control.
- Author-controlled drag/reorder actions need an equivalent operable path when the same result cannot otherwise be achieved.
- Reuse information already supplied in the same process when safe instead of forcing redundant entry.
- Rapid interaction may cancel visual motion, but semantic state, focus, and content must settle on the newest user intent; correctness cannot depend on animation completion.

## Motion

Do not add decorative motion during ordinary baseline polish. Existing or
explicitly approved motion follows the canonical rules in `quality-stack.md` and
`standards.md`:

- content remains visible by default;
- name transition properties rather than `transition: all`;
- prefer compositor-friendly `transform`/`opacity` for normal visual motion;
- avoid layout-property animation unless the active workflow has a real reason;
- honour reduced motion and pointer capability;
- avoid persistent `will-change` and large animated blur/backdrop-filter areas;
- pause/gate long-running work only when the runtime owner and evidence justify it.

Use a selected motion workflow when motion itself is the task.

## Typography

- Balance display headings where supported and keep body copy readable.
- Use tabular numerals for changing data.
- Truncate or clamp dense UI deliberately, never by accident.
- Decorative tracking needs a brand reason.
- Preserve semantic heading order even when visual sizes differ.
- Let URLs, identifiers, and long user content wrap safely without applying destructive `break-all` behavior to normal prose.
- Chip/tag collections should wrap before essential labels are compressed; a `+n` summary must be an operable disclosure when it hides values.

## Layout, hierarchy, and performance

- Use a deliberate z-index scale; do not solve stacking with arbitrary giant
  values.
- Use square-size primitives such as `size-*` when width and height are meant to
  stay equal and the stack supports them.
- Prefer existing spacing/tokens to local magic values.
- Check responsive transposition rather than merely shrinking desktop geometry.
- Validate clipping/overflow and fixed/sticky elements at representative mobile
  and desktop widths.
- When the defect is grouping, figure/ground, competing accents, or visual weight that disagrees with semantic priority, load `perceptual-hierarchy.md` before adding decoration. Its blur/thumbnail check is an optional rendered diagnostic, not evidence of usability.

## Task-first surface acceptance


Use this review for inspected dashboards, queues, libraries, multi-step setup,
settings, and other operator surfaces. The surface's actual job, not its
category label, decides which checks apply. Run it on a real representative
viewport and state before adding decorative polish:

1. **Task and next action:** Name the user's first-screen decision or action.
   For read-only views, name the question the user must answer. Can they find
   the relevant record, action, and blocker without parsing every panel?
2. **Information priority:** Separate immediate work, next steps, exceptions,
   and reference/configuration data. Compare visual prominence with actual
   consequence. Four equal KPI tiles may be correct for four comparable
   measures, but not when one is operationally urgent and three are background.
3. **Content representation:** Put the product's real subject first: meaningful
   item labels and useful previews/attributes when they exist and help a
   decision. Raw IDs, timestamps, and technical metadata are secondary unless
   they are the actual object of work. Do not fabricate names, media, or metrics.
4. **State and truth:** Trace displayed totals, status labels, readiness,
   permissions, and next-step affordances to available product contracts.
   Distinguish work complete, QA passed, authorized, publishable, and published
   when those are different states. Ambiguous or conflicting truth is a product
   defect, not something colour or badge styling can fix. Mark unverified
   claims as unknown instead of guessing.
5. **Density and legibility:** Inspect at normal browser zoom and realistic
   desktop/mobile viewport sizes. Essential text, actions, and explanatory
   labels must be readable without relying on the screenshot being enlarged.
   Check whether large empty regions coexist with cramped controls or tiny
   labels. Rebalance width, grouping, and text hierarchy when they do.
6. **Containment budget:** Inventory repeated cards, borders, and separators.
   Each must earn its place through comparison, grouping, interaction, or
   scanning. Replace unearned equal-weight boxes with task-appropriate rows,
   sections, tables, or open layout; do not ban cards or force asymmetry.

A failure in task clarity, truth, or legibility must be revised before Craft.
If correcting it changes locked purpose or IA, route through the workflow's
authority/redesign rules rather than silently changing the product model.

## Anti-slop floor

- No default purple/multicolour gradient, glow, or generic card wall unless the
  brief/brand actually demands it.
- One view needs hierarchy, not many competing accents.
- Empty states need one clear next action.
- Existing brand and tokens win over generic taste rules.
- Fix structure before adding decoration when the result looks template-generated.
- Preserve a coherent incumbent icon family; remove redundant decorative icon
  repetition instead of introducing a second family.

## Verification

Before handing off to Craft, check:

- keyboard/focus behaviour, including focused controls near sticky/overlay UI;
- touch targets;
- mobile/desktop layout;
- text overflow/wrapping and compact chip/tag collections;
- loading/error/empty states touched by the change;
- interrupted/repeated interaction settles on the correct semantic state;
- visible hierarchy and primary action, including perceptual grouping when that was an identified defect;
- task-first acceptance for applicable operator surfaces, including status truth, legible information, and justified containment;
- no baseline rule accidentally changed product semantics or routes.

When the target is native/mobile, load `native-mobile.md` for platform-specific units, safe areas, text scaling, gestures, and runtime verification.

Source lineage: ibelick/ui-skills `baseline-ui` (MIT), adapted into the unified
`design-with-ai` quality stack; selected resilient interaction/text rules also
adapted from `nextlevelbuilder/ui-ux-pro-max-skill` (MIT). Perceptual hierarchy
checks are selectively re-expressed from Webdesign Journal practitioner material
reviewed 2026-10-28 and remain diagnostics rather than tested usability evidence.
