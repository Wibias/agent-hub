# Protected Evidence source authority decision (#326 / #338)

Status: proposed, default OFF. Reviewed on 2026-11-28 against AgentHub main
5b1625f39bdad2e37d5370773603a08989763150. This is not approval to deploy.

## Finding

The existing Codex hook CLI parses ordinary JSON from stdin. The
UserPromptSubmit metadata, session ID, turn ID and repository identity are
useful for classification and correlation, but cannot authenticate a human
author against a hostile process running as the same Windows user.
The local authority classifier and evidence store are not a security boundary.
The existing preflight deliberately reports hostUserOriginAuthenticated=false.

Upstream references inspected on 2026-11-28:
- https://developers.openai.com/de-DE/docs/hooks
- https://github.com/openai/codex/blob/main/codex-rs/hooks/schema/generated/user-prompt-submit.command.input.schema.json

The inspected command-input contract contains no cryptographic human-origin
proof. This finding is limited to the inspected hook interface; it is not a
claim that no other upstream integration could provide an independent trust
anchor. Verify the exact deployed producer version before accepting a new
protocol.

## Intake routes

| Route | Authority | Allowed consequence |
| --- | --- | --- |
| Existing hook / local SQLite / imported historical snapshot | Unauthenticated historical context | Review candidate only |
| New operator statement through a protected human ceremony | New explicit statement only, after exact signed content and genuine UV | Candidate for separate protected finalization |
| Future independently authenticated Codex producer | Only the exact verified event, after producer enrollment and verification | Candidate for protected finalization |

Do not promote historical evidence by copying, hashing, attesting the build,
signing a snapshot after import, or obtaining a new reaffirmation. Do not
collect every prompt into protected storage by default. A new statement is
not evidence that the historical message was authentic. The native statement
route is a separate product scope and cannot alone satisfy #326's requirement
for authenticated Codex hook input.

## Required producer boundary

For the Codex route, first establish an upstream-supported producer that can
attest a human-origin event independently of same-user agent input. The
producer key and invocation boundary must not be controlled by that agent.
A service signature over arbitrary caller-provided bytes, a same-user DPAPI
key, process ancestry, Windows SID or a bearer token in a writable hook
configuration does not satisfy this condition.

The producer must commit to a versioned domain, producer identity, enrolled
session identity, unique event ID, source kind, event type, exact redacted
content digest, exact project/branch/revision, and a service-issued freshness
challenge or equivalent independently verifiable sequence. The protected host
must derive the principal and enrollment from its own trusted state rather
than accept caller authority flags. Unknown producer, bad signature, replay,
wrong scope, secret-bearing content, missing event binding or unavailable
freshness must refuse protected admission. Ordinary local capture remains
unchanged and explicitly untrusted for this purpose.

Do not define a production signing protocol until the producer's actual
trust boundary is available and reviewed.

## Finalization boundary

Resolve current proposal, complete active Claim set and relationship in
service-owned state, not a fresh read of a mutable local database as if it
were authoritative. Bind the human decision to their complete exact review
snapshot. Under one immediate transaction, recheck source event identity,
scope, lifecycle, active Claim snapshot, target relation, freshness and
one-use consent; append denial or Claim plus durable audit, and consume the
decision atomically. Reject unsupported relation transitions rather than
guessing semantic equivalence. Preserve original IDs without retroactively
authenticating imported history.

A protected-ledger snapshot cannot establish completeness of the legacy
canonical database. Before changing authority ownership, require a separately
reviewed reconciliation and migration policy; no silent replacement of the
existing DB. Protected read release is a separate recipient-authority gate.

## Upstream dependency check (2026-11-28)

**CODEX_PRODUCER_AUTHORITY_UNAVAILABLE** for the inspected Windows hook and
app-server interfaces. The upstream source was resolved to
`065e18b04021008e2e7d504db8dc50275f589f73` and the actual source blobs were
retrieved at that revision. Local CLI version observed: `0.172.0`. This is
not proof that the inspected source revision matches every installed
Desktop component. No live conversation attachment, credential operation,
enrollment or authentication attempt was made.

