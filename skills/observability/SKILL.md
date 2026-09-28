---
name: observability
description: >-
  Design and verify vendor-neutral production observability for a feature or
  service: structured logs, bounded-cardinality metrics, traces, correlation,
  alerts, and operational questions. Use when adding telemetry, instrumenting a
  production path, reviewing whether a feature can be operated, or when incidents
  are hard to diagnose because the system emits the wrong signals. Not for
  debugging the current incident (diagnose), generic performance optimisation,
  or vendor-specific Sentry/OpenTelemetry setup when the telemetry contract is
  already defined.
license: MIT
metadata:
  source: addyosmani/agent-skills
  adapted: "2026-09-04"
---

# Observability

Make production behavior answerable from emitted evidence instead of source-code archaeology.

> Adapted from `addyosmani/agent-skills` `observability-and-instrumentation` (MIT).

## Ownership

This skill owns **what must be observable and how to prove the signals answer operational questions**.

Vendor-specific setup skills may implement Sentry, OpenTelemetry, Prometheus, Grafana or another backend after this contract is clear. `diagnose` owns the active debugging loop for a failure happening now.

## Workflow

1. **Define the questions.** Before adding telemetry, write 2-5 concrete questions an operator would ask when this feature is healthy, slow, degraded, or failing. Telemetry that answers no question is noise.
2. **Map question to signal.** Use logs for case-specific cause/context, metrics for aggregate rate/error/duration or resource state, and traces for path/latency across boundaries. Load `references/signals-and-alerts.md` for signal rules.
3. **Establish correlation.** Preserve a stable request/job/operation identifier across the relevant boundary where the architecture supports it. Never turn high-cardinality IDs into metric labels.
4. **Instrument the smallest useful surface.** Prefer stable event names and structured fields over prose logs. Add metrics around owned interfaces and external dependencies, not every function.
5. **Control cardinality and privacy.** Metric labels come from bounded sets. Never log secrets, authorization headers, tokens, passwords, payment data, or unrestricted request bodies. Minimize personal data.
6. **Trace meaningful boundaries.** Prefer existing auto-instrumentation where appropriate; add manual spans only around operations that answer a real latency or failure question.
7. **Alert on symptoms.** Page on user-visible impact or violated service objectives, not merely on implementation causes. Every alert must be actionable and point to a first diagnostic action/runbook.
8. **Prove the telemetry.** Load `references/verification.md`; induce or simulate representative paths and verify the actual emitted logs/metrics/traces/alerts rather than declaring the instrumentation correct from source review.

## Honesty rules

- Source inspection may identify missing or risky instrumentation; it does not prove live telemetry works.
- A dashboard existing is not evidence that its data is correct.
- An alert definition existing is not evidence that delivery works.
- Do not claim distributed trace continuity unless a real or representative trace crosses the required boundaries.

## References

- `references/signals-and-alerts.md` - logs, metrics, traces, cardinality, RED/USE, alerts.
- `references/verification.md` - live proof contract for telemetry.
- `tests/evals/cases.jsonl` - discovery and adversarial qualification cases.
