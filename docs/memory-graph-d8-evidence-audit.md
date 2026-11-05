# D8: Why does the live Graph show zero repository claims?

D8 is a **read-only canonical Evidence coverage audit** for a selected project
and branch. It answers whether repository evidence exists and whether it is
primary evidence for claims that the bounded graph would display.
It does **not** manufacture repository claims, change Memory, or verify Git
freshness. D5/D7 own trusted-checkout freshness checks.

## Usage (Node 24)

```powershell
node scripts/audit-memory-graph-d8.mjs --project-id 'github.com/Wibias/agent-hub' --branch main
# Alternative existing database:
node scripts/audit-memory-graph-d8.mjs --db-path 'C:\path\memory.sqlite3' --project-id 'github.com/Wibias/agent-hub' --branch main
```

This tool enumerates the selected project's canonical Evidence and Claims and
reports **only aggregate counters and fixed diagnostic labels**. It never
prints claim values, source refs, Evidence text, repository paths, blob IDs or
absolute database paths. The caller-provided project ID and branch are echoed
and should be inspected before sharing. Errors print fixed codes only.

## Interpretation

| `nextStep` | What the counters actually establish |
| --- | --- |
| `no_repository_evidence_recorded` | No repository-like Evidence exists in this project's export, on any branch |
| `repository_evidence_only_on_other_branches` | Repository Evidence exists, but not for the selected branch |
| `repository_claims_only_on_other_branches` | Some repository Evidence is primary on a different claim branch |
| `repository_evidence_not_primary_for_selected_scope` | This branch has repository Evidence but no repository-primary claims; supporting-only links are counted separately |
| `repository_claims_beyond_graph_limit` | Repository claims exist on this branch but are outside the 500-node graph selection |
| `review_repository_evidence_metadata_and_state` | Visible repository-primary claims exist but none have both active state and complete Git Evidence metadata |
| `run_d7_live_on_matching_checkout` | One or more candidates could be validated by D7 with an explicitly approved checkout |

A `ready_for_d7_live` status is **not** a `fresh` claim. It only shows that
read-only canonical records satisfy basic prerequisites. D7 must separately
verify repository identity, checkout branch, immutable HEAD and blob OID.

D8 uses the same repository marker predicate and active-first / recency-first
sort as Graph v2. The 500-node bound is applied to the full project/branch
claim list, not just repository claims. D8 reports Evidence whose primary claim
points to another branch or is missing; it does not attempt to fix it.

## Boundaries

- Existing SQLite is opened as `readOnly: true` and must already exist.
- `--help` requires no database.
- No hidden bootstrapping, ingestion, repair, or checkout mutation.
- `blocked` exit code 2 is a coverage fact, not a reason to add fake production data.
- Run focused tests and GitHub Actions before review; production D8 output must
  be independently captured by the operator on the actual target machine.
