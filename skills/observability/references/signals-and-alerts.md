# Signals and alerts

Adapted from `addyosmani/agent-skills` `observability-and-instrumentation` (MIT).

## Choose signals by question

| Signal | Best for | Typical failure |
|---|---|---|
| Structured log | What happened in this specific case and why? | prose blobs, missing correlation, sensitive fields |
| Metric | How often / how slow / how saturated in aggregate? | unbounded labels, averages hiding tails |
| Trace | Where did time or failure propagate across boundaries? | broken context propagation, tracing every trivial function |

## Logs

- Use stable machine-queryable event names and structured fields.
- Attach correlation/request/job identifiers where the system has that concept.
- `error` means an invariant/user-impacting failure that merits investigation; `warn` means handled degradation; `info` means a significant lifecycle/business event; `debug` is high-volume diagnostic detail normally disabled or sampled in production.
- Allowlist fields. Do not dump arbitrary request/response objects.

## Metrics

For request-driven paths, consider **RED**:

- Rate
- Errors
- Duration (histogram/distribution, not only an average)

For resources, consider **USE**:

- Utilisation
- Saturation
- Errors

Labels/tags must come from bounded sets such as route template, operation, status class, provider or outcome category. Never use user IDs, request IDs, email addresses, raw URLs or error-message text as metric dimensions.

Prefer p50/p95/p99 or another project-appropriate distribution view for latency when tail behavior matters. Do not invent SLO thresholds; derive them from a project contract, measured baseline, or explicit user/business requirement.

## Traces

- Reuse vendor/framework auto-instrumentation when it already captures the needed boundary.
- Add manual spans around meaningful owned work, external calls or queues only when they answer an operational question.
- Propagate trace context across HTTP, queue/message or async process boundaries where supported.
- Sampling policy is part of the operational contract; never assume 100% collection is affordable or available.

## Alerts

Prefer symptoms users feel over implementation causes.

Good alert candidates:
- sustained user-facing error rate above an agreed threshold;
- sustained latency/SLO violation;
- queue/job age that violates a business expectation;
- inability to perform a critical operation.

Cause signals such as CPU or a restarted process are often dashboard context unless they directly represent service exhaustion.

Every alert needs:

1. an actionable condition;
2. a threshold/duration with a stated source (SLO, measured baseline, or explicit decision);
3. the first diagnostic action or runbook;
4. a clear severity/owner appropriate to the project.

If the expected response is always "ignore it; it self-heals," it should not page a human.
