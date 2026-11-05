# D6: Memory Graph production validation and diagnostics

The D6 tool measures **the existing read-only Graph Quality v2 path** against a local Memory database and, optionally, explicitly approved Git checkouts. It does not call any canonical Memory write method and does not change production Recall routing. This is a diagnostic tool, **not** a new HTTP endpoint or an automatic activation gate.

## Requirements

- Node.js 24; run commands from the `agent-hub` repository root.
- An already existing local Memory SQLite database (opened with `readOnly: true`).
- A registered project ID and branch present in that database.
- To verify repository-backed Evidence, at least one `--repo-root` directory matching that project's canonical identity and checked-out branch. No root is inferred from HTTP queries, the working directory, or the claim itself.

## Discover valid scopes

```powershell
node scripts/diagnose-memory-graph.mjs --list-scopes
# or specify a different database:
node scripts/diagnose-memory-graph.mjs --db-path 'C:\path\memory.sqlite3' --list-scopes
```

Scope discovery reports only registered project identifiers, branch names, and claim counts; it does not print individual claims.

## Smoke-test a scope, then benchmark it

```powershell
node scripts/diagnose-memory-graph.mjs --project-id 'github.com/example/repo' --branch 'main' --samples 5 --repo-root 'C:\path\to\repo'
```

Omit `--repo-root` when the scope has no repository-backed Evidence. When repository-backed nodes exist without a matching trusted Git checkout, the diagnosis is intentionally **blocked**, not passed. Multiple `--repo-root` flags are allowed, but no more than 16. Use `--max-p95-ms 2000` if you explicitly want to flag p95 latency above 2000 ms.

The tool re-resolves the Git checkout separately for each sample, runs the same `memoryUiGraph()` Graph v2 projection used by the Memory Console, and measures the **full per-sample wall-clock latency** (including Git resolution, blob checks, and projection). The p50/p95 metrics use nearest-rank values, not a warm-cache throughput benchmark. Threshold decisions use the unrounded p95; reported timings are rounded to two decimals. One run is not a historical performance baseline.

Output is JSON, with read-only status, graph counts, freshness status/reason counts, truncation counts, Git-context stability, and latency. Graph counters describe the final successful sample; a stale-repository warning is retained if it occurred during any successful sample. No claim text, raw Evidence, absolute checkout paths, stored vectors, or raw exception messages are included. Project IDs, branches, and a 12-character Git revision prefix are included, so **inspect before sharing**.

## Outcome and exit codes

| Outcome | Meaning | Exit code |
| --- | --- | --- |
| `pass` | Completed; no diagnostic warnings | `0` |
| `attention` | Completed; stale repository nodes, empty graph, truncation, or optional p95 limit exceeded | `0` |
| `blocked` | Repository-backed claims lack verified Git context, or sampled context changed | `2` |
| `fail` | Read-only query failed or returned a contract mismatch | `1` |

An unconfigured Git root is only a blocker when the selected scope has repository-backed graph nodes. `stale` **does not prove a changed file**: it can also mean a missing/deleted file, invalid Evidence, inaccessible Git state, or an inactive/historical claim. The reason `blob_not_verified` is deliberately conservative. The CLI never promotes unverified repository Evidence to `fresh`.

## Acceptance checklist

1. Obtain a `pass` or explain every `attention` entry; `blocked`/`fail` are not production sign-off.
2. Validate `git.stable=true` across at least five samples with the intended checkout selected.
3. Record p50, p95 and maximum latency for the real target database and machine. Do not infer a performance improvement without a comparable baseline.
4. Confirm `graph.limits.nodesOmitted=0` and `typedRelationsOmitted=0`, or explicitly accept the bounded truncation.
5. Review counts for stale/unchecked repositories, and verify the checkout's branch/revision after a branch switch. Run again with the intended branch.
6. Run `node --test tests/memory-engine/memory-graph-diagnostics*.test.mjs` plus the D4/D5 graph regression tests before a merge.

Do not share live database files, raw claims, internal checkout paths, or complete diagnostic logs without reviewing them. **Never merge solely because the focused tests are green**; local live smoke and the new D6 CI check are separate evidence.
