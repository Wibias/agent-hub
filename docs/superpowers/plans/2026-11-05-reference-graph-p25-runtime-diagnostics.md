# P25 implementation and deployment plan

Date: 2026-11-05
Design: `docs/superpowers/specs/2026-11-05-reference-graph-p25-runtime-diagnostics-design.md`

## Tasks

1. **TDD RED.** Create `tests/reference-graph/p25-runtime-diagnostics.test.mjs` for P10 timeout/ retry event boundaries, observer failure isolation, P11 fallback category, P17 stage timing and P19 secret redaction. Confirm a failure on the unmodified runtime in the Reference Graph CI.
2. **P10/P11 telemetry.** Add optional best-effort diagnostic callbacks; emit only numeric timings and fixed category strings. Preserve P10 hard deadlines, retry count and P11 authoritative output.
3. **P17/P19 wiring.** Carry diagnostic events through the default production probe. Sanitize and cap retained P19 events, do not append unsafe fields, and keep readiness code identical.
4. **TDD process-start delta.** Require a distinct Node process timestamp and relative timing in the executable collector, first RED then GREEN. Keep the test-injectable `runP19ProductionSoakCli` contract backward-compatible by making instrumentation opt-in for library callers.
5. **Governance and review.** Run the complete Reference Graph suite, existing P16-P21 gates and release governance. Inspect the final PR diff. Keep the PR draft and do not merge without a separate release decision.

## Operator follow-up, not part of this PR

- The original Windows collector remains pinned to the P24 SHA `13b906b29c0f1aa2b8f2934982a9177ea1cad795`. P25 cannot retroactively add diagnostics to its historical sample.
- Review and merge only after CI and safety review.
- For any new soak, explicitly disable the task, archive and hash existing failed evidence, use a clean isolated checkout pinned to the approved merge SHA, repoint the config, reset only the active sample path, restart and validate one new healthy sample.
- Keep the computer running through the window and assess P19 using the official evaluator. No repository-default promotion without a fresh explicit authorization.

## Decision record

Ruling: additive telemetry over new privileged tracing or longer timeouts; it preserves the safety boundary and yields diagnostic evidence without modifying the existing P19 gate.
