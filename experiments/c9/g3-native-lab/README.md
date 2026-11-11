# AgentHub C9 G3: native HKLM lab v0.3 (REVIEW ONLY)

A narrow integration check against an **ephemeral GitHub-hosted Windows Server 2022 runner**. This does not install or enable a Broker or another Windows service.

The test refuses execution unless GitHub Actions reports `RUNNER_ENVIRONMENT=github-hosted`, `RUNNER_OS=Windows`, the exact repository, and an explicit lab-only environment variable. It refuses to touch the registry when `HKLM\SOFTWARE\AgentHub` already exists. Otherwise it creates only that fresh branch, marks it with an unpredictable lab marker, provisions a temporary trust leaf with SYSTEM/Administrators full-control ACL, and cleans up only when the marker and tree structure still match. Test key pairs exist only in memory inside the disposable process.

It exercises the existing `WindowsTrustStore.VerifyReadOnly` implementation using real Windows Registry64 handles: correct signed manifest and ACL, missing out-of-band inputs, local revision and hash rollback against a newer supplied witness, surplus value, and widened registry ACL. The existing verifier code and the active read-only broker are not changed.

**Critical limitation:** the `ProtectedTrustCheckpoint` is simulated as an in-process fixture, not obtained from a separately controlled monotonic authority. Its freshness is not independently authenticated. Passing this test is not proof of rollback resistance against privileged attackers or power loss. No actual production trust enrollment, independent issuer custody, or release approval.

**Status:** G3 HOLD, 0/7 security gates, Production NO-GO. Do not run this test on a personal PC or production Windows host.
