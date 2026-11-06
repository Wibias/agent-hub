# D12.3: Read-only unresolved Evidence Proposal inventory

This is an independent, deployable read-only diagnostic, not part of the
write-capable atomic Claim draft PR chain. It is based on the canonical
memory_evidence_proposals and memory_evidence_proposal_evidence tables.

Use it against the operator's actual local Windows Memory database:

    node scripts/inspect-memory-unresolved-proposals.mjs --db-path MEMORY_SQLITE3 --project-id github.com/Wibias/streamer-content --branch main

The database opens read-only. No model calls, inserts, updates, statuses,
Claims or user confirmations are made. The default JSON report contains:

- exact project and branch requested
- counts by pending, needs_confirmation, failed and closed statuses
- up to 100 unresolved proposals as opaque IDs, stable types and statuses
- number of linked Evidence sources; authority and scope integrity signals
- flags showing whether importance/support judgments exist
- available relation and promotion state labels, not freeform text
- truncation flag if there are more unresolved items

No Evidence text, canonical fact, memory Candidate text, IDs, file paths or
timestamps are included by default. Every entry requires manual review.

If YOU need to read the original proposed facts for responsible decisions,
you can explicitly add:

    --show-local-facts

**Do not paste this optional, unredacted output into public issues, CI or
shared chat logs.** This option prints the stored canonical facts only on
your own local terminal. Review any private information before sharing.
The script does not print original Evidence excerpts even with this flag.

## Decision procedure

The inventory is only a queue, not a judgment engine.

- no_linked_evidence, missing_source_evidence, cross_scope_evidence or
  non_normal_sensitivity: hold for provenance/privacy investigation.
- requires_authority_review: validate the source and user authorization.
- requires_manual_meaning_review: read the exact local fact, compare with
  supporting sources and existing current Claims, assess project/branch scope,
  durability, contradiction and correctness.
- failed status: not resolved just because a judge failed; investigate safely
  and do not silently mark ignored.

Do not blindly approve all seven historical proposals or automatically
dismiss them. The earlier count may have changed: this report measures the
currently scoped local database, not an old chat snapshot.

Do not use this tool to alter the status of any proposal or circumvent the
separate memory-candidate confirmation policy. Promoting a new permanent rule
remains blocked until actual source user confirmation, independent relation
review, sidecar portability/backup policy and explicit schema migration
authorization are completed.
