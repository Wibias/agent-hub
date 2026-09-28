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

- Record environment, build/revision, dataset/workload, warm/cold state and relevant throttling.
- Compare like with like.
- Use multiple samples or distributions when noise is material.
- Preserve a representative slow trace/profile before editing so the post-change comparison tests the same symptom.
- When a proposed fix targets a sub-measure, confirm the user-facing/system-level metric improves too.

## Guard

Choose the cheapest durable guard that matches the failure:

- microbenchmark for a hot pure function;
- integration benchmark for a request/query path;
- bundle/resource budget for payload growth;
- query-plan assertion for a critical indexed shape;
- runtime metric/alert for production-only saturation;
- `quality-constraints` ratchet when the project wants a standing budget.

Do not add a slow benchmark to every edit loop if CI/task-end placement provides the needed protection.
