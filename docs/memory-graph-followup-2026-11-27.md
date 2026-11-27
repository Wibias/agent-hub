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
