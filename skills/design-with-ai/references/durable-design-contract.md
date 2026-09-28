# Durable project and surface design contract

Load only when the user explicitly wants a reusable multi-surface design system/contract, or when the approved work must persist shared design truth across multiple product surfaces. Ordinary one-route polish does not create a new design documentation hierarchy.

## One source of design truth

Before writing anything, discover the project's existing design authority: `DESIGN.md`, product/design docs, tokens, component documentation, theme files, brand guidance, or another declared source of truth.

- if an accepted convention already exists, extend it;
- do not create a parallel `MASTER.md`, duplicate token ledger, or second rulebook because a generic template suggests one;
- source code and shipped tokens remain implementation truth; durable docs record accepted design intent, relationships, and rationale that code alone does not make obvious.

## Global plus surface-specific deltas

When the project has no better convention and the user wants persistent multi-surface guidance, use a master-plus-overrides model conceptually:

- **global/master contract**: typography roles, palette semantics, materiality, density logic, spacing/tokens, icon language, motion grammar, accessibility principles, responsive strategy, and shared component rules;
- **surface override**: only the named differences needed by one route/surface, plus the reason and scope;
- unspecified dimensions inherit from the global contract.

The project chooses filenames and location. Do not impose `design-system/<slug>/MASTER.md` when an existing repository convention says otherwise.

## Persistence rules

- persist only an approved/accepted direction, never brainstorm alternatives as if they were final rules;
- read the current design authority before updating it;
- never overwrite or regenerate an existing project design contract with a generic template without explicit user authority;
- preserve product truth, factual content, accessibility/security constraints, and existing approved exceptions;
- keep page/surface overrides small: if most surfaces require the same override, it belongs in the global contract;
- record superseded decisions rather than silently leaving contradictory rules active.

## Verification

Before claiming the durable contract is current:

- every documented token/system claim maps to shipped or explicitly approved implementation;
- surface overrides name their parent/global contract and scope;
- no parallel design truth was created accidentally;
- representative surfaces conform, or intentional divergences are documented;
- implementation changes that followed the contract received the normal rendered verification.

The persistence pattern is adapted from the useful master/page-override concept in `nextlevelbuilder/ui-ux-pro-max-skill` (MIT), but project-native design authority always wins over that file layout.
