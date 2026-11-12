# C9 G3: external audit-CAS service security boundary (review V0.1)

**Decision:** Preserve separation among Windows Broker, independent Witness, Anchor, Audit and the ultimate independently administered immutable Seal. This code implements the Audit-facing API and local durability guard. The final Seal authority and real deployment remain deliberately unprovisioned.

## Explicit interfaces

**Inbound** (HTTPS with mutual TLS; no query credentials):

- `POST /v1/current`: request is `AnchorQueryV1(Version=1, Purpose=G3_AUDIT_READ, Scope, ChallengeNonce)`; allowed for configured `reader` or `writer` identity bound to the exact scope. Response is `AnchorReceiptV1` signed with a distinct audit-only certificate using `WitnessProtocol.AnchorCanonical`. Same exact five head fields, nonce and 15-second freshness expected by the existing Anchor client. Refuse if the local journal and independent Seal disagree or are unavailable.
- `POST /v1/advance`: request is `AuditAdvanceWireV1(Version=1, Purpose=G3_AUDIT_CAS, ChallengeNonce, TransitionId, Expected, Proposed, SignedManifestBase64)`. Only configured `writer` role. Caller must already have owner authorization in the Anchor. This API is **not** an arbitrary owner enrollment route. It validates old head == local head == remotely sealed head, `Revision + 1`, root signature and issuer status; remote seal CAS precedes local journal append. On verified success return a signed Audit receipt over the new head. On any remote uncertainty return HTTP 503 and latch DENY.
- **No** genesis/reset/force/epoch-recovery/backup/restore/issuer-minting endpoint.

**Outgoing Seal authority** (HTTPS mutual TLS with independent pinned signing SPKI and server certificate):

- `POST /v1/current`: `SealQueryV1(Version=1,Purpose=G3_SEAL_READ,Scope,ChallengeNonce)`.
- `POST /v1/advance`: `SealCasWireV1(Version=1,Purpose=G3_SEAL_CAS,ChallengeNonce,TransitionId,Expected,Proposed,SignedManifestBase64)`.
- Response: `SealReceiptV1`, a signed full-head receipt using `SealProtocol.Canonical` and domain `agenthub-c9-g3-independent-seal-v1`. It includes scope, epoch, revision, manifest canonical SHA256, root ID, issuer ID/SPKI pin, revoked bit, nonce and a maximum 30-second window. Missing/duplicated/unknown fields, key pin mismatch, wrong scope/nonce or expired signatures are rejected.

The **Seal** MUST implement genuine durable immutable append, transactional compare-and-swap, irrevocable revocation tombstones, independent audit evidence, and fail-closed head recovery. This repository does not implement or prove the Seal. A server that merely returns correctly signed responses without actual durable WORM CAS does NOT satisfy G3.

## Crash and consistency contract

| Failure | Required behavior |
| --- | --- |
| Local journal and Seal agree | A fresh signed current head is possible |
| No external Seal or invalid cert/signature | No signed receipt; HTTP 503 |
| Local journal behind/ahead of Seal | No signed receipt; controlled incident handling |
| CAS conflict before external mutation | Deny, no local mutation |
| Timeout after external CAS begins | State UNKNOWN, no further signed responses |
| Remote CAS commits, local append fails | State UNKNOWN, no further signed responses |
| Process restart with old local head | Fresh full-head check detects mismatch and refuses |
| Torn/corrupt local journal | Startup refusal; never truncate automatically |
| Reused revoked issuer ID or SPKI | Deny; Seal must independently preserve tombstones |
| Power loss between remote and local durability | Cannot claim whole-system atomicity; require controlled forward reconciliation |
| Independent Seal/WORM history rolled back | Only independent immutable object-lock/retention evidence can detect this; not proven here |

## Configuration and custody requirements

- `C9_G3_AUDIT_ENABLE=REVIEW_ONLY` and absolute external `C9_G3_AUDIT_CONFIG_PATH` required before network listener starts. No automatic keys, local genesis or storage created.
- Explicit, pinned machine certificates for HTTPS, audit response signature and outbound Seal mTLS. Trust root P-256 SPKI and Seal P-256 SPKI pins must come from independent owner-controlled channels, not from the signed state.
- Registry/cache and journal file paths must have real OS ACL/reparse/owner checks and be provisioned by a separate trusted installer before operational evaluation. This V0.1 server has no independent path ACL attestation, so production use is categorically barred.
- `reader`/`writer` certificate ACLs must be separately administered. The current Anchor uses one outbound audit certificate; production least-privilege separation is not yet implemented.
- Full durable remote Seal CAS must enforce unique transition IDs, no duplicate-content mismatch, signed manifest authorization and key tombstones as a **separate** authority. An audit client signature cannot substitute for owner approval.
- No independent hardware or off-host WORM infrastructure is connected. Tests simulate external CAS. No release, service install, production signing key or migration is authorized.

## Required next proof (not automatic)

Provision a **disposable, separately controlled** off-host immutable-store backend (for example, object storage with independently enforced retention plus a compare-and-swap control plane) and demonstrate its actual retention settings and denial of overwrite/delete, CAS concurrency, crash restart and stale disk restoration. Verify private key custody and access role boundaries before allowing this service to run outside a review lab. Reuse previous 23/30/30/11/25/17 PASS evidence; rerun only tests affected by a concrete source or infrastructure delta.

**G3 HOLD. 0/7 security gates. Production NO-GO.**
