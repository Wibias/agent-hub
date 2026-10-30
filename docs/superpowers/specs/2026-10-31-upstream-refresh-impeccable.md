# Upstream refresh with Impeccable design

## Intent

Refresh the canonical Agent Hub upstream audit through 2026-10-31 and add Impeccable as a permanent fifth source in the update check.

## Sources

The update check owns these five repositories:

- Addy: `addyosmani/agent-skills`
- Emil: `emilkowalski/skills`
- Matt: `mattpocock/skills`
- pstack: `cursor/plugins`, scoped to `pstack/`
- Impeccable: `pbakaus/impeccable`, scoped to `.agents/skills/impeccable/`

Each source records a `reviewedCommit`. That checkpoint means the repository delta through that commit was inspected, not that every upstream change was adopted.

## Adoption decisions

- Impeccable: refresh the vendored upstream subtree from `6af45ac9a5eb8792f033d3242f52e99812fd91fa` to `df3a4abe7d0840d5f60324812c432e00b66a4e75`, preserving Agent Hub-only overlays and merging upstream `SKILL.md` semantics into the explicit-only local overlay.
- Addy: advance the audit checkpoint to `eb07f19f52c2669f2364897aaa293e2aaddd7b1c`. Do not broaden Agent Hub's explicit-only `code-simplification` route. Other reviewed fixes either target examples/contracts Agent Hub rewrote or are already absent from the local owners.
- Emil: checkpoint `a81dbca07f2217b7103e510c0f13f8d5b017afc9`; its applicable removal-safety delta is already isolated in PR #139 and is not duplicated here.
- Matt: checkpoint `a496f5513d4a4cf889bc48e189e579f4b0bdf6aa`; the fresh-subagent `implement-spec` changes do not apply to Agent Hub's Superpowers execution ownership.
- pstack: checkpoint repository head `4dd1d05818d19792e7cd6e818f1667f95f7e1dbe`; no changes under `pstack/` occurred after Agent Hub's current Statechart pin.

## Update-check contract

Create one repository-owned source registry and a small checker. The checker compares each public repository HEAD with its reviewed checkpoint and reports `CURRENT` or `UPDATE`; scoped sources tell the reviewer which subtree to inspect. CI tests registry shape and source membership without depending on live network access.

## Impeccable sync contract

For paths shared with upstream, files under `skills/impeccable/` remain byte-identical to upstream `.agents/skills/impeccable/`, except `SKILL.md`. Preserve files that were never part of either the old or new upstream distribution. The local `SKILL.md` keeps explicit-only routing, injection handling, stricter launcher failure evidence, competing-skill classification, and qualification references while adopting upstream 4.8.0 semantics.

## Verification

Use TDD: first require the five-source registry and Impeccable 4.8.0 / engine 0.1.18 contract, observe Release Governance fail, then sync and rerun the complete governance workflow. Do not merge automatically.
