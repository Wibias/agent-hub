# RC2 exact-assembly two-service security boundary

- Loads the exact, hash-pinned RC2 assembly compiled in previous CI: `d990d989191922f2e10c7acdeb0367f47a1c909fe0f1f8220c14e264de3ef147`. All service tests call its actual internal `BrokerRc2Route.EvaluateConnected` on the broker's native thread. Reflection is test scaffolding and not a production entrypoint.
- Actual Windows tokens: two separate `LocalService` own-process SCM services, frozen service SIDs, same-thread `ReadFile` / `ImpersonateNamedPipeClient` and `RevertToSelf` performed by the RC2-linked G2 library.
- G3: ephemeral P-256 issuer test key, valid signed ticket and independently supplied test SPKI; no production private key provisioning.
- G5: native FileIdInfo and preimage SHA256 bound to retained handle; no target write.
- G4: exclusive, fsynced, broker-SID-restricted local journal; one reservation, then denial on replay. Not externally rollback-proof.
- Test exit: exact target hash unchanged, one durable entry after service exit; both SCM services removed and temporary directory deleted; failure if cleanup fails.
- Not covered: RC2's actual `--service` path (still permanently disabled), production independent trust, genuine external witness/immutable seal, full rollback protection, installer, production pipe ACL behavior, authorized write commit or G1-G7 release gates.

**G1-G7 HOLD 0/7, Production NO-GO.**
