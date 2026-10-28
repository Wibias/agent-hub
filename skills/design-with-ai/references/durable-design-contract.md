# Durable project and surface design contract

Load only when the user explicitly wants a reusable multi-surface design system/contract, or when the approved work must persist shared design truth across multiple product surfaces. Ordinary one-route polish does not create a new design documentation hierarchy.

## One source of design truth

Before writing anything, discover the project's existing design authority: `DESIGN.md`, product/design docs, tokens, component documentation, theme files, brand guidance, or another declared source of truth.

- if an accepted convention already exists, extend it;
- do not create a parallel `MASTER.md`, duplicate token ledger, or second rulebook because a generic template suggests one;
- source code and shipped tokens remain implementation truth; durable docs record accepted design intent, relationships, and rationale that code alone does not make obvious.

## Global plus surface-specific deltas

When the project has no better convention and the user wants persistent multi-surface guidance, use a master-plus-overrides model conceptually:

- **global/master contract**: typography roles, palette semantics, materiality, density logic, spacing/tokens, icon language, imagery grammar when imagery is in scope, motion grammar, accessibility principles, responsive strategy, shared component rules, and relevant brand/asset constraints;
- **surface override**: only the named differences needed by one route/surface, plus the reason and scope;
- unspecified dimensions inherit from the global contract.

The project chooses filenames and location. Do not impose `design-system/<slug>/MASTER.md` when an existing repository convention says otherwise.

## Imagery and asset grammar

Add this section only when imagery, illustration, icons, logos, or generated visual assets are materially part of the product/design system. Reuse an existing brand or asset authority rather than creating a parallel rulebook.

Record only the dimensions that matter:

- subject and motif language: what belongs in the visual world and what does not;
- crop, composition, camera/perspective, scale, lighting, colour treatment, texture, and background behavior;
- photography, illustration, icon, and decorative-asset grammar, including how those families relate to product UI;
- logo and brand-asset placement, clear-space, modification, contrast, and approved variant constraints when the project already defines them;
- **prohibited motifs, subjects, or treatments** when they would misrepresent the product, conflict with the accepted visual world, or create legal/brand/accessibility risk;
- a small set of **positive and negative examples**, each with the rule it demonstrates, rather than an unlabelled moodboard.

For **AI-generated imagery**, state whether generation is allowed and the constraints that matter for this project. Generated imagery must not invent product facts, UI states, logos, endorsements, people/identities, or claims. Record relevant provenance/licensing requirements, consistency rules across an asset family, unacceptable artifact patterns, and any mandatory human review. A generic generation prompt is not durable design truth.

## Persistence rules

- persist only an approved/accepted direction, never brainstorm alternatives as if they were final rules;
- read the current design authority before updating it;
- never overwrite or regenerate an existing project design contract with a generic template without explicit user authority;
- preserve product truth, factual content, accessibility/security constraints, and existing approved exceptions;
- keep page/surface overrides small: if most surfaces require the same override, it belongs in the global contract;
- record superseded decisions rather than silently leaving contradictory rules active.

When a project has no established token architecture and a shared token system is genuinely required, primitive -> semantic -> component is a useful starting model, not a migration mandate. Do not rename or restructure a working token system solely to match that taxonomy.

## Verification

Before claiming the durable contract is current:

- every documented token/system claim maps to shipped or explicitly approved implementation;
- documented imagery/asset claims map to approved assets, examples, or explicit direction rather than invented house style;
- surface overrides name their parent/global contract and scope;
- no parallel design truth was created accidentally;
- representative surfaces conform, or intentional divergences are documented;
- implementation changes that followed the contract received the normal rendered verification.

The persistence pattern and optional three-layer token fallback are selectively adapted from `nextlevelbuilder/ui-ux-pro-max-skill` (MIT). The imagery/styleguide extension is selectively informed by Webdesign Journal practitioner guidance reviewed 2026-10-28. Project-native design authority always wins over either source's generic structure.
