# P26 release-readiness work plan

Date: 2026-11-07  
Design: `reference-graph/P26.md`

## Completed prerequisites

- P25 implementation merged: `8bd9eeec1ab84ca816bb6238702d88ebba9cf0c9`.
- Operator-reported official P19 evaluation: 32/32 healthy, 30.063 hours, max gap 60.725 minutes, exact attestation, `eligible=true`, no blockers.
- P25 diagnostic events present in all samples according to operator output.
- Current main intentionally keeps repository default off.

## This PR

- Document the actual P17/P11/P19 authority and scope boundaries.
- Establish evidence-freeze acceptance requirements and a separate default-promotion governance gate.
- Explicitly classify real-user retrieval-quality and rollback questions as unproven, not as failures masked by P19 success.
- Keep this PR a design/review deliverable. No code that changes production state.

## Next operator tasks

1. Snapshot the P25 local evidence with a stable read and exact hash verification.
2. Re-run the official P19 evaluator on the frozen copy.
3. Record manifest and aggregate fields. Do not commit private evidence.
4. Commission a separate implementation PR for scoped default-off routing plus independent post-change receipt; test before considering live activation.
5. Only after independent review and **explicit future authorization**, decide whether to run a staged rollout.

## Invariants

Do not stop/change the existing P25 Windows collector for a read-only archive; do not delete/edit original failed P24 evidence; do not enable repository default or change Standard/Deep routes; no new live grant or elevated runtime credentials.
