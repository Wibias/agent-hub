# Memory graph follow-up: Windows test isolation and typed discovery

## Scope

This follow-up is based on 2606f42c2d018e15e773955f1089f4e57b3f8855.
No production database, Codex configuration, approval authority, or Recall
routing was changed.

## Windows test repairs

- Real embedding IPC tests now select a unique Windows named pipe or a Unix
  socket, exercise endpoint collision on both platforms, and assert POSIX
  permissions only on POSIX.
- The hook installer assertion checks the exact host-resolved and PowerShell-
  quoted path instead of demanding a POSIX path on Windows.
- The list, replace and forget CLI fixtures now set LOCALAPPDATA as well as
  XDG_STATE_HOME. The latter is ignored by the production-mode Windows path
  resolver. The previous tests could accidentally open the real local store.
- These tests are included in the existing Windows/Linux MCP CI matrix.

An independent read-only inspection of the existing local store found the
three example test project registrations; one had two Claims and two Evidence
rows. This is not evidence of damage to unrelated user memories. No deletion
or cleanup was performed. SQLite quick_check returned ok. Test contamination
must be reviewed and removed only through an explicitly authorized repair.

## Entity identity

Module paths are no longer collapsed to basenames. Explicit paths retain
directory identity, case, and punctuation; slash normalization and inline
code notation identify the same path. Distinct modules with a common basename
remain distinct, and derived entity projection is versioned v2.

## Typed advisory discovery

The read-only discovery planner uses existing compatible embedding similarity
and exact named-entity matches as candidate signals, not proof of a relation.
It excludes out-of-scope, historical, unverified repository, untrusted, and
conflicting endpoints. The existing semantic relation judge verifies each
bounded candidate set and validates the allowed relation proposal contract.
Changed Claim/Evidence snapshots invalidate in-flight responses. No provider
is called for a plan or an empty candidate set. No producer automatically
persists model output or changes Recall.

Example, against an explicitly selected existing store:

    node scripts/discover-typed-relations.mjs --db-path PATH --project ID --branch NAME

Add --judge only to explicitly request the configured isolated Codex provider
to see the selected Claim text. --source, --after, --limit (1-10) and --targets
(1-12) bound the work. The command has no apply mode. Proposed edges require
review and the existing explicit advisory ledger write path. The integration
test verifies persistence and Graph display in a disposable store.

## Verification

Windows Node 24.22.1, separate Git worktree:
- Full isolated memory-engine suite: 1492 total, 1487 pass, 5 skipped, 0 fail,
  exit 0. This run included the first four discovery tests.
- Final focused regression: 84 total, 83 pass, 1 existing Windows symlink
  skip, 0 fail. Includes two later CLI and stale-response tests.
- The 20-case quality review packet is still synthetic and not human-validated.
- Four real-provider attempts against the existing synthetic relation fixture
  returned four judge errors, zero scored cases. Precision/recall are null.
  Both native Codex CLI 0.172.0 and npm CLI 0.169.0 failed on a minimal
  synthetic JSON request with Windows os error 2. Moving the isolated home
  outside Temp removed a warning but did not fix the error. The exact missing
  file has not been identified. No production Claim text was sent by these
  probes.

## Combined graph performance

Synthetic isolated store: 500 Claims, 500 compatible 384-dimensional
synthetic vectors (not model-generated), 10 typed fixture relations, 1050
entity edges. Three runs with similarity enabled yielded 418, 420 and
445 ms projection time; JSON serialization 3 ms; 1,147,203 bytes; 521 nodes,
730 semantic edges, 10 typed edges, 1050 entity edges; no truncation.
Without similarity: 182 ms projection, 2 ms serialization, 901,769 bytes.
The 750 ms and 1.5 MB existing budgets were met for graph computation and
payload; HTTP transport, real browser rendering and heap were not measured
in this run.

## Open limits

- Automatic candidate discovery is available in read-only preview. Real
  model quality, review and automatic production ledger writes are not
  validated or enabled.
- Explicit Topic Nodes were not added; current entity-derived community labels
  remain. A separate topic representation needs a distinct grounded benefit,
  not redundant graph density.
- No native Design-With-AI gate certification was attempted from a non-Codex
  remote shell. The prior workspace mismatch is not resolved by changing
  cwd or regenerating a receipt.
- Protected Approval and Reference Graph production activation remain NO-GO.

## Codex judge startup and live relation evaluation follow-up

The previously unidentified startup failure was reproduced with an isolated Codex home containing the configured model_catalog_json reference without its catalog. Copying that catalog and rebasing the reference allowed the same CLI to return valid JSON (exit 0). The shared isolated-home preparation now performs that copy, including relative and absolute configured paths, and fails explicitly for a missing or invalid catalog. The original configuration is unchanged. No hooks, MCP config, legacy memory, or unrelated files are copied by the catalog repair.

