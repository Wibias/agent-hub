# Reference Graph P22 — Timeout Retry Implementation Plan

1. Add regression tests for timeout recovery, double-timeout failure, and non-timeout no-retry behavior.
2. Refactor the P10 REST read into a single-attempt helper without changing validation, auth, URL, or projection semantics.
3. Retry exactly once only for the exact P10 timeout transport error, using the same per-attempt timeout.
4. Keep total latency telemetry around the complete operation, including a retry.
5. Run the reference-graph test suite and CI/security/governance checks.
6. Merge only after all required checks are green.
7. After merge, perform live read-only regression validation, archive the already-failed P19 soak as historical evidence, and begin a new clean P19 soak. Repository-default promotion remains a separate explicitly authorized step.
