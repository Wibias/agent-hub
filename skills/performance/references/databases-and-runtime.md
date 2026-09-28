# Databases and runtime performance

Adapted from `addyosmani/agent-skills` `performance-optimization` (MIT), narrowed to evidence-first patterns.

## Query work

Before adding an index or rewriting a query, inspect the database's actual query plan on a representative dataset/environment when safe.

Look for evidence such as:
- sequential/full scans where selectivity suggests an index should help;
- row-estimate errors large enough to distort planner choices;
- explicit sort/hash/materialization work dominating the query;
- repeated queries per parent row (N+1) visible in traces/logs;
- lock waits or I/O rather than execution CPU.

Index for the **shape of the query**, not a column in isolation. A new index also taxes writes and storage. Re-measure the plan and workload after creation; an unused index is not a performance fix.

Verify database/version-specific syntax and online/concurrent index semantics through official docs.

## Connection pools

Pool exhaustion often appears as broad latency spent waiting for a connection rather than executing the query.

- Keep pool ownership consistent with the runtime deployment model; avoid accidentally creating a pool per request/module when one per process/runtime is intended.
- Size against database capacity and instance concurrency, not the intuition that "bigger is faster".
- In elastic/serverless deployments, total instances × per-instance pool can exceed the database ceiling; a multiplexing proxy may be the appropriate system fix.
- Measure pool wait, active/idle counts and database-side concurrency before changing limits.

## Memory

Distinguish:
- intentional cache growth with a bound/eviction policy;
- retained references/leaks;
- transient allocation pressure/GC;
- large payload/buffer lifetimes.

Repeat the operation and compare retained state after settling/GC where the runtime supports meaningful measurement. One high heap snapshot is not by itself a leak.

## CPU and concurrency

Profile before parallelising or moving work across threads/processes. Concurrency can improve throughput while worsening latency, memory, contention or downstream saturation.

Check:
- hot call stacks;
- blocking/synchronous work on latency-sensitive event loops;
- lock/contention or shared resource serialization;
- backpressure/queue behavior;
- downstream rate/capacity limits.

Every concurrency change needs a bounded-load comparison and correctness verification.

## Caching

Caching is a semantic change unless equivalence, invalidation and staleness bounds are explicit.

Before adding a cache, define:
- cache key and tenant/authorization isolation;
- authoritative source;
- invalidation/TTL policy;
- acceptable staleness;
- memory/storage bound;
- miss/error behavior;
- metric that proves the cache improves the intended bottleneck.
