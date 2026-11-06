# D12.3: Read-only canonical promotion preflight (Phase 5)

Stacked on Draft PR #190 -> #189 -> #188 -> #187. Related Issue #186.
This phase is analysis and verification only. No canonical Claim is created.

## Exact scope and provenance

For a previously staged atomic rule, the preflight re-checks the database
using a read-only SQLite connection. It does not trust exported JSON or a
previous approval result.

It verifies:

- explicit staging schema and the requested stage/project/branch
- staged permanent duration, policy version, pending review status
- original direct-user Candidate still pending and unevaluated
- exact original redacted Evidence, normal sensitivity and scoped authority
- each selected original fragment, source offset, hash, and stable review ref
- local draft identity reconstructed using original source order
- NEW, later direct-user Codex user-prompt confirmation Evidence with exact
  scope, full original command, normal sensitivity, explicit metadata
- rule SHA-256 and staging time no earlier than confirmation
- no exact active duplicate Claim in the same project and branch
- no unresolved other Candidates or evidence proposals in the scope

The report is sanitized and reports fixed statuses, numbers and hash-derived
opaque references. It prints no original prompt, canonical rule, filesystem
path, source Evidence ID, confirmation text or model output.

## Results

- blocked: missing/stale/tampered Evidence, staging or schema, or an exact
  duplicate active Claim
- needs_relation_review: there are other active Claims requiring independent
  same/update/contradict/unrelated decisions
- needs_unresolved_memory_review: unresolved Candidates or evidence proposals
  still exist in scope, even if zero active Claims exist
- eligible_for_manual_promotion_review: preliminary structural gates passed,
  but a separate write-capable security-reviewed implementation and final
  human review are still required

Every status returns claimCreated=false and promotionAllowed=false.

## Local command, only after an authentic staged record exists

    node scripts/inspect-memory-atomic-promotion-preflight.mjs --db-path DB_PATH --project-id REPO_ID --branch main --stage-id ATOMIC_STAGE_ID

There is no apply or write flag. No staging table is created automatically,
and the CLI cannot insert or promote anything.

For the operator's existing Streamer Content database, there is currently no
known authenticated new Codex confirmation Evidence or staged row. Do not
invent either. Prior snapshots also reported seven evidence proposals needing
confirmation; if they remain pending in the same scope, they require
independent review before this preflight may indicate simple eligibility.

## Not yet implemented

- transactionally creating a canonical Claim and supporting Claim Evidence
  from the exact confirmed rule
- independently approved relation, conflict and lifecycle transitions
- preserving fragment-level provenance across canonical export/import
- consistency after backup/restore, revocation, concurrent promotion attempts
- a trusted production operator route with explicit approval

These remain fail-closed gates. Do not merge/roll out a write path based on
synthetic fixtures alone.
