# Reference Graph P24 Retry Budget Design

## Intent

P23 made each P10 attempt a true wall-clock hard deadline. Production soak evidence then exposed a different failure mode: one Quick probe failed closed after about 3227.75 ms, consistent with two consecutive 1500 ms hard timeouts plus overhead.

P24 keeps the first attempt fast at 1500 ms, keeps exactly one retry, and gives that retry a 5000 ms hard deadline.

## Evidence

- P23 local transport diagnostic: 12 runs, 11 pass, one double-timeout at 3003.336 ms, zero runs above 3500 ms. This verifies the P23 hard deadline.
- P23 clean soak: one unhealthy Quick sample at 3227.75 ms with legacy-control fallback and null parity. This is consistent with a real 1500 ms + 1500 ms double-timeout.
- Earlier transport-watch evidence showed first-attempt 1500 ms failures could recover on an immediate 5000 ms retry.

## Selected behavior

`fetchP10QuickCandidatePool` accepts two budgets:

- `timeoutMs`: primary attempt budget, production value 1500 ms.
- `retryTimeoutMs`: single retry budget, defaults to `timeoutMs` for backward compatibility.

The production Quick query path and P17 production probe explicitly use `retryTimeoutMs: 5000`.

## Invariants

- Exactly one retry, only after the exact P10 timeout error.
- Both attempts retain the P23 hard wall-clock deadline across fetch and response parsing.
- HTTP, invalid JSON, malformed or stale snapshot, duplicate identity, parity, and other non-timeout failures are not retried.
- P11 remains fail closed to legacy-control.
- Standard and Deep remain legacy-only.
- Canary and callers that do not opt in retain equal primary/retry budgets through the compatibility default.
- Worst-case production P10 transport budget is approximately 6500 ms plus scheduler overhead.
- No Supabase schema, credentials, activation state, cron, P19 readiness rule, or repository-default change.

## Promotion boundary

P24 does not authorize repository-default promotion. After merge and green post-merge governance, a new isolated P19 soak must be started from the exact P24 merge SHA. Failed P22/P23 soak evidence remains immutable historical evidence.
