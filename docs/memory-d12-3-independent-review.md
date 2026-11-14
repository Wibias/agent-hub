# D12.3 independent implementation review, 2026-11-06

Scope: stacked Draft PRs #187 -> #188 -> #189 -> #190 -> #191 -> #192.
Examined source and synthetic integration tests for capture, review, staging,
confirmation, preflight and finalization.

**Decision: NO-GO for production promotion and schema migration.**

This is a technical code audit by ChatGPT, not an external CodeRabbit,
maintainer or security-team approval. Green CI does not prove correctness
of consent, scope and provenance in a real installed configuration.

## Findings

### P1: Permanent PROJECT rule is only branch-scoped

The user requested a permanent QA rule for the Streamer Content PROJECT.
The implementation records branch_scope=main; the Codex hook, staging,
preflight and finalizer also enforce a single branch. Main-branch Recall
does not make the rule accessible on feature branches. Define reviewed,
nonleaking cross-branch inheritance and consent semantics before calling
the result project-wide. Do not silently broaden scope.

### P1: Exact atomic span audit is not canonical-portable

Canonical export/import preserves the Claim, the new confirmation Evidence
and the original whole-prompt Evidence through primary/supporting links.
It does not export selected atomic fragment refs, offsets/hashes, staging
rows or promotion audit records. Restored canonical data cannot establish
the exact original snippets that justified the new single rule.
A complete SQLite backup is not a substitute for canonical portability.

### P1: New authenticated local user confirmation not yet present

The ChatGPT approval is a conversation-level decision, not a captured
Codex UserPromptSubmit event in the Windows Agent Hub DB. The new hook is
opt-in and not installed. Synthetic Evidence is never production consent.
Verify trusted hook installation and fresh exact in-scope user prompt
capture before staging. The event source must not be arbitrary stdin.

### P1: Unresolved Evidence and relation work

Seven evidence proposals appeared in an older local snapshot. Their
CURRENT status is unknown until the operator inspects their local DB.
Failed records, open Candidates, candidate/stale/conflicted Claims and
active Claims need human review. Zero active Claims is insufficient.

### P2: Independent quality and local rollout evidence are missing

Atomic extraction metrics are hand-authored fixtures, not a
privacy-reviewed representative holdout. No real installed capture,
sidecar migration, multi-process race, WAL-safe backup/restore or
revocation measurement has been provided. Do not treat synthetic CI as
production proof.

## Corrections made during this review

- #191/#192 now count failed Candidates and Proposals as unresolved.
- #191/#192 now block unresolved candidate, conflicted and stale Claims.
- #189 staging requires UserPromptSubmit event identity and exact Codex
  session source reference.
- #190 and #191/#192 revalidate the session source reference.
- #193 adds an independent read-only, anonymized outstanding-proposal
  inventory. Explicit unredacted facts remain local-only.

These changes require successful CI on the latest commits. They are
not a migration or production rollout.

## Required GO conditions

1. Read the live Windows proposal inventory for the exact repository and
   branch, then investigate original supporting Evidence locally.
2. Decide each outstanding proposal with a recorded reason, without
   mass-promoting or automatically ignoring any entry.
3. Resolve whether the intended rule applies to main only or across
   feature branches. Test branch isolation and inheritance.
4. Implement canonical export/import of atomic span provenance and
   WAL-safe backup/restore, with race and revocation tests.
5. Verify real trusted Codex hook capture on disposable data, obtain
   fresh explicit user confirmation and review the transaction.
6. Obtain express operator approval for any actual schema migration or
   production write.

Keep the entire write-capable PR stack in Draft and unmerged until these
conditions are fulfilled.
