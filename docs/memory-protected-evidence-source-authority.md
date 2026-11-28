# Protected Evidence source authority blocker (#326 / #338)

Status: BLOCKED, default OFF. Scope reviewed 2026-11-28.
This document does not authorize deployment or change issue acceptance.

## Original contract

[#326](https://github.com/Wibias/agent-hub/issues/326) requires an authenticated
new local Codex decision for an existing exact E~ Evidence-Bound proposal.
[#338](https://github.com/Wibias/agent-hub/issues/338) requires a service-owned
approval/denial/Claim authority ledger and trusted read projection, while
preserving the existing capture flow and user-writable cache.

Neither issue requests a second statement intake, proposal namespace, scope
registry, Claim table or Memory UI. A new standalone operator statement
would be a separate product decision, not a solution to the Codex requirement.

## Verified blocker

CODEX_PRODUCER_AUTHORITY_UNAVAILABLE for the inspected Windows hook and
app-server interfaces. The Codex hook CLI receives ordinary JSON on stdin.
UserPromptSubmit fields, session and turn identifiers, and Git context
correlate events but do not establish human origin against a hostile
same-Windows-user caller. The local classifier and SQLite cache are not
authority boundaries.

Upstream inspected at commit
[065e18b04021008e2e7d504db8dc50275f589f73](https://github.com/openai/codex/commit/065e18b04021008e2e7d504db8dc50275f589f73)
on 2026-11-28; observed local CLI version 0.172.0.

| Interface | Finding |
| --- | --- |
| [UserPromptSubmit schema](https://github.com/openai/codex/blob/065e18b04021008e2e7d504db8dc50275f589f73/codex-rs/hooks/schema/generated/user-prompt-submit.command.input.schema.json) | No authenticated original-human-submission receipt. |
| [TurnStartParams](https://github.com/openai/codex/blob/065e18b04021008e2e7d504db8dc50275f589f73/codex-rs/app-server-protocol/schema/typescript/v2/TurnStartParams.ts) | Client-supplied message identity and trigger are not independent origin proof. |
| [Native verification provider](https://github.com/openai/codex/blob/065e18b04021008e2e7d504db8dc50275f589f73/codex-rs/user-verification/src/lib.rs) | Experimental native implementation selected only on macOS. Other targets use the unsupported provider. |

The inspected source revision is not established as the exact installed
Desktop binary. These findings concern the inspected interfaces, not every
possible future integration. Even a new native UV gesture cannot retroactively
authenticate a historical message.

Related upstream requests were open when checked on 2026-11-28:
[openai/codex#57571](https://github.com/openai/codex/issues/57571) and
[openai/codex#29640](https://github.com/openai/codex/issues/29640).
They are requests, not a shipped capability or delivery commitment.

## Existing behavior to preserve

- Historical E~ source metadata remains unverified; copying, hashing or
  signing a snapshot later cannot authenticate its original human author.
- The native review laboratory can demonstrate new consent for exact displayed
  content, not authenticate earlier Codex input.
- Keep ordinary capture, current Memory DB, existing Review UI and existing
  protected ledger. No production write or private read grant is added.
- The disposable preflight regression verifies that caller-controlled
  authentication flags cannot authorize promotion or create Claims.

## Next decision gate

Before implementation of the missing Codex admission boundary, require an
independently trusted producer and a verifiable binding of exact event, human
origin, scope, freshness and replay protection. A signature made by a service
over arbitrary caller-controlled bytes is not sufficient.

Reuse the existing E~ review protocol and protected owner for exact source,
comparison, decision, atomic transaction and audit. Do not design a parallel
Memory system, add new tables for a separate intake, or expand the UI while
the required producer is unavailable. Existing in-scope gaps (trusted
recipient projection, actual Windows x64 Codex acceptance, rollback and
migration) may be evaluated against the original issue criteria without
relaxing the authority boundary.

Keep #326 and #338 open. Production Memory Write, C9/G5 and #275 activation
remain NO-GO. A distinct manually authored statement workflow requires
separate explicit product-scope approval before further implementation.
