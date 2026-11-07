# P26 release-readiness work plan

Date: 2026-11-07  
Design: `reference-graph/P26.md`

## Completed prerequisites

- P25 implementation merged: `8bd9eeec1ab84ca816bb6238702d88ebba9cf0c9`.
- Operator-reported frozen-copy official P19 evaluation: **33/33 healthy**, 31.062327222222223 hours, max gap 60.724833333333336 minutes, exact attestation, `eligible=true`, no blockers.
- P25 diagnostic events present in all **33** samples according to the operator's freeze output.
- Immutable local archive label: `p25-passed-freeze-20261107T052258Z-fa686176`; manifest SHA-256: `dd1dc64f3eb064b9a3bbc9be99a04013a3395887a4fd542f899d5a5f9f37ca3e`. Private file bytes/per-file digests have not been independently inspected here.
- Current main intentionally keeps repository default off.

## This PR

- Document the actual P17/P11/P19 authority and scope boundaries.
- Establish evidence-freeze acceptance requirements and a separate default-promotion governance gate.
- Explicitly classify real-user retrieval-quality and rollback questions as unproven, not as failures masked by P19 success.
- Keep this PR a design/review deliverable. No code that changes production state.

## Next review and implementation tasks

1. **Completed by operator:** snapshot the P25 local evidence with a stable read, exact pinned checkout and unchanged collector.
2. **Completed by operator:** re-run the official P19 evaluator on the frozen copy and record the manifest SHA-256 and aggregate results.
3. **Outstanding:** an authorized reviewer checks the full private manifest and individually hashed evidence files, without copying private samples into GitHub.
4. Prepare a separate **default-off, fail-closed implementation PR** for precisely scoped routing, rollback, and independent post-change receipt; verify with tests before any live activation.
5. Only after an independent review and **separate explicit future authorization**, decide whether to run a staged rollout.

## Invariants

Do not stop/change the existing P25 Windows collector for a read-only archive; do not delete/edit original failed P24 evidence; do not enable repository default or change Standard/Deep routes; no new live grant or elevated runtime credentials.
