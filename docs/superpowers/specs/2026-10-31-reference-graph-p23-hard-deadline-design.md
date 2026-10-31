# Reference Graph P23 Hard Deadline Design

## Intent

P22 added one retry after a P10 runtime timeout, but its timeout is only an AbortController signal. Production soak evidence shows that real fetch/response work can remain pending long after the 1500 ms abort signal, producing probe durations of about 97 s, 113 s, and 196 s before P11 finally fails closed to legacy-control.

P23 makes the existing per-attempt timeout a true wall-clock deadline without changing routing, retry eligibility, credentials, activation state, or repository-default behavior.

## Goals

- Keep the existing 1500 ms per-attempt timeout value.
- Keep exactly one retry, and only for the exact P10 timeout condition.
- Enforce the deadline even when `fetchImpl()` ignores `AbortSignal`.
- Enforce the same deadline across `response.json()` as part of the same attempt.
- Preserve P11 fail-closed behavior.
- Keep Standard and Deep on legacy-control.
- Do not perform activation or repository-default promotion.

## Non-goals

- Do not increase timeout duration.
- Do not add retries for HTTP, malformed JSON, invalid snapshot, duplicate rows, or parity failures.
- Do not alter P19 readiness rules.
- Do not change Supabase schema, cron, credentials, or production state.

## Approaches

### A. Increase timeout or add retries

Rejected. This may reduce observed failures but does not bound a fetch that ignores abort and can make worst-case latency larger.

### B. AbortController only

Current P22 behavior. Rejected because production evidence proves abort is not a reliable wall-clock bound for all fetch/response phases.

### C. Independent deadline race plus AbortController

Selected. Race the complete attempt against a timeout promise. When the deadline fires, abort the controller as cleanup and reject with the existing exact timeout error. This bounds fetch plus response parsing independently of whether the underlying operation cooperates with abort.

## Required behavior

1. One attempt must settle no later than approximately `timeoutMs` plus scheduler overhead.
2. A hung fetch that ignores abort must produce the existing `P10 runtime projection timed out` error.
3. A hung `response.json()` must produce the same timeout error.
4. The outer P22 logic retries exactly once only for that exact timeout error.
5. Existing non-timeout failures remain non-retryable.
6. Late settlement of the losing operation must not alter the already-settled result.

## Evidence driving P23

The clean P22/P19 soak produced 27 samples over 24.94 hours. Five were unhealthy. All five failed closed to Quick `legacy-control` with null parity. Three unhealthy probes ran for roughly 97 s, 113 s, and 196 s, which is incompatible with a true two-attempt 1500 ms wall-clock budget.
