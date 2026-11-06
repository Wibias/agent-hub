# D12.3: Evidence-bound atomic review (preview only)

Dependency: Draft PR #187 (read-only atomic shadow matching). This stacked
Draft PR does not modify source capture, candidates, evidence, Claims or
confirmation tables.

## What this adds

A preview-only review protocol for fragments grounded in one stored, scoped,
user-direct Candidate. The validator requires:

- candidate project and branch match the requested scope
- candidate is still pending and has no Importance evaluation
- source Evidence exists, has matching project/branch and direct-user authority
- Evidence sensitivity is normal, not secret-redacted
- the complete Candidate proposed text equals the original Evidence redacted text
- each excerpt has an exact, verifiable source offset and a deterministic
  review reference bound to the source candidate, evidence and source hash

Unverifiable source rows are excluded, not repaired or rewritten.

## Run locally

    node scripts/inspect-memory-atomic-review.mjs --db-path MEMORY_DB --project-id REPO --branch main

Default output includes only opaque Candidate refs and per-fragment review
refs with fixed labels. It does not print private content, source paths,
source hashes or original Evidence IDs.

To examine exact source fragments ON YOUR OWN TERMINAL, explicitly add:

    --show-local-content

Review for private content before copying output elsewhere.

## Preview a human review selection

After obtaining the opaque refs, operators can preview an intent such as:

    node scripts/inspect-memory-atomic-review.mjs --db-path MEMORY_DB --project-id REPO --branch main --candidate-ref CANDIDATE_REF --review-refs REF1,REF2 --intent retain_for_confirmation

Supported intents are retain_for_confirmation, dismiss_preview and defer.
All options are no-write previews. A shell argument is NOT new user-direct
confirmation evidence.

The output deliberately states that no durable rule has been confirmed,
and no Memory Claim has been created. To retain a rule, the user must provide
a NEW explicit project-scoped statement. The eventual write path will need
source-attributed atomic Evidence, direct-user confirmation Evidence and
lifecycle checks in a separate reviewed implementation.

**Never** pass an original mixed-content Candidate through the existing
whole-candidate confirmation command as a substitute. It could promote
unrelated one-off instructions.

## Verification

The tests exercise project/branch mismatch, altered Evidence, secret
redaction, agent-inference exclusion, exact source references, multiple
hints per Candidate, duplicate/ref mismatch rejection and no-write operation.

This preview is not authorization and cannot create durable Memories.

## Human-authored, single-rule draft preview

A reviewer may combine multiple verified hints from ONE original Candidate into
a new, manually written statement in a LOCAL UTF-8 text file. For example,
create a local file named rule-draft.txt with one sentence that accurately
describes the intended project rule. Do not paste the source messages into
GitHub or CI.

The preview accepts exact Candidate and review refs returned by the first
inspection command and opens the SQLite source read-only:

    node scripts/preview-memory-atomic-rule-draft.mjs --db-path MEMORY_DB --project-id REPO --branch main --candidate-ref CANDIDATE_REF --review-refs REF1,REF2 --draft-file LOCAL_DRAFT_FILE

The operator must review the local draft before running the command.
The command reads only the local file, does not print the draft text, and
revalidates Candidate-to-Evidence linkage against the current DB on every run.
It rejects stale, duplicate, cross-scope, tampered, missing or secret-redacted
evidence. It produces one opaque draftRef that changes when the draft text
or its exact selected evidence refs change.

Output is PREVIEW_ONLY. A synthesized statement is not an authoritative quote
from the original user, its semantic equivalence is not mechanically proven,
and a CLI selection is not authenticated user-direct consent. It explicitly
reports zero confirmed durable rules and zero Claims.

To persist a real rule, the user must separately make an explicit direct-user
confirmation of the exact agreed project-scoped wording. An audited future
implementation must capture that NEW confirmation evidence and link it to
the original source spans and review without bypassing the current
one-Candidate source-equality or candidate-confirmation checks.

Never invoke the existing whole-Candidate confirmation command to confirm a
mixed original instruction. That could persist unrelated temporary tasks.
