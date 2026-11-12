# RC2 exact-assembly two-service security boundary

- Pins seven RC2 and linked RC1 source inputs against exact Git blob hashes from the original reviewed RC2 commit `22ff0fb6e86805b752dda5ab18db5e54f70ef317`; records the new RC2 DLL SHA256 and requires the broker service to report that exact loaded DLL hash from its own process. The earlier CI DLL was not retained, so this does NOT prove byte-for-byte identity with the earlier DLL, only frozen source identity and execution of the newly built actual RC2 route. Reflection is test scaffolding and not a production entrypoint.
- Actual Windows tokens: two separate `LocalService` own-process SCM services, frozen service SIDs, same-thread `ReadFile` / `ImpersonateNamedPipeClient` and `RevertToSelf` performed by the RC2-linked G2 library.
- G3: ephemeral P-256 issuer test key, valid signed ticket and independently supplied test SPKI; no production private key provisioning.
- G5: native FileIdInfo and preimage SHA256 bound to retained handle; no target write.
- G4: exclusive, fsynced, broker-SID-restricted local journal; one reservation, then denial on replay. Not externally rollback-proof.
- Test exit: exact target hash unchanged, one durable entry after service exit; both SCM services removed and temporary directory deleted; failure if cleanup fails.
- Not covered: RC2's actual `--service` path (still permanently disabled), production independent trust, genuine external witness/immutable seal, full rollback protection, installer, production pipe ACL behavior, authorized write commit or G1-G7 release gates.

**G1-G7 HOLD 0/7, Production NO-GO.**
