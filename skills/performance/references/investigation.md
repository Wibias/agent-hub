# Performance investigation

Adapted from `addyosmani/agent-skills` `performance-optimization` (MIT).

## Start from the symptom

| Symptom | First useful evidence |
|---|---|
| Slow first load | navigation/network waterfall, server response timing, critical resource sizes, render/main-thread trace |
| Sluggish interaction | interaction trace, long tasks, render/update cost, layout/style work |
| Slow client navigation | data-fetch waterfall, cache behavior, render cost, route bundle/code loading |
| Slow API endpoint | end-to-end request timing, traces, external dependency timing, database query plan |
| Intermittent latency | latency distribution, traces for slow exemplars, queue/pool saturation, GC/lock/contention signals |
| Memory growth | heap/allocation evidence, retained objects, cache/container growth across repeated operations |
| CPU spike | CPU profile/flame graph on representative load; event-loop/blocking work where relevant |
| Throughput collapse | concurrency/load profile, saturation point, queues/pools/database capacity and backpressure |

## Browser evidence

Separate:

- **Network/server:** DNS/connection/TTFB, request waterfall, transfer sizes, caching.
- **Main thread/rendering:** scripting, style/layout, paint/composite, long tasks, interaction timing.
- **Field/RUM:** actual user/device/network distributions.

A synthetic trace is reproducible lab evidence. It is not automatically representative field evidence.

For current Web Platform/Core Web Vitals definitions or framework recommendations, verify official sources through `source-driven-development` rather than freezing changing thresholds into this generic skill.

## Measurement discipline

Before running a comparison, write down the claim the number is meant to support.
Read the measurement harness and note what it times, counts, excludes, caches, and
treats as success. Record environment, build/revision, dataset/workload,
warm/cold state, relevant throttling, and production-relevant flags.

Compare like with like. When noise, warmup, cache drift, or machine load can
matter, alternate the compared sides (A, B, A, B...) instead of running one side
to completion first.

### Measurement-validity gate

Before reporting or acting on a measured speedup, regression, throughput, latency,
memory, or benchmark result, answer these with run evidence:

1. **What limits the number?** Name the dominant resource or code path from a
   representative profile/counter/trace, not from source-code intuition alone.
   Ask what prevents the result from being roughly twice as good. A saturated
   load generator is a benchmark limiter too.
2. **Were both sides production-representative?** Use comparable release builds,
   flags, versions, data, batching, pools, indexes, cache state, and other relevant
   settings. An untuned side makes a winner claim inconclusive.
3. **Does the result respect system limits?** Check simple upper bounds from CPU,
   bandwidth, I/O, concurrency, or the measured share of the changed component.
   A result beyond a plausible ceiling usually means the harness measured a
   cache, no-op, error path, or different work.
4. **Did requests or operations fail?** Count failures, timeouts, retries,
   non-success responses, and incorrect outputs. Fast failures are not fast
   successful work.
5. **Does it reproduce beyond noise?** Use enough alternating samples to estimate
   the distribution. Prefer median plus range or another appropriate spread.
   Treat a delta smaller than normal variation as no measurable difference.
6. **Does it matter end to end?** Measure the user-facing or system-level path
   next to a micro result. A component that was 1% of the total path cannot
   explain a large end-to-end win by itself.
7. **Did the intended work actually happen inside the measured region?** Confirm
   the request reached the target, rows/bytes/operations were processed, awaited
   work completed, and outputs were consumed. Lazy or skipped work can produce
   excellent-looking numbers.

If the intended comparison cannot establish the limiter, comparable tuning,
error/work counts, or work execution, report **inconclusive** rather than
choosing a winner.

Preserve a representative slow trace/profile before editing so the post-change
comparison tests the same symptom. When a proposed fix targets a sub-measure,
confirm the user-facing/system-level metric improves too.

## Reporting a benchmark

Lead with one of: `faster`, `slower`, `no measurable difference`, or
`inconclusive`.

For a material comparison, include the primary metric and unit, sample count,
spread, workload/environment, and named limiter. Keep raw runs and deeper profile
evidence in a linked artifact when the reporting surface should stay compact.

## Guard

Choose the cheapest durable guard that matches the failure:

- microbenchmark for a hot pure function;
- integration benchmark for a request/query path;
- bundle/resource budget for payload growth;
- query-plan assertion for a critical indexed shape;
- runtime metric/alert for production-only saturation;
- `quality-constraints` ratchet when the project wants a standing budget.

Do not add a slow benchmark to every edit loop if CI/task-end placement provides the needed protection.
