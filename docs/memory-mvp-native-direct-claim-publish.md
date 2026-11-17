# Temporary native two-step user-direct Claim publication (Windows x64)

**Default-OFF laboratory feature. NOT installed on the operator PC.
Never a production memory write, and NO Codex memory_recall read grant.**

## Distinct human consent phases

1. **Eigene Aussage vorbereiten** / explicitly reaffirm a precise
   signed service statement with a dedicated check box and native
   Windows Hello UV. The service records only a non-authorizing
   `protected_operator_reaffirmation_intents` row.
2. **Memory-Claim vorbereiten** / independently verify a NEW service
   signature on the same exact fact, project, branch, Git revision,
   E~ reference, snapshot and evidence fingerprints. It can only
   proceed if the reaffirmation is present and younger than 15 minutes.
3. A different check box states that the user wants to write this NEW
   statement into the protected Claim ledger. The historic evidence
   remains unverified. A separate physical Windows Hello `GetAssertion`
   signs `agenthub-evidence-bound-uv-commit-v1` (NEVER the earlier
   reaffirmation or possession challenge).
4. The same admin/SID-only operator pipe accepts `publish_begin`
   and `publish_complete`. The protected store verifies fresh
   native credential, exact pending context, immutable source and
   reaffirmation, unrelated knowledge/preference, nonzero counter
   monotonicity and Claim uniqueness. It writes the private Claim
   and counter in one SQLite transaction.
5. A signed, nonce-bound service receipt reports the exact
   `C~` identifier and `claim_written=true` ONLY for
   `publish_complete`. It additionally requires
   `published_to_codex=false`,
   `original_evidence_verified=false` and
   `human_approval_verified=false`. The latter flag is deliberately
   not upgraded by synthetic CI software-key assertions.

The local UI clearly says a successful Claim is protected but is NOT
yet available in Codex CLI/Desktop. The current public signed read
pipe remains scoped to the `synthetic_disposable_lab` fixture only.
No production Claim read path, write hook, user SQLite migration or
Memory authority publication is enabled.

## CI

Windows SCM CI uses a generated *software* ES256 key to execute
both challenge domains against the real restricted LocalService.
A separate protected SQLite read-only audit requires one
`protected_operator_reaffirmation_intents` and one
`protected_operator_direct_claims` row with exact fact/evidence
links and preserved unverified historical origin. The legacy
`protected_review_claims` table has zero claims for the real
operator scope and `verified_review_intents` remains empty.
The native UI contract tests reject forged origin verification,
unverified signer, mismatched claim IDs, claim writes on other
operations and any assertion of Codex publication.

**Still required:** physical operator-PC Windows Hello for this new
second gesture; a trusted project-/revision-/principal-bound signed
protected direct-Claim read projection and Codex CLI/Desktop acceptance;
rollbacks and independent signoff before any production activation.
