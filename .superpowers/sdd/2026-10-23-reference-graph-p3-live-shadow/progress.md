# SDD ledger — plan: docs/superpowers/plans/2026-10-23-reference-graph-p3-live-shadow.md

Setup Ruling: GitHub branch isolation substitutes for a local git worktree in this connector-only harness — agent/reference-graph-p3 is stacked exactly on P2 and all writes are branch-scoped — cost if wrong: branch bleed; mitigated by P2→P3 compare checks before and after execution.
Pre-flight: Task 1 target-binding interfaces -> Tasks 3/6/8 consumers: names and target contract align with spec.
Pre-flight: Task 2 receipt interfaces -> Tasks 6/8 consumers: production_source and phase-state semantics align with spec.
Pre-flight: Task 4 live-shadow interfaces -> Tasks 6/8 consumers: deployed lexical/semantic/hybrid path aligns with persisted-embedding boundary.
Pre-flight: Task 5 latency fields -> Tasks 6/8 consumers: additive evaluator fields preserve existing quality metrics.
Pre-flight: Task 7 CI consumes all earlier P3 contracts; no interface conflict.
