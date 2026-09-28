# Memory Ratchet

The Memory Ratchet is a candidate-neutral evaluation contract for long-term memory systems used by coding agents.

It answers one question:

> Can one memory layer safely preserve, update, scope, and recall coding knowledge across harnesses without becoming a stale or untrusted second source of truth?

The ratchet does not select a product by feature count. It tests observable behavior against the same synthetic repository, event corpus, queries, and acceptance rules.

## Frozen baseline

Specification version: `0.1.0`

The baseline is frozen before candidate adapters are implemented. Changes after candidate execution starts must:

1. explain the defect in the benchmark rather than a candidate-specific result;
2. increment the specification version;
3. preserve prior receipts;
4. rerun every affected candidate on the new version.

`SPEC.md` is normative. `cases.json` is the machine-readable case registry. `receipt.schema.json` defines the durable result envelope.

## Initial research set

The first planned adapters are:

- memspec
- Kage
- LongMemory
- GBrain
- Midas
- agentmemory
- Hindsight

This list is not part of the benchmark contract. Adding or removing a candidate must not change the cases.

## Phases

1. Freeze this specification.
2. Build the deterministic fixture repository and event corpus.
3. Implement a thin adapter for each candidate.
4. Run the required core track.
5. Run the native track when the project ships an official harness integration.
6. Eliminate candidates that fail a hard gate.
7. Compare surviving candidates using the raw receipts and secondary metrics.

No adapter may repair a candidate's semantics. Adapter logic may translate formats and invoke documented APIs only.

## Implemented neutral harness

The frozen baseline now includes:

- a deterministic two-repository Git fixture with stable commit identities;
- a fixed event corpus spanning all five trust classes;
- case setup for M01-M15, including deterministic long-gap and recall-noise profiles;
- semantic revision labels resolved to immutable Git SHAs before an adapter sees an event;
- a neutral core adapter contract: `reset`, `setup`, `ingest`, `recall`, `teardown`;
- optional lifecycle operations for export, rebuild, recovery, and interrupted-ingest cases;
- result aggregation where case verdicts derive from assertion verdicts;
- receipt redaction that removes the synthetic M11 credential only after raw candidate output has been scored.

Local structural verification:

```text
node --test tests/memory-ratchet/spec.test.mjs
node --test tests/memory-ratchet/fixture.test.mjs tests/memory-ratchet/runner.test.mjs tests/memory-ratchet/adapter-contract.test.mjs tests/memory-ratchet/receipt.test.mjs
```

Candidate adapters must not import candidate-specific semantics into these shared layers.
