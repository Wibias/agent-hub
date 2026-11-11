# AgentHub C9 G3 | External trust witness contract V1

**Status:** Owner-directed engineering baseline, documentation only. No independent security sign-off, no provisioned witness, no production key, no deployment. G3 = HOLD; all seven final security gates = HOLD; Production = NO_GO.

**Decision:** Use a **separately administered, off-host, authoritative witness** to return the current trust-manifest revision and canonical SHA-256 hash. A locally protected HKLM key is a cache, never the source of truth. A current signed witness response is evidence of trust-state freshness, not approval to execute a write.

## 1. Scope and assumptions

- Subject: one explicitly registered installation identity within a deployment scope. Never trust an installation ID solely because the caller supplied it.
- Witness authority: a distinct service and security principal outside the Windows broker's administrative and backup/restore domain. Local Administrator, broker service and clients may not sign, advance, or reset witness state.
- Root signer: authorizes trust manifests. Issuer signer: authorizes exact scoped tickets. **Witness signer: authenticates the current checkpoint.** These are three different key roles; no private signing keys are stored on the broker, in GitHub, CI artifacts, or the Windows trust-cache key.
- Owner/provisioner: separately authorized to request a trust-state transition. Broker and ordinary clients have read-only query access, never update access.
- Threat target: rollback or substitution of the local manifest/registry after witness advancement, stale network responses, and concurrent or interrupted trust updates.
- Limit: this design does **not** protect against complete compromise of the witness signing authority, off-host durable history, OS kernel, or a local Administrator who can replace the running verifier/binary. That threat would require a separately approved stronger architecture.
- No availability concession: a disconnected witness never authorizes writes. Read-only diagnostics can continue without treating that as G3 PASS.

## 2. Required trust anchors and state

1. The owner independently pins the witness signing public-key SPKI SHA-256 and authenticated endpoint identity into a separately controlled bootstrap/release channel. They MUST NOT be learned from the same local HKLM key, ticket, manifest, or network response being verified.
2. The owner separately pins the trust-manifest root SPKI SHA-256. The witness signer is not the trust-manifest root or an issuer.
3. The witness maintains one **authoritative head** for each authenticated deployment/installation scope:
   - epoch: positive generation, change only via separate documented owner recovery ceremony;
   - revision: positive, strictly increasing within an epoch;
   - manifest_sha256: lowercase hex SHA-256 of **TrustBootstrap.CanonicalBytes(manifest)**, not of an arbitrary JSON serialization;
   - root_key_id and issuer key identity/pin; signed-manifest validation status;
   - a durable tombstone history for revoked issuer key IDs AND key-SPKI pins.
4. State transitions MUST be atomic and durable *before* a signed successful acknowledgement is issued. A database transaction alone does not prove anti-rollback of the database: the witness head/history also requires an independently retained append-only/WORM audit anchor outside the witness host's rollback domain. Every GetCurrent signature MUST be withheld until the witness has compared its head with that independent anchor; mismatch or unavailable anchor means DENY/UNKNOWN, never a signed stale head.
5. No automatic re-enrollment of a revoked issuer ID or SPKI pin. New keys need new identities/pins; recovering a revoked key requires a separate owner security exception and cannot silently reuse normal rotation.
6. The HKLM Registry64 reader remains a **read-only consumer**. It must reject unexpected registry members, unsafe ACL/owner, missing/invalid external root pin, or missing external checkpoint. A registry ACL does not create an independent checkpoint.

## 3. Wire contract (proposed version 1)

Use UTF-8 JSON with exact, case-sensitive members; reject unknown, duplicate, missing and wrong-typed properties; bound message size (proposed 4096 bytes). Signed data MUST have a fixed, versioned, domain-separated canonicalization defined in implementation and independently reviewed; no signature over arbitrary JSON rendering.

**Query: GetCurrent**

- Authenticated channel: mutually authenticated TLS; pinned witness server identity; client identity authenticated by certificate/identity assertion controlled independently of the self-reported installation ID.
- Input: protocol version, authenticated scope, a fresh 256-bit random challenge_nonce (lowercase 64-hex), and request purpose G3_TRUST_READ. An optional claimed local head is diagnostic only.
- Signed response fields: domain = agenthub-c9-g3-witness-head-v1; version; witness_id; witness_key_id; authenticated deployment/installation scope; epoch; revision; manifest_sha256; root_key_id; challenge_nonce; issued_at_unix; expires_at_unix. DER ECDSA P-256/SHA-256 signature over canonical bytes.
- TTL maximum: **30 seconds**. Consumer rejects an expired response, unreasonable clock disagreement, wrong nonce/scope/key, unexpected epoch, malformed encoding or a late response. Require online challenge/response on restart and at each future authorization boundary; never use a cached response as a write permit.
- Verification: check authenticated TLS channel, independently pinned signing SPKI hash, signature, strictly matched request nonce and identity, freshness, and exact epoch/revision/manifest hash versus the protected local state. TLS alone is not a replacement for the signed scoped response.
- A valid response is only a ProtectedTrustCheckpoint input for the existing offline TrustBootstrap verifier. Neither it nor TrustBootstrap/OfflineAuthorization can return CanExecuteCommit=true.

**Mutation: AdvanceHead** (not implemented)

