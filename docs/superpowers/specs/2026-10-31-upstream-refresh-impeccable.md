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

Each source records a `reviewedCommit`. That checkpoint means the repository delta through that commit was inspected. A separate `decision` records whether the reviewed delta is current, not applicable, isolated in another PR, or still pending local adoption. Vendor sources may also record a `localPin`.

## Adoption decisions

- Addy: reviewed through `eb07f19f52c2669f2364897aaa293e2aaddd7b1c`; `not-applicable`. Do not broaden Agent Hub's explicit-only `code-simplification` route. Other reviewed fixes either target examples/contracts Agent Hub rewrote or are already absent from the local owners.
- Emil: reviewed through `a81dbca07f2217b7103e510c0f13f8d5b017afc9`; `separate-pr`. Its applicable removal-safety delta is isolated in PR #139 and is not duplicated here.
- Matt: reviewed through `a496f5513d4a4cf889bc48e189e579f4b0bdf6aa`; `not-applicable`. The fresh-subagent `implement-spec` changes do not apply to Agent Hub's Superpowers execution ownership.
- pstack: reviewed through repository head `4dd1d05818d19792e7cd6e818f1667f95f7e1dbe`; `current`. No changes under `pstack/` occurred after Agent Hub's current Statechart pin `c742dd61706fbacc1b95f1a20b7b988cf096ce6c`.
- Impeccable: reviewed through `df3a4abe7d0840d5f60324812c432e00b66a4e75`; `update-pending`. Upstream is 4.8.0 / engine 0.1.18 while Agent Hub remains internally consistent on vendor pin `6af45ac9a5eb8792f033d3242f52e99812fd91fa` (4.6.0 / engine 0.1.15). Do not partially bump the vendor. A later full sync must update all shared files together and preserve the local `SKILL.md` overlay.

## Update-check contract

Create one repository-owned source registry and a small checker. The checker compares each public repository HEAD with its reviewed checkpoint and reports:

- `UPDATE` when upstream HEAD moved beyond the reviewed checkpoint;
- `CURRENT` when HEAD is reviewed and no adoption debt remains;
- `PENDING` when the upstream delta was reviewed but local adoption is still outstanding.

`--offline` validates the registry and exposes recorded decisions without network access. CI executes this offline path so registry drift is caught deterministically.

## Impeccable sync boundary

The existing Impeccable vendor contract remains unchanged until a complete sync is possible: shared files under `skills/impeccable/` match upstream pin `6af45ac9a5eb8792f033d3242f52e99812fd91fa`, except the intentional local `SKILL.md` overlay. The audited 4.8.0 delta includes engine/runtime and launcher changes, so a subset update would create a false pin and is prohibited.

## Verification

Use TDD: first require the five-source registry and observe Release Governance fail, then implement the registry/checker and rerun complete governance. The final branch must contain no temporary workflow changes and must leave the existing Impeccable vendor internally consistent. Do not merge automatically.