The original four-case semantic shadow fixture repeats the same input with contradictory expected labels; it remains useful for deterministic scoring tests, not live accuracy. A separate eight-case synthetic development set is now available through:

    node scripts/eval-semantic-relations-live.mjs --judge

Only the fixed synthetic fixture is used by that evaluator. Its adapter preserves the aggregate Codex input/output token counters without treating cache or reasoning breakdowns as extra usage. The undirected-edge scorer now uses the normalized endpoints. The first v1 run on the new fixture scored all eight cases: 3 true positive edges, 1 false edge, 1 missing edge, 4 correct negatives; precision/recall 0.75; mean 4581.5 ms. Policy v2 explicitly defines directed relation semantics. The second run on the same fixture scored all eight cases: 4 true positive edges, 0 false or missing edges, 4 correct negatives; precision/recall 1.0; mean 4180.2 ms. This is a development-set rerun after prompt refinement, not independent validation, and has no human ground truth. No production Claim text was sent or persisted.

Final local Windows execution of the expanded read-only MCP CI test command: 265 total, 264 pass, 1 existing Windows symlink skip, 0 fail, exit 0. The earlier full isolated suite result is historical and was not rerun against the later catalog and evaluator changes. The provider-backed command is explicit opt-in and is not executed by CI.

Automatic production relation persistence remains disabled. Quality remains PROVISIONAL, with a separate independent review/holdout needed. The original protected approval and Reference Graph activation limitations are unchanged.


## Expanded live relation evaluation and graph performance follow-up

The 12-case development set adds related_to, reversed implementation, multiple
prerequisites, and prompt-injection cases. A separate six-case synthetic
challenge set is available using --judge --holdout. Both are fixed synthetic
author-labelled data; neither is independent human ground truth.

| Policy / dataset | Cases scored | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| v2, expanded development | 12/12 | 5 | 1 | 2 | 0.8333 | 0.7143 |
| v3, development rerun | 12/12 | 6 | 1 | 1 | 0.8571 | 0.8571 |
| v3, separate synthetic challenge set | 6/6 | 3 | 0 | 1 | 1.0 | 0.75 |

All 30 evaluations completed with zero provider failures and invalid responses.
Policy v3 asks the judge to consider targets independently, reject reversed
directed edges rather than relabel them, and distinguish a concrete shared
artifact/event from broad topical similarity. The development rerun corrected
the three earlier failures but mislabelled one German dependency as related_to.
The challenge set missed one explicit same-artifact related_to edge. This is
not a robust quality or automatic persistence gate. The challenge set was
authored with knowledge of the development failures, before running v3 on it.

The live evaluator now reports provider cache and reasoning breakdowns separately
from aggregate input/output usage. Missing fields remain unknown rather than
zero; breakdowns are never added again to aggregate usage. The v3 development
run reported 211705 input, 2860 output, 154624 cached input and 2339 reasoning
output tokens. The six-case challenge set reported 108510 input, 1174 output,
56320 cached input and 965 reasoning output tokens. A 24-character minimal
request still reported 16991 input tokens (11264 cached); two 2323-character
relation requests reported 17476 and 18527 input tokens (0 and 11264 cached).
This establishes substantial judge/harness/provider overhead, not its exact
composition or billable cost. Isolation was not weakened to reduce tokens.

### Performance repair and paired verification

A regression test demonstrated two observability reads for each selected Claim
before the repair; the repaired graph uses one and preserves the exact cosine
weight. Vector norms are computed once per compatible embedding instead of
for each pair. Invalid/non-finite similarities are not emitted. No durable cache
or new authority is introduced.

Paired measurements alternated the original graph implementation from HEAD
and the modified implementation over the same disposable SQLite database:
500 Claims, 500 compatible 384-dimensional synthetic vectors, 10 fixture typed
relations, and repeating SQLite/Node.js/module entities. Old/new base graph
times in ms: 524/363, 532/329, 470/459. Medians: 524/363, a 30.7% reduction.
The complete legacy graph objects were exactly equal on every paired run
(500 Claim nodes, 720 inferred edges). Real graph HTTP projection adds typed and
entity edges and has its own scope/filter behavior.

The combined HTTP/browser fixture yielded 523 total nodes, 2230 edges
(730 semantic, 10 typed, 1500 entity links), 500 entity links omitted by the
existing bound, and 1299127 UTF-8 payload bytes. Three post-repair direct HTTP
requests took 345/428/910 ms. Headless Chrome, isolated profile, 1424x905
viewport, real loopback server and direct graph navigation: browser API
912/364/406 ms, measured render 80/73/85 ms, 522 visible SVG nodes (one isolated
node hidden), 2230 drawn edges, no JS exceptions. Browser TTFB accounted for
most API time. JS heap snapshot samples 9476360/17512720/12539360 bytes;
not peak or retained-heap measurements. Before the repair the comparable direct
navigation sample had API 944/1695/1076 ms and render 127/269/94 ms; host load
was not controlled, so do not treat these separate runs as a causal speedup.
The paired base graph comparison is the stronger causal evidence.

