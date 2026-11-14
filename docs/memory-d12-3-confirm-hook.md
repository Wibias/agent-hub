# D12.3: Exact user-prompt confirmation capture (Phase 4)

Stacked Draft implementation on Phase 3 staging. The user approved a
permanent Streamer Content QA rule in a ChatGPT conversation. This is not
a captured Codex user-prompt event and cannot create local Agent Hub Evidence.

## Trust boundary

This opt-in capture path recognizes one exact command created by the
atomicRuleConfirmationText function. It must carry the draft reference,
repository project scope, current Git branch, and full reviewed rule.

The capture feature is OFF by default. Both CLI flags must be explicitly
set on a trusted Codex hook installation:

    --explicit-memory-requests --atomic-rule-confirmation-capture

This PR does not modify an installed hook configuration. The command prefix
is reserved even when disabled, so malformed or out-of-scope commands cannot
accidentally enter ordinary candidate capture.

Only a valid UserPromptSubmit event can create source Evidence, through the
existing memory.protocol.v1 capture operation. It supplies no authority_class
field; the protocol derives authority from the event channel. Stored
Evidence must subsequently pass checks for project, branch, session, text,
authority, sensitivity, source type and metadata:

    event_type = user_prompt
    hook_event_name = UserPromptSubmit
    explicit_memory = true
    explicit_memory_mode = atomic_rule_confirm
    atomic_rule_draft_ref = exact draft reference

Repeated same-turn calls validate the existing Evidence without inserting a
second row. Conflicting stored Evidence fails closed. The event is handled as
a command and does not invoke Recall, candidate capture, staging or promotion.

NOTE: This is NOT cryptographic user authentication. The hook depends on the
integrity of the Codex host and its UserPromptSubmit channel. A forged stdin
event injected outside the trusted host cannot be distinguished by parsing
alone. This feature must be opt-in only in a trusted installation.

## No automatic durable Memory

This phase creates NO Claim, staged row, candidate, relation or promotion.
The permanent rule is not stored in the canonical Memory graph. The phase-3
staging API also remains opt-in and separate from this capture-only hook.
A future audited operator action must revalidate stored Evidence before
staging or promotion.

The original ChatGPT user confirmation must not be fabricated or replayed as
a past Codex event. A fresh, intentional command must be submitted by the
user in the trusted Codex session with the exact local draft and in-scope Git
branch.

## Tests

Tests use temporary canonical MemoryEngine databases and actual
memory.protocol.v1 evidence capture with synthetic UserPromptSubmit events.
They verify exact parsing, two-flag opt-in, no Claims or candidate writes,
wrong project/branch, wrong event, conflicting Evidence, idempotent replay and
no Recall calls on this explicit command path.

Do not enable production use or run migration scripts based solely on this
draft. The next stage must independently prove Claim promotion, deduplication,
same/update/conflict handling, lifecycle and canonical export/import.
