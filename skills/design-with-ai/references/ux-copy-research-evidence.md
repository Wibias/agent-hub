# UI copy and user-research evidence (conditional)

Use only for a **resolved product UI** when one of these signals exists:

- a user-facing label, help text, validation, empty/error/loading/success message, permission explanation, or recovery instruction is confusing or demonstrably inconsistent with the product task;
- actual interview notes, support tickets, surveys, usability sessions or product analytics have been supplied and must inform a specific UI design decision.

This reference specializes existing `design-with-ai` source evidence, UI interaction and critique. It does **not** own generic copywriting or standalone research synthesis. Do not load for visual polish with no copy/feedback problem, copy-only editing unrelated to UI design, or when there is no relevant research. Inspired by the task boundaries in Anthropic `knowledge-work-plugins` design `ux-copy` and `research-synthesis`, selectively re-expressed; no upstream templates or prose imported.

## In-product UX copy review

1. **Locate the actual state and task.** Record the route, component, trigger, user goal, visible original message and surrounding actions. Distinguish `CONFIRMED_VISIBLE` (matching actual render), `SOURCE_ONLY` (not shown in inspected state) and `PROPOSED` wording. A text match in source without visibility is not evidence of a user-facing defect.
2. **Protect product truth.** Preserve names, obligations, permissions, legal/safety terms, data, authorization, navigation and error meaning. A polished message cannot claim success before it occurs, imply a permission the user lacks, conceal an irreversible action or invent recovery.
3. **Review content by role.** Buttons name the observable action; labels remain stable and unambiguous; validation explains what failed and how to correct it; loading identifies in-progress work without false completion; empty states explain the current situation and an eligible next action; success confirms only a verified result; destructive actions communicate their effect. Keep wording short but not at the expense of necessary detail.
4. **Test real content pressure.** Long names, localization, pluralization, unknown values, truncated content, constrained widths, screen-reader announcements and keyboard flow affect whether a sentence works. Respect established content style, translation keys, domain terminology and accessible-name relationships. Do not rewrite system-generated or approved copy without authority.
5. **Emit a minimal before/after decision.** Pair each observed issue with its original text/state, proposed wording, rationale and required rendered/state verification. If a legal, policy or product-owner answer is needed, mark it `BLOCKED`; do not write an invented replacement.

## Research-to-design synthesis when evidence exists

1. **Define the decision and input scope.** State the user task, target interface, research question, source IDs, dates, participant/session counts where known, sampling and privacy/access restrictions. Redact personal/sensitive data from durable reports; never silently publish raw transcripts.
2. **Separate types.** A user quote is `REPORTED`, a witnessed action `OBSERVED`, measured analytics `MEASURED`, a thematic grouping `INTERPRETED`, and a design idea `HYPOTHESIS`. A hypothesis is **not** a tested result. Apply the source quality and relevance criteria in `source-evidence.md`; a support ticket is not automatically a representative sample.
3. **Group without inflating counts.** One participant mentioning the same problem five times is one participant, not five independent users. De-duplicate identical reports and cross-posts before estimating prevalence. Show **denominators** and missing coverage; distinguish number of sources from number of participants and number of events. Do not turn selected anecdotes into global percentages or invented personas.
4. **Preserve contradiction and negative evidence.** Record competing experiences, segment/context differences, survey nonresponse, survivorship and selection bias, and cases where a suspected friction was **not** observed. Prefer `UNKNOWN` rather than treating absent evidence as evidence of absence.
5. **Link each finding to a design choice.** For each: exact source ID and excerpt/observation, number of independently affected participants or events (or `UNKNOWN`), severity/impact basis, confidence limits, affected UI state, proposed smallest change and a way to evaluate it on the actual product. State whether a result is only suggestive or has a context-matched tested outcome.
6. **Do not auto-implement a product decision.** User research can motivate prioritization or a bounded experiment but cannot silently override locked product rules, user-approved art direction or platform obligations. Feed real findings into the existing DWA finding-to-outcome ledger and verification contract. Do not create a separate feedback database.

Compact evidence table for the relevant cases:

| Finding + affected state | Source IDs / evidence class | Independent count + denominator | Alternative / limitation | Proposed UI change + validation |
| --- | --- | --- | --- | --- |
| Explanation unclear in permission error | interview-04, REPORTED; session-07, OBSERVED | 2 independently observed sources / sample size UNKNOWN | different permission tiers not tested | propose shorter cause + eligible recovery; inspect permission-denied state |

## Stop and report honestly

No supplied user feedback means no research-derived claim. No reachable UI state means no claim that text was visible or that copy improved user behavior. If product authority, data access, or consent is missing, report the boundary. A change is complete only after the actual modified UI receives the normal `verification-contract.md` checks; a read-only synthesis is a decision input, not an implemented improvement.