Render and payload budgets passed after the repair. The median browser API
latency passed 750 ms, but one of three browser requests and one direct HTTP
request exceeded 750 ms. Combined performance remains PARTIAL. No browser
visual or interaction recertification across all DWA viewports was attempted;
headless render measurements do not establish DWA certification.

Focused graph regression: 40/40 passed after the repair. Focused judge and
discovery regression: 45/45 passed, and the six live evaluator unit tests passed.
Automatic production relation persistence remains disabled. No production
memory was sent, stored, deleted, or modified by these tests.


## Batched graph metadata and final performance probe

The graph-specific observation reader now obtains bounded, project/branch-scoped
embedding metadata and aggregate recall usage with two SQLite queries, rather
than loading the full per-Claim candidate and Evidence observability record.
It limits requested IDs to 500, rejects duplicate IDs, omits missing and
foreign-scope IDs and preserves null/zero usage semantics and embedding order.
The fallback interface remains supported. Tests compare against the existing
individual observation path and exercise the owned read-only SQLite handle,
other-project and other-branch exclusions, and canonical export invariance.
The regression is included in the existing Windows/Linux MCP CI workflow.

Five paired base graph measurements on the same synthetic store showed median
times of 599 ms (original), 392 ms (single-observation/norm optimization), and
215 ms (batched metadata). All five complete outputs were equal. Five
subsequent Chrome runs at 1424x905 rendered 522 visible nodes and 2230 edges,
with browser API 268/282/281/292/226 ms and render 113/102/91/94/105 ms;
no JS exceptions. Separate HTTP measurements 272/315/255/811/768 ms still
contained two budget violations.

The repeatable combined synthetic-only HTTP probe is:

    node scripts/benchmark-memory-graph-combined.mjs --samples 20

It uses a fresh disposable SQLite database, 500 Claims, 500 synthetic
384-dimensional embeddings and ten fixture typed relations; the server opens
its own read-only handle. It verifies the expected graph size and edge counts,
checks exact projection equality except for the per-request asOf timestamp,
records wall and process CPU time and exits nonzero if a sample exceeds the
750 ms / 1.5 MB budgets. It never uses a production database or provider.

An initial 20-request run after batching had median 201.5 ms, max 991 ms,
19/20 within budget. The slowest request had 797 ms of process CPU time.
High host load was observed, but does not explain the CPU cost by itself.
An instrumented V8 profile attributed the largest sampled time to
semanticEdges (including inlined work); GC pauses were comparatively small.
The innermost cosine accumulation now reuses vector references and length,
with identical arithmetic and accumulation order. No approximation or
threshold change is introduced.

| HTTP sample series | Within budget | Median ms | Max ms |
| --- | ---: | ---: | ---: |
| Before vector loop change | 19/20 | 201.5 | 991 |
| After, first | 20/20 | 121.5 | 498 |
| After, second | 20/20 | 136.5 | 515 |

Both post-change series preserved 523 nodes, 2230 edges, 500 entity links
omitted by the existing bound, and 1299167 bytes per response. The results
are local observations, not universal latency guarantees or controlled
cross-machine measurements. A separate dense-vector SQLite fixture with 500
Claims and 384-dimensional vectors produced exactly equal full legacy graph
objects (740 edges) in three paired comparisons of the pre-/post-loop
versions, with times 160/114, 386/100 and 122/78 ms. No browser/UI code
changed in these backend-only repairs. Browser performance was verified on
the preceding batched version; native DWA certification remains unverified.

### Regression status

The full isolated Windows run (243 files) started before the batch change and
completed with 1505 tests: 1499 pass, 5 skips, 1 failure (ECONNRESET in the
existing memory-mvp-vertical-baseline HTTP integration). The 2000-distractor
Recall stress test completed. The failed integration passed three separate
isolated reruns. Its failure mechanism was not reproduced and the test was
not weakened or retried internally. This historical full run is not a green
receipt for the final source.

A fresh 49-file regression, comprising the expanded MCP workflow, graph
tests, recall shadow, quality review, and the MVP baseline, finished with
371 tests: 369 pass, 2 skips, zero failures, exit 0. This run included the
batched read-only and cross-project regression, but preceded the vector-loop
optimization. Subsequent graph-focused regression: 41/41 pass. No native
DWA gate or human quality certification has been asserted. Automatic typed
relation persistence and protected approval remain disabled.
