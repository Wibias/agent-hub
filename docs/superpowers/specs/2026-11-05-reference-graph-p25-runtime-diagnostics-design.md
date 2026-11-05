# P25 Reference Graph runtime diagnostics

Date: 2026-11-05

## Incident and motivation

The pinned P24 production P19 soak was rejected after 35/36 healthy observations. Its unhealthy sample at `2026-11-04T20:20:09.350Z` took `55,020.3644 ms`, with Quick authoritative source `legacy-control` and null record/pattern parity. The hourly trigger was expected roughly seven minutes earlier. The P10 primary + retry budgets are 1500 + 5000 ms, but those limits do not bound P17's complete probe or guarantee an event-loop timer runs on time.

A healthy follow-on window does not erase this incident. P19 eligibility remains false for the original 36-sample window.

## Intent

Allow operators to attribute the next Quick fallback to one of several bounded categories and runtime phases, without changing retrieval outcomes, returning errors to users, revealing credentials, granting access, or relaxing readiness requirements.

## Approaches

- **Chosen: additive, in-band P19 diagnostics.** P10, P11 and P17 send safe events to an optional observer, and P19 retains an explicit, strictly allowlisted summary. The existing scheduled JSONL collection automatically captures the fields after repinning to the P25 revision.
- Separate diagnostic network calls or tracing agents were rejected: extra service permissions, altered timing and possible user-data exposure.
- Raising retry budgets or replacing legacy fallback with graph authority was rejected: it would weaken the safety contract and would not explain 55-second pauses.

## Contract

- P10 `onDiagnostic`: one event per attempted fetch, including ordinal (1 or 2), outcome, allowlisted category, elapsed milliseconds, budget and budget overrun. The callback is best-effort and cannot affect routing. No URL, key, error message, candidate rows or response data.
- P11 `onDiagnostic`: one event with final routing outcome, allowlisted fallback category and elapsed time. P11's existing `routing.reason` and public payload are unchanged.
- P17 `onDiagnostic`: timestamps for state projection, local record/pattern loading and each profile. P17's returned routing shape is unchanged. All events come from normal production probe execution; no extra network requests.
- P19 persists at most 32 allowlisted events in an optional additive `diagnostics` field, using `reference-graph.p25-probe-diagnostics.v1`. Unknown events, fields or categories cannot be serialized. An indicative `event_loop_delay_max_ms` is also present when events were captured; this sampled metric is **not** proof of a specific event-loop stall.
- The P19 CLI records `collector_node_process_started_at` and `collector_start_to_sample_ms` on real executable invocations. A Node process start is **not** the Windows Task Scheduler dispatch/start timestamp; diagnosing the latter requires Windows Task Scheduler history or launcher instrumentation.

## Safety and compatibility

- No new privileged key use or production RPC, no new P16 grant consumption, no Supabase writes.
- Quick retains fail-closed legacy fallback when transport or parity fails. Standard/Deep remain `legacy-control`.
- The P19 sample schema remains `reference-graph.p19-production-health-sample.v1` with strictly additive diagnostics. Existing P19 evaluator and criteria remain unchanged: 24+ samples, >=24h, <=90min max gap, all healthy, unique timestamps, exact P16 attestation and repo default off.
- Observer exceptions are swallowed. No raw exception messages, headers, keys, record data, URLs or request parameters enter the diagnostic sample.
- Historical P23/P24 failed evidence remains immutable. This PR is not a production deployment, successful soak, authorization to repin the Windows collector or permission to turn on the repository default.

## Verification

1. Test-first regression suite `tests/reference-graph/p25-runtime-diagnostics.test.mjs`: failed on the old code, then passed with P25 changes.
2. `node --test tests/reference-graph/*.test.mjs` in GitHub Actions, plus existing P16-P21 governance jobs and release checks.
3. After review/merge and explicit operator-controlled collector repin, a new pinned soak must measure the real runtime. Any unhealthy sample blocks the full original window; do not silently filter failures.

## Known limitations

P25 cannot guarantee exact wall time if the JS event loop is blocked, identify the operating-system cause of a late scheduled start, or fix runtime stalls. Evidence from a new failure can guide a separate P26 fix if needed.
