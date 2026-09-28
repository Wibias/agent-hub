# Public interface contracts

Adapted from `addyosmani/agent-skills` `api-and-interface-design` (MIT). `codebase-design` remains the sole discovery owner for interface design; this file is conditional depth for externally consumed interfaces.

## Observable behavior becomes a contract

For a sufficiently used public interface, consumers may depend on more than the documented type surface: ordering, error classification, retry behavior, timing assumptions, field presence, idempotency and even quirks. Treat observable behavior as compatibility surface unless evidence proves it is private or safely changeable.

Before changing a shipped interface, inventory consumers and route breaking evolution through `deprecation-and-migration` when coordinated migration is required.

## Prefer additive evolution

- Add optional fields/capabilities before changing or removing existing ones.
- Keep error shape and classification predictable across the interface family.
- Avoid exposing implementation details that would become accidental commitments.
- Validate **external/untrusted inputs at the owning boundary**. Do not spray redundant validation through already-trusted internal calls merely for ceremony.
- Validate third-party responses before they enter trusted internal logic.

## Error semantics

Define errors as part of the interface:

- machine-readable category/code when callers need branching behavior;
- human-readable message that does not expose internals or secrets;
- stable distinction between authentication, authorization, validation, conflict, not-found, transient/unavailable and internal failure where the protocol supports it;
- retryability semantics when callers may retry.

Do not let sibling endpoints/methods invent incompatible error strategies unless the protocol forces it.

## Idempotent effect contracts

If an interface accepts an idempotency key or promises safe retry, the implementation must honour that promise.

1. **Key represents one intent, not one attempt.** The initiating client/event creates it once and reuses it across retries. Do not generate a new key inside the retry loop.
2. **Claim atomically.** A separate "check then act" is a race. Use a uniqueness/conditional-write mechanism that chooses one winner.
3. **Bind payload/intent.** Reusing the same key for materially different input must fail rather than replaying an unrelated result.
4. **Define in-flight duplicates.** Reject/ask caller to retry, wait with a bound, or return pending/status. Do not execute the effect a second time because the first seems slow.
5. **Model unknown outcome.** A timeout does not prove an external effect failed. Persist enough intent/state to reconcile an uncertain call instead of blindly retrying.
6. **Retention covers the retry horizon.** Keep idempotency records at least as long as any queue, client, webhook or replay path can legitimately redeliver the same intent.
7. **Authorization still applies.** An idempotency record must not leak another tenant/user's prior result.

## Verification

For public interfaces, test the contract through the interface itself:

- valid and invalid boundary inputs;
- error classifications and sensitive-data redaction;
- retries/duplicates, including concurrent duplicates for effectful operations;
- compatibility with at least the material existing consumer shapes;
- ordering/pagination/version behavior where callers observe it;
- migration/deprecation path for intentional breaking changes.
