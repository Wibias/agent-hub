# D12.3 Phase 6: Canonical atomic Claim finalizer (opt-in draft only)

Stacked on PR #191 -> #190 -> #189 -> #188 -> #187. No merge or
production rollout is authorized by this implementation.

## Intended effect

The user already approved one permanent Streamer Content QA rule. That
ChatGPT approval alone still does NOT establish a local authenticated Codex
confirmation Evidence. The actual production Agent Hub database has not
been staged, upgraded or modified.

This phase adds an explicit MemoryEngine method for a previously staged,
independently reviewed, source-grounded atomic rule. It does not create an
entrypoint from the Codex hook, install scripts, or an apply CLI.

To use it in a disposable test fixture only, the caller must explicitly:

1. Install the existing atomic staging sidecar and evidence-proposal ledger.
2. Capture a new direct-user confirmation Evidence via the trusted Codex
   UserPromptSubmit hook and stage it using Phase 3.
3. Install the optional promotion ledger schema explicitly with
   installAtomicClaimPromotionSchema(db), using foreign-key enforcement.
4. Confirm the Phase 5 preflight is eligible, with ZERO other active Claims,
   ZERO other unresolved Candidates and ZERO unresolved evidence proposals.
5. Invoke memory.finalizeStagedAtomicRuleClaim with exact project, branch,
   stage ID, promotion timestamp, and operatorReviewed=true.

The operatorReviewed flag is only an explicit local acknowledgement. It is
NOT identity authentication or additional user_direct evidence. The actual
direct-user approval is proven by original stored confirmation Evidence.

## Atomicity

The method executes BEGIN IMMEDIATE on MemoryEngine's canonical SQLite
connection, runs the full read-only promotion preflight INSIDE that same
transaction, and then writes:

- exactly one active user_direct Claim with only the approved rule text
- PRIMARY claim_evidence link to the new direct-user confirmation Evidence
- SUPPORTING claim_evidence link to the original whole-prompt Evidence
- canonical FTS text index using the same shared helper as assertClaim
- status=ignored on the original, now-consumed mixed-content Candidate
- a one-to-one atomic promotion ledger entry, permanently binding the stage
  to the new canonical Claim

All writes commit together. Any failure or concurrent race rolls back the
Claim, links, FTS entry, candidate status and promotion ledger. The
promotion table is installed separately and never on MemoryEngine startup.
No existing Claims are modified or superseded because nonempty scope fails
the preflight and requires separate, explicitly reviewed relation handling.

Exact replays verify the existing canonical Claim/provenance and return
already_promoted, never creating duplicate Claims. Duplicate rule values
or forged provenance are rejected.

## Canonical portability

Existing canonical export/import contains the Claim plus original and
confirmation Evidence and the primary/supporting provenance links. The
durable rule is therefore portable even if the optional staging and
promotion sidecar tables are not part of canonical export.

Important limitation: the exact selected source-span refs and staging
ledger are NOT transported by canonical export/import. They remain
inspectable in a complete SQLite backup but are not yet canonical audit
data. A future phase must address this gap before broad rollout.

## Scope and refusal behavior

This first implementation supports ONLY an empty, fully reviewed active
Claim scope, and ONLY the original Git branch. It cannot update an
existing Claim or silently propagate a main-branch rule to other branches.
The preflight refuses unresolved other Candidates or evidence proposals,
including the seven unresolved proposals previously seen in the user's
Streamer Content diagnostics.

No production CLI is provided. Running a synthetic test or merging this
draft does not make the operator's local DB ready for mutation.

## Testing and next safety gates

Windows and Linux synthetic integration tests use the actual MemoryEngine
and temporary SQLite databases. They cover Claim creation, dual Evidence
links, original Candidate consumption, exact replay, canonical
export/import, blocked pending work, stale/forged Evidence and full
transaction rollback when the final ledger insertion fails.

Before user DB rollout: independently review code and permissions; verify
backup/restore and concurrency; ensure that the Codex confirmation event
really originates from a trusted user; review the seven pending evidence
proposals; and explicitly authorize production schema installation.
