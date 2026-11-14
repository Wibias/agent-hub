# Evidence-Bound Review intent status (read-only)

Follow-up to #326, #331 and #332. This is a **visibility and fail-closed command** increment, not an authorization pathway.

The Memory Console continues to show every `needs_confirmation` Evidence-Bound proposal, including a proposal for which an intent was staged. If the optional `memory_evidence_bound_review_intents` ledger exists and has an exact same-project/branch row with status `awaiting_independent_host_authorization`, the Review list and inspector display the recorded confirm/reject intent. The UI labels it **not approved**, with `humanApprovalVerified: false` and `claimsModified: false`.

A missing, malformed, or incomplete optional intent ledger never silently removes a proposal from the review backlog. The core Memory Console API remains read-only; it does not install a schema, authenticate the user, promote or reject a proposal, or modify Claims.

Reserved `MEMORY EVIDENCE REVIEW ...` messages are now intercepted by the Codex `UserPromptSubmit` hook even when explicit Memory requests are disabled. They return a fixed block message saying confirm/reject is not enabled. Both malformed and apparently valid messages are blocked; no acceptance, registration or status mutation is exposed. The ordinary memory commands retain their existing behavior.

## Remaining production gate

#326 still needs independently user-authorized decisions, a same-account Windows threat model, final single-transaction compare-and-set confirm/reject and visible final dispositions, plus native Windows x64 proof. `user_direct`, a stored intent and `UserPromptSubmit` by themselves do not prove a human click. #192 is the separate mixed-intent finalizer, still unmerged. G5 and production service activation remain NO-GO.

Nothing in this change modifies the installed Windows hook configuration or the operator's live SQLite database.
