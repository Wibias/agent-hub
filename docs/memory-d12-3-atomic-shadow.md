# D12.3: Atomic candidate shadow replay

Status: research / shadow only. This does not change the production capture
policy, evidence, judgments, candidates, claims or confirmation decisions.

Issue #186. Draft PR #187.

## Problem

The current memory hook classifies an entire user prompt and stores one
redacted evidence-backed candidate. The importance judge produces one decision
for that whole text, even when it mixes short-lived tasks and durable guidance.

The experimental preview extracts exact verbatim source fragments with UTF-16
offsets and SHA-256 source/excerpt references. Every suggestion requires review.

- durable_review: explicit future scope, not automatic durable memory
- bounded_review: explicit time or milestone limit
- ambiguous_review: quality feedback with unspecified duration

## Offline synthetic quality evaluation

    node scripts/eval-memory-atomic-shadow.mjs

The report includes only synthetic fixture IDs and aggregate values.
Its precision/recall are computed solely on hand-labeled synthetic review
suggestions. They do NOT estimate real-world memory or model correctness.

## Local file preview

    node scripts/inspect-memory-atomic-shadow.mjs --input-file LOCAL_FILE

By default, the report contains no original text. An explicit
--show-local-content flag exposes individual fragments on the local terminal.
Review them for private information before sharing.

## Read-only scoped Memory database review

    node scripts/inspect-memory-atomic-shadow-db.mjs --db-path MEMORY_DB --project-id REPOSITORY_ID --branch main

The source database opens read-only. This command uses no model, makes no
writes and emits no candidate text, source hashes or offsets. It only scans
unevaluated direct-user candidates in the named project and branch.

## Security and deployment boundary

The conservative splitter can miss valid guidance. It abstains on read-only
audit protocols, code fences, secret-bearing prompts, questions, tentative,
quoted and local-only statements, oversized sources and excessive segmentation.

It cannot authorize persistence. In particular, a word such as always or
future is not proof of durable user intent.

Do not change production capture or bypass the current source-equality
invariant based on this benchmark. Production rollout requires an independently
assessed local holdout, positive and negative quality tests, exact source
attribution, scope inheritance, deduplication, privacy controls, confirmation
and full lifecycle validation in a separate Draft PR.
