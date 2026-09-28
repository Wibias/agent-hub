---
name: performance
description: >-
  Measure and improve cross-stack application performance across browser/network,
  backend/runtime, APIs, databases, queries, memory, CPU, and throughput. Use when
  users report slowness, a performance requirement or budget exists, profiling
  shows a bottleneck, or you need to investigate and guard a performance issue.
  Route hard regressions that first need a reproducible diagnosis loop to
  diagnose; React-specific audits to improve-react or project-local React Doctor;
  UI animation
  runtime work to design-with-ai; and SEO audits to seo-audit.
license: MIT
metadata:
  source: addyosmani/agent-skills
  adapted: "2026-09-04"
---

# Performance

Measure before optimising. A performance change without a baseline and post-change measurement is a hypothesis, not an improvement.

> Adapted from `addyosmani/agent-skills` `performance-optimization` (MIT).

## Routing boundary

Use this skill for **generic cross-stack performance ownership** when the problem is already framed as performance work or profiling can establish the bottleneck.

Prefer existing specialists when they own the primary ask:

- `diagnose` - hard/intermittent regression requiring a tight repro loop, bisection or instrumentation discipline before optimisation.
- `improve-react` - React-specific read-only audit and planning; use React Doctor via `npx react-doctor@latest` or its project-local installed skill for React diagnostics.
- `design-with-ai` - animation/motion runtime profiling inside visible-UI design work.
- `seo-audit` - SEO/CWV audit where search visibility is the primary goal.
- framework/database specialists - exact framework configuration or database-specific implementation details after this skill identifies the bottleneck.

## Workflow

`MEASURE -> IDENTIFY -> FIX -> VERIFY -> GUARD`

1. **Define the user/system symptom and success measure.** Name the operation, environment, workload and metric that matters. Do not optimise "the app" generically.
2. **Measure a baseline.** Load `references/investigation.md`. Prefer representative runtime data; distinguish synthetic lab measurements from real-user/production evidence.
3. **Identify the bottleneck.** Follow evidence across browser/network, client main thread, server/runtime, external calls, queues and database. Do not patch the first suspicious code path without proving it dominates the symptom.
4. **Apply the smallest causal fix.** Preserve correctness and operational safety. Use source-driven-development for version-specific framework/database features.
5. **Verify on the same workload and environment.** Compare before/after distributions or resource profiles, not only one lucky sample. If the intended metric does not materially improve, revert or reclassify the hypothesis.
6. **Check trade-offs.** A latency win that increases memory, database load, correctness risk, cache staleness or cost may be a regression elsewhere.
7. **Guard against recurrence.** Add the cheapest reliable benchmark, budget, query-plan check, metric, regression test or project constraint that would catch the same class without making the inner loop unusable.

## Evidence rules

- Do not claim a bottleneck from static source inspection alone when runtime measurement is available and material.
- Do not claim RUM improvement from local Lighthouse/DevTools evidence; label lab and field evidence separately.
- Do not recommend memoization, caching, indexing, concurrency or code splitting merely because they are common fixes. Prove the specific bottleneck first.
- A benchmark that does not exercise the user-relevant path is not proof.
- Report blocked measurements as blocked rather than substituting intuition.

## References

- `references/investigation.md` - symptom-to-measurement routing and before/after evidence.
- `references/databases-and-runtime.md` - query plans, pools, memory/CPU, caches and throughput.
- `tests/evals/cases.jsonl` - discovery and adversarial qualification cases.
