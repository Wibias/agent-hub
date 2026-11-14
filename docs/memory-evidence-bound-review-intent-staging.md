# Evidence-Bound review intent staging (default OFF)

Issue #326. This is a bounded second increment following #331. A staged review intent is **not** an approved decision or an authorization token.

The separate module memory-engine/evidence-bound-review-intent-staging.mjs exports two explicitly called functions: installEvidenceBoundReviewIntentSchema(db) and stageEvidenceBoundReviewIntent(args). Neither is wired into Codex hooks, startup, CLI, MCP, Stop, or the automatic candidate pipeline. Both require an opened writable SQLite connection supplied by a caller. Production installation and usage are not permitted by this commit.

## Invariants

- Exact E~ UI proposal ref, project, branch, 40-character Git revision and 64-character preflight snapshot/fact hashes.
- Exact new Evidence text binds decision (confirm/reject), revision, proposal ref and review snapshot. It must be a later, in-scope Codex user-prompt event, normal sensitivity and user_direct, with distinct source evidence.
- Revalidate current proposal, all relevant citations and all same-scope active Claims in the SAME BEGIN IMMEDIATE SQLite transaction. Recheck the snapshot against the token that was displayed during review.
- Explicit schema installation, strict foreign keys, one unique intent per proposal and one use of each decision Evidence. Exact retry is idempotent, conflicting intent is rejected, and SQL failures roll back.
- A stage stays awaiting_independent_host_authorization. It cannot be used as promotion authority, changes neither original proposal status nor existing Claims, and cannot be interpreted as a user-authorized yes/no by other components.
- Host/user authentication is **not proven** by stored metadata. Same-Windows-account agents may spoof a hook event or modify user-writable SQLite. This increment makes no claim of isolation from those threats.
- Revision authenticity is caller-enforced: the transaction module accepts the supplied revision but does not itself invoke Git. Any future explicit local caller must first verify checkout identity, branch, and HEAD as the read-only CLI in #331 does.

## Remaining product work

1. Implement a genuinely trusted local user-approval ceremony with a documented same-account threat model, or explicitly obtain operator acceptance of the same-account trust boundary. Do not silently interpret an agent-submitted prompt as approval.
2. Capture the exact command from a trusted, user-originated event; reject untrusted agent/tool-originated input and malformed commands.
3. Add independently authenticated, audited confirmation/rejection resolution with full relation review, CAS and rollback. No direct Claim creation on stage alone.
4. Add read-only state and disposition in the unified Memory Review UI.
5. Complete native Windows x64 tests against disposable hook, DB and Git scope. No VM or additional Windows account.
6. No production database migration, hook activation, G5 writer or broker changes without explicit approval.

The original #192 mixed-intent Claim finalizer remains separate and unmerged. Do not treat its operatorReviewed=true parameter as a host attestation.
