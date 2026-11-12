# C9 RC2: exact release assembly in two real Windows service contexts (review only)

**Security state: G1-G7 HOLD (0/7); Production NO-GO.** This is a disposable CI-only integration. No persistent service installation, production credentials, writer, or deployable broker is authorized.

This test reuses the successful G2345 two-service harness but changes the broker process to **load and execute `AgentHub.C9.ReadOnlyBroker.RC2.dll` itself**, via its non-public `BrokerRc2Route.EvaluateConnected` method. Reflection is confined to the test host so the RC2 assembly and its hard-disabled `--service` entrypoint remain **byte-for-byte unchanged**. The test verifies the loaded RC2 DLL SHA256 equals the prior successful exact .NET 10 Windows build:

`d990d989191922f2e10c7acdeb0367f47a1c909fe0f1f8220c14e264de3ef147` (RC2 workflow 43147302504).

On GitHub-hosted `windows-2022`, the runner creates exactly the two frozen own-process `LocalService` services with distinct service SIDs, starts them, uses a transient P-256 signed approval, a real handle-pinned file, a broker-SID-restricted local G4 journal, then invokes the RC2 `EvaluateConnected` on the broker service's own native thread. The test requires first review G2/G3/G5/G4 positive, no commit, second identical request G4 replay denial, only one durable journal entry, unchanged target, and explicit teardown of both services and all temporary files.

This does **not** invoke the disabled RC2 `Program --service` implementation, nor certify a deployable service. The isolated service host is the only SCM-launched program; the actual RC2 DLL is loaded into its broker process. No independent root/issuer trust, WORM/rollback proof, production installer, or write commit exists. Production authority remains `null`.

The workflow must run on the exact review branch and a disposable elevated Windows GitHub runner. Service names are refused if already present. Never run the script on a user computer, persistent VM or production host.
