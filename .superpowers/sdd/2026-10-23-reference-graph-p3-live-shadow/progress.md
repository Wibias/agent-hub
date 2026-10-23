# SDD ledger — plan: docs/superpowers/plans/2026-10-23-reference-graph-p3-live-shadow.md

Setup Ruling: GitHub branch isolation substitutes for a local git worktree in this connector-only harness — agent/reference-graph-p3 is stacked exactly on P2 and all writes are branch-scoped — cost if wrong: branch bleed; mitigated by P2→P3 compare checks before and after execution.
Pre-flight: Task 1 target-binding interfaces -> Tasks 3/6/8 consumers: names and target contract align with spec.
Pre-flight: Task 2 receipt interfaces -> Tasks 6/8 consumers: production_source and phase-state semantics align with spec.
Pre-flight: Task 4 live-shadow interfaces -> Tasks 6/8 consumers: deployed lexical/semantic/hybrid path aligns with persisted-embedding boundary.
Pre-flight: Task 5 latency fields -> Tasks 6/8 consumers: additive evaluator fields preserve existing quality metrics.
Pre-flight: Task 7 CI consumes all earlier P3 contracts; no interface conflict.
Task 1: complete (RED run 39886107575: 51 pass / 3 expected fail missing target-binding; GREEN run 39886176970: full Reference Graph suite PASS, 54 tests).
Task 2: complete (RED run 39886314022: 54 pass / 3 expected fail missing p3-receipt; GREEN run 39886372542: full Reference Graph suite PASS, 57 tests).
Task 3 Ruling: preserve the existing P2 embedding error priority — missing --allow-experimental fails before missing --target; once experimental persistence is acknowledged, target binding must pass before Ollama/store/network work — cost if wrong: only error priority differs while the write-safety invariant remains.
Task 3: complete (RED run 39886459778 plus intermediate 39886539786 exposed missing target gates; GREEN run 39886562889: full Reference Graph suite PASS).
Task 4 Ruling: do not infer model compatibility from reference_graph_stats total embeddings and do not add/alter migrations solely for diagnostics; repo-side availability probes the exact model/revision semantic RPC, while Task 8 verifies exact persisted model/revision counts with read-only SQL — cost if wrong: a false unavailable probe is possible if compatible vectors exist yet yield no probe candidate; live SQL verification catches that case.
Task 4: complete (RED runs 39886639982/39886790215; GREEN run 39886922916: 65/65 Reference Graph tests PASS).
Task 5 Ruling: run 39887088976 exposed a test-fixture error only — the synthetic quick case used limit=1 although quick selection requires 3-6; corrected the fixture to 3 and left timing product code unchanged.
Task 5: complete (RED run 39887024677; fixture-only failure run 39887088976; GREEN run 39887164597: full suite PASS with 68 tests).
Task 6: complete (RED run 39887272799 missing operator; GREEN run 39887345327 after read-only p3-live-shadow operator; README then surfaced a historical P0 documentation assertion rather than a product failure).
Task 7 Ruling: historical P0 'no live Supabase deployment' evidence belongs to the frozen P0 foundation spec, not the current P3 README; current docs instead prove dedicated-target binding, no ambiguous-project mutation, and no production cutover.
Task 7: complete (RED run 39887513159 on missing permanent P3 artifact secret scan; contract GREEN run 39887576420; full disposable DB verification run 39887636541 / job 120199430176: 72/72 tests PASS, secret scan PASS, 600 records / 576 sources / 600 assets plan, migrations 001/002/003 PASS, service_role RPC PASS, anon denial PASS).
Task 8: blocked intentionally at organization/cost authorization before any Supabase project creation.