| Interface | Finding |
| --- | --- |
| [UserPromptSubmit schema](https://github.com/openai/codex/blob/065e18b04021008e2e7d504db8dc50275f589f73/codex-rs/hooks/schema/generated/user-prompt-submit.command.input.schema.json) | JSON prompt, scope/correlation fields and optional agent metadata; no authenticated original-human-submission receipt. |
| [TurnStartParams](https://github.com/openai/codex/blob/065e18b04021008e2e7d504db8dc50275f589f73/codex-rs/app-server-protocol/schema/typescript/v2/TurnStartParams.ts) | Client-supplied message identity and trigger; trigger is ignored for steering. Not an independent origin proof. |
| [Experimental native user verification](https://github.com/openai/codex/blob/065e18b04021008e2e7d504db8dc50275f589f73/codex-rs/user-verification/src/lib.rs) | Native provider selected only for macOS; other targets use the unsupported provider. |
| [Unsupported provider](https://github.com/openai/codex/blob/065e18b04021008e2e7d504db8dc50275f589f73/codex-rs/user-verification/src/unsupported.rs) | Status and verification explicitly report unavailable outside supported platforms. |

The experimental app-server user-verification RPC signs a supplied challenge
after a new native gesture. Even with future Windows support it is not
automatically a receipt for the origin of a previous Codex prompt. It needs
a separate trusted display, enrollment, scope binding, cancellation and
one-use finalization protocol. It is not an available replacement for the
current AgentHub Windows Hello ceremony.

Related upstream issues, checked open on 2026-11-28:
- [openai/codex#57571](https://github.com/openai/codex/issues/57571) requests
  authenticated existing-host attachment, original-message identity,
  origin and lifecycle guarantees. The two retrieved comments are additional
  user requests, not a maintainer commitment or an implementation.
- [openai/codex#29640](https://github.com/openai/codex/issues/29640) requests
  human-only prompt hooks. Classification alone is insufficient against
  arbitrary same-user callers.

Do not open a duplicate issue or claim an upstream delivery date. Track
these dependencies; re-evaluate against a pinned supported implementation
when one is available. The distinct AgentHub protected new-statement path
could still proceed as an explicitly accepted alternative product scope,
not as closure of authenticated Codex hook acceptance.

The disposable preflight CLI regression with forged authentication metadata
passed in the existing 10-test suite. It proves the existing local
preflight continues to deny authority, not that the upstream producer
boundary exists.

## Acceptance order

1. Identify and independently verify a genuine producer boundary; otherwise
   report CODEX_PRODUCER_AUTHORITY_UNAVAILABLE. Do not add a fake positive
   fixture as a substitute.
2. Exercise exact event admission and denial with disposable data, including
   same-user forged stdin, copied event, unknown signer, changed bytes,
   foreign scope and stale/replayed event.
3. Demonstrate protected atomic finalization with changed authoritative
   comparison, competing decisions, rollback and restart; only synthetic
   positive claims until the real producer boundary has been accepted.
4. Verify real Windows x64 Codex CLI and Desktop, protected recipient
   identity, and rollback/revocation policy. Obtain explicit deployment
   approval. Keep production writes and private reads disabled before this.

The immediate implementation dependency is the independent producer, not
another local hashing layer. If no such Codex facility is available, the
operator must choose whether to pursue upstream integration or accept a
distinct protected new-statement product path without claiming the original
Codex acceptance criterion is met.

## Local protected new-statement intake (2026-11-28)

A separate host-only N~ statement namespace and the
`agenthub-new-operator-statement-uv-v1` purpose use the existing bounded,
one-use native UV core. The host generates a 192-bit statement identity,
binds exact fact, kind, project, branch and revision to the digest, and
requires the existing protected native credential. The statement and
credential counter are recorded under one immediate SQLite transaction.
The new STRICT table rejects UPDATE, DELETE and REPLACE of existing rows.
No historical E~ row is modified, authenticated or published. Existing
Claim and private-read routes remain unchanged; this intake creates no Claim.

Local verification on a disposable synthetic fixture: Store 74/74, Core
24/24, service policy 25/25, Windows x64 build zero errors/warnings. Tests
cover missing enrollment, unsupported input, changed kind, separate
namespace, consumed/restarted coordinator, durable exact statement, historical
receipt unchanged, no Claims and rollback on a counter-update failure.
Tests were written after implementation; no test-first RED is claimed.

Scope identifiers are syntactically validated and signed but not resolved
against a trusted current repository. The receipt explicitly does not attest
canonical scope or original Evidence. The table stores the exact new statement
in the protected ledger; it is not an encrypted secret vault. Before any real
intake, add an independently verified protected scope, sensitivity admission
policy, local signed review display and genuine enrollment/UV acceptance.
Enrollment in the tests uses the existing synthetic fixture path, not a new
standalone enrollment ceremony. The additive schema is initialized when the
candidate Store opens; no installed-service upgrade or live database migration
was performed. No IPC or UI operation invokes this coordinator. No production
write/read permission is granted. The next functional slice needs protected
scope enrollment, trusted source display, sensitivity validation and atomic
finalization against the service-owned comparison set, not historical proof
conversion.


## Preview scope pin and sensitivity gate

The N~ intake requires one explicitly host-pinned preview scope. The
host-only pin operation reads a fixed bounded JSON manifest from the
protected directory, validates exact fields, and records its canonical
digest in an immutable scope table. It cannot take a caller-selected
manifest path. Every Begin and the final immediate transaction resolve
that same pin. The N~ statement digest and stored receipt bind the pin.
A durable withdrawal prevents pending completions and future admission
after reopen; no reenrollment or replacement is allowed in this preview.
The host must validate the protected directory and manifest ownership,
ACL and file identity before using this operation. This is a preview
scope authorization, not independently verified Git identity or proof
that the checked-out revision is current.

The native statement parser now refuses recognizable secret patterns
(including named credential assignments, Bearer tokens, common API key
formats, private-key headers and redaction markers) after NFKC
normalization, before issuing a challenge and again in the commit
transaction. It rejects rather than silently redacts signed content.
This bounded heuristic does not guarantee detection of arbitrary secrets,
encoded credentials or other sensitive personal data.

Disposable Store regression reproduced the original acceptance of a
password assignment (RED), and the final Store suite passed 75/75.
Tests cover exact scope, missing pin, foreign project/branch/revision,
conflicting pin, receipt binding, irreversible withdrawal with a pending
challenge, reopen and SQL immutability, and multiple secret formats.
No actual protected manifest was provisioned and no service, UI or IPC
endpoint invokes the new path. Independent canonical repository
resolution, protected enrollment/consent UI, privacy policy, full
comparison and finalization remain outstanding. The preview schema is
local uncommitted development; no migration of deployed state occurred.

## Independent public repository observation

The read-only diagnostic `scripts/observe-public-memory-repository-scope.mjs`
queries the public GitHub REST API directly without local Git configuration,
credentials, redirects or Memory access. It requires an explicit canonical
public repository name, independently known numeric repository ID, branch
and full expected commit SHA. It checks the repository identity before and
after reading the exact branch ref. Changed branch tips are reported as
mismatches; identity changes, malformed or unavailable responses fail closed.

Live diagnostic on 2026-11-28T10:52:04.151Z:
`github.com/wibias/agent-hub`, repository ID `1391571183`, branch `main`,
expected and observed head `af9557b94a8988e8a9a87d3b8a1612bc80986633`.
An independent GitHub connector lookup agreed with the repository ID,
public visibility and main commit. Four focused tests plus ten existing
Evidence preflight tests passed.

The result is an observation of the published branch at query time, not
a signed protected-host receipt. It deliberately returns
canonicalScopeVerified=false, localCheckoutVerified=false and
claimAuthorized=false. Repository IDs provided by an ordinary caller
are not independently authorized pins. The ordinary process, TLS trust
configuration and response handling are not an independently protected
host; no result is admitted to the protected Store as authority.
The remote branch can advance immediately after observation; repeating
the repository check does not make the network read atomic.

For a protected remote-scope implementation, the operator must explicitly
enroll the repository identity and scope in the independently protected
host. Local checkout ownership and freshness remain a different problem:
a remote commit match does not prove the worktree, local configuration or
untracked files reflect that revision. Do not infer canonical local scope
or retroactively authenticate historical Evidence from this diagnostic.
Private repositories, offline scopes and unpublished branches are not
supported by the public observer. No credentials, hooks or service
configuration were changed.


## Protected comparison binding for N~ intake (2026-11-28)

The new statement coordinator reads the complete project/branch comparison
from protected_review_claims and protected_operator_direct_claims in one
ordered SQL query. It binds the scope pin, source type, Claim identity,
request/revision/proposal, snapshot/fact/evidence digests, kind, exact value
and creation timestamp to a versioned comparison digest. The returned
in-process offer contains the comparison, and the statement receipt stores
the digest. Comparison facts are not sent to Codex, an external provider,
or an IPC endpoint.

The final immediate transaction re-reads the comparison, verifies the
offered comparison digest and the signed statement meaning, and rejects a
changed set before storing the receipt or advancing the credential counter.
Normalized duplicates across both source tables are refused. The query
fails closed instead of truncating when the count exceeds 200 rows or
the serialized row budget exceeds 1 MiB. The count/byte boundary cases
have not yet been exercised by a dedicated N~ test.

The disposable Store test suite passed 76/76. The new test creates real
synthetic protected Review and Direct Claims through their respective
coordinators from separate connections, checks both stale-offer denials,
normalized duplicates in both source classes, a shortened offer denial,
unchanged credential counter after each denial, and successful intake
after a foreign-branch change. The tests follow implementation; no RED
was observed for this specific change.

This is an intake comparison, not a final publication approval. It covers
both current protected Claim tables but not legacy user-writable Memory
or a future Claim table. It checks value hashes and allowed kinds, not
independent provenance of every existing Claim. The comparison digest is
durable; full historical membership is not separately archived. Semantic
conflict classification, signed human-readable display, independent scope
verification, a fresh publication-purpose ceremony and transactional
publication revalidation remain open. No real statements or Claims were
written and no production endpoint was enabled.


## Separate synthetic preview publication (2026-11-28)

The new statement publication coordinator is deliberately host-internal
and accepts only the fixed synthetic fixture project
github.com/example/operator-evidence. It is not used by a UI, service IPC,
Codex or normal Memory projection. A real-project publication request is
denied, even when its statement intake receipt is valid.

Publication requires an independent one-use UV challenge in the
agenthub-new-statement-preview-publication-uv-v1 domain. The first receipt
must be present, intact, at most 15 minutes old, and associated with the
native enrolled credential and the same non-withdrawn scope pin. The
second meaning binds the serialized immutable receipt hash, original
scope pin, complete unchanged protected comparison digest and explicit
unrelated relation. The caller's unrelated classification is signed
but is not independently established as semantically correct. No
targeted update, conflict override or automatic semantic classification
is implemented.

Under one immediate SQLite transaction the Store reconstructs the receipt
and publication meaning, checks the scope and freshness, verifies the
comparison and normalized duplicates, checks the credential counter,
and inserts an immutable preview Claim receipt and updates the counter.
The statement and preview Claim link are unique; competing zero-counter
tickets against the same receipt cannot both commit. UPDATE, DELETE and
REPLACE of the publication row are denied. The persisted publication row
is also its successful-operation audit; denied-operation auditing and
full comparison history are not implemented.

The new preview Claim table is included in the complete comparison and
existing cross-provenance duplicate check so a preview publication
invalidates other prepared offers in the same scope. It is deliberately
absent from the existing protected Review/Direct Claim read projections.
The result distinguishes ClaimWritten (synthetic preview only) from
ProductionClaimWritten=false. No actual protected service is upgraded.

Store tests 79/79 passed, including publication-before-intake denial,
distinct-purpose assertions, changed receipt, unrelated-only restriction,
restart/replay, two competing connections with zero counters,
another statement becoming stale after a publication, normalized duplicate,
immutable successful publication, counter failure rollback and retry
with a new gesture, and non-fixture scope denial. The tests used disposable
synthetic credentials and were added after implementation; no RED is claimed
for this publication change. Actual freshness/withdrawal at publication
and comparison limit boundaries still need specific tests; the shared
freshness and scope checks are re-used. Real canonical checkout authority,
trusted human display, independent semantic review and production consent
remain blockers, not optional hardening.
