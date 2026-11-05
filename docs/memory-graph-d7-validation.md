# D7: Repository freshness and bounded graph scale validation

D7 extends D6 validation without modifying production Recall, canonical Memory
schema, or the Memory Console HTTP API. It has **two separate modes**:

1. **Synthetic verification**: builds an ephemeral Git checkout plus four
   temporary SQLite MemoryEngine databases (100, 250, 500, and 501 claims),
   then deletes them. Requires Node 24 and local Git. This is a real
   integration/scale correctness check, **not** a production load benchmark.
2. **Live coverage**: uses D6's existing read-only diagnostic against the
   operator's Memory database and an explicitly supplied checkout. Requires at
   least one actually verified `fresh` repository claim. It never creates
   repository Evidence or writes to the live database.

## Synthetic tests and baseline measurements

From the `agent-hub` root:

```powershell
node --test tests/memory-engine/memory-graph-d7-*.test.mjs
node scripts/validate-memory-graph-d7.mjs --samples 3
```

Synthetic verification requires: all four graph sizes bounded correctly at 500,
zero unexpected omissions for <=500, expected one omitted claim for 501,
correct `fresh -> stale -> unchecked` transitions after changing a committed
Git blob and then switching branches, removal of typed advisory edges when
freshness is stale, a missing root and an injected Git command failure both
failing closed, and three simultaneous HTTP graph reads plus one overview read
without revealing Git paths. Graph timings are recorded as nearest-rank p50/p95
per fixture size. No hard CI performance SLA is imposed on shared runners.

Synthetic mode can create and delete files **only in a fresh OS temporary
folder**. It does **not** run `git reset` or `git checkout` on an existing
user checkout. All seeded Evidence and Claims contain disposable fixture text.
The CLI output contains only aggregate timings and status counts.

## Live repository coverage

The selected scope must contain existing repository-backed Evidence. D7 does
not manufacture it in your live Memory database. First list available scopes
with the existing D6 tool:

```powershell
node scripts/diagnose-memory-graph.mjs --list-scopes
```

Then run with an operator-approved checkout on the selected branch:

```powershell
node scripts/validate-memory-graph-d7.mjs --live --project-id 'github.com/Wibias/agent-hub' --branch 'main' --repo-root 'C:\path\to\agent-hub-main' --samples 5
```

Optionally provide `--db-path PATH` and `--max-p95-ms 2000`. The tool uses
D6's existing read-only mode and **blocks** when no repository claims exist,
no repository claim is `fresh`, Git context is untrusted/unstable, stale or
unchecked claims exist, the graph is truncated, or D6 itself reports an
attention/blocked/fail outcome. `blocked` is a meaningful coverage gap, not a
reason to insert synthetic claims into a production database.

The exit codes are `0` for pass, `2` for blocked, and `1` for fail. Only
allowlisted count, status, and latency fields are emitted. The project ID and
branch name are included, so inspect output before sharing.

## Acceptance boundaries

- The synthetic Git/SQLite suite and all D4/D5/D6 tests pass in Node 24 CI.
- A full synthetic 100/250/500/501-claim run passes on a real checkout.
- Live coverage requires at least one actual fresh repository-backed claim;
  the D6 `agent-hub/main` smoke test with zero repo claims is not enough.
- p95 readings from synthetic fixtures are hardware-specific measurements, not
  evidence of production performance or a before/after improvement.
- Do not merge solely on a synthetic pass. Review CI, CodeRabbit, and the
  remaining production live-coverage limitation explicitly.
