# Reference Graph P22 — Bounded Runtime Timeout Retry Design

## Problem

P19 production soak evidence shows transient Quick routing fallbacks while activation, current-date projection, Standard, Deep, and repository-default state remain correct. A 30-hour five-minute P10 transport watch recorded 361 observations: 320 first-attempt successes and 41 first-attempt failures at the existing 1500 ms transport budget. Every one of those 41 failures recovered on the immediate bounded diagnostic retry. Successful first attempts had p95 1059.7 ms, p99 1351.8 ms, and a maximum of 1407.0 ms.

The existing P11 fail-closed behavior is correct, but a single transient P10 timeout is currently enough to force an avoidable legacy fallback.

## Decision

Keep the existing per-attempt timeout unchanged and add exactly one retry inside `fetchP10QuickCandidatePool` only when the first attempt fails with the P10 timeout error.

- Attempt 1 uses the caller-provided `timeoutMs` (1500 ms in production).
- Only `P10 runtime projection timed out` is retryable.
- Attempt 2 uses the same `timeoutMs`.
- A second timeout fails closed exactly as before.
- HTTP errors, invalid JSON, malformed/empty/wrong-date snapshots, duplicate identities, and all other transport/data contract errors are never retried.
- `transport.latency_ms` measures total elapsed time across both attempts when recovery is needed.

## Safety properties

- No credential scope changes.
- No database/schema changes.
- No activation-state changes.
- No repository-default promotion.
- Publishable-key RLS read path remains unchanged.
- Fast path remains a single request.
- Complete outage remains bounded to two timeout windows rather than a blanket five-second request.
- Existing P11 legacy fallback remains authoritative if both attempts fail or parity fails.

## Verification

Regression tests must prove:

1. timeout then success performs exactly two calls and returns the graph candidates;
2. timeout then timeout performs exactly two calls and throws the timeout error;
3. non-timeout HTTP failure performs exactly one call;
4. existing P10/P11/reference-graph suites remain green.

After merge, production validation requires a fresh P19 evidence window. Historical unhealthy P19 evidence is retained and is not rewritten or deleted.