- Only the authorized external owner/provisioner may call it. Broker and client identities MUST be denied at the authentication/authorization layer.
- Input: scope, stable unique transition_id, expected_epoch, expected_revision and expected_manifest_sha256, proposed next epoch/revision/hash, complete new root-signed manifest, policy reason (enroll/rotate/revoke), and owner approval reference.
- Preconditions: root signature and exact manifest canonical hash valid; authorized owner role; exact compare-and-swap on the previous head; for ordinary updates next_revision = current_revision + 1 within the same epoch; allowed state transition; no reuse of revoked key identity/pin.
- Transaction: validate -> append durable transition/audit event and new head atomically -> durably anchor the new head outside the witness host rollback domain -> sign acknowledgement. If any step lacks proven durability, return UNKNOWN or failure, **never success**.
- Result: signed current-head response plus transition_id and durable commit identifier; duplicate transition_id with identical bytes is idempotent and returns the same authoritative outcome, while different content with the same ID is rejected.
- No API for ordinary remote callers to decrement revision, reset epoch, force a head, erase tombstones, or bypass the independent audit anchor.
- Witness signing-key rotation, root key recovery and epoch change are separate owner-controlled ceremonies; do not silently combine them with an issuer rotation.

## 4. Safe local update and recovery protocol

**Normal transition, fail closed at every step**

1. Owner creates a new root-signed issuer manifest and requests AdvanceHead using exact expected old state.
2. Witness commits the new head and independent immutable audit anchor *before* confirming it.
3. Authorized **separate Windows provisioner** fetches a fresh signed GetCurrent response and validates root signature, manifest and exact scope.
4. Provisioner stages new protected local data, verifies a complete snapshot, and publishes it with a crash-consistent mechanism; reader must remain deny-only during partial staging.
5. Reader re-opens the published data, rechecks owner/DACL/types, obtains a new signed witness response and accepts only exact equality. Only then may the wider G3 authentication path continue.

The current HKLM reader's five-value reads are **not an atomic transaction**. Staging, publish, parent-key ACL checks and crash-safe replacement must be designed and tested before any real provisioner is written. Do not pretend ordinary multi-value SetValue calls are atomic.

**Recovery matrix**

| Observed event | Mandatory behavior |
| --- | --- |
| Crash before remote head commit | Query fresh witness; old head may remain authoritative; never infer success from the request |
| Remote head advanced, local store still old | DENY; provisioner may only repair **forward** to the witnessed head |
| Local staging interrupted or values disagree | DENY; discard incomplete stage only after identifying it; preserve evidence |
| Local store is ahead of witness or different hash at same revision | DENY and incident; no automatic witness advance or local rollback |
| Witness request timeout / duplicate transition | Fresh GetCurrent; deduplicate by transition_id; do not blindly repeat AdvanceHead |
| Witness unavailable, signature invalid, root pin unavailable, time invalid | DENY; no offline grace period or last-known-good write permission |
| Host restart or restored backup image | New nonce and signed GetCurrent required; stale local snapshot must not be trusted |
| Witness datastore restored to an older head | Independent anchored audit head MUST detect this; fail closed and use controlled witness recovery |
| Revocation committed remotely while local still active | DENY for any subsequent check seeing the new head; do not claim in-flight operations are retroactively canceled |
| Witness head data lost, split brain or disputed epoch | Freeze all trust updates and writes; owner incident/recovery procedure, no auto reset to revision 1 |

**Freshness limitation:** A previously issued short-lived checkpoint may have been used just before a revocation. Instantaneous fencing of in-flight commits is NOT established. The future write path needs explicit authorization-boundary and revocation-race semantics before it can be claimed safe.

## 5. Required security evidence before a real G3 pass

- Genuine off-host separation: independently controlled signing private key, client enrollment, server-side owner-role authorization, key custody and operational logs; no common administrator/restore domain with the Windows broker.
- Authenticated on-line GetCurrent with a nonreplayed nonce, expiry and scope, independent witness pin, strict signature format and negative wrong-client/wrong-server behavior.
- Atomic monotonic AdvanceHead, compare-and-swap concurrency, durable audit anchoring and revocation tombstones; safe key/epoch recovery under a documented approval ceremony.
- Deliberately interrupted update/restart and stale Windows image recovery with real witness authority, including denial of stale local HKLM state and correct forward repair.
- Review of parent/child registry ACLs and races, protected staging and publication. Current native HKLM lab established only a **simulated in-process witness**, not this independent authority.
- Independent validation of source/binary identity, real OS client/broker tokens, durable G4 replay controls and G5 target identity remains required for any future Write-Broker release.
- Explicit named security/release approvers and accepted threat boundaries. Owner approval of this design alone is not signed G3 release approval.

## 6. Traceability and decisions

- Existing exact-width checkpoint: ProtectedTrustCheckpoint(Revision, ManifestSha256) in g3-bootstrap, currently supplied by the caller; no authenticated epoch, signed online head or independent origin proof.
- Existing WindowsTrustStore.VerifyReadOnly validates local HKLM registry and an independently *supplied* checkpoint; it does not obtain or advance one.
- Existing g3-native-lab 11/11 tests PASS on Windows Server 2022 uses a simulated **in-process** witness and demonstrates local rollback rejection, not remote trust-state durability.
- No code, keys, network service, provisioner, production trust data or write-broker integration are added by this document.
- **Implementation gate:** next work is one minimal off-host witness proof-of-authority and separate Windows consumer integration, not re-running the existing 23/30/30/11 tests.
- **Open owner decisions:** real external host/operator and key-custody boundary; independent append-only audit anchor; signing-key enrollment ceremony; scope for privileged/admin attackers; in-flight revocation fencing policy. Until resolved, G3 remains HOLD.

**Recorded outcome:** Engineering contract defined for review. G3 HOLD, final security gates 0/7, Production NO_GO.
