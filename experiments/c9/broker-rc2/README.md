# AgentHub C9 Read-only Broker RC2 (.NET 10)

**Review candidate only. Service activation DENIED. G1-G7 = 0/7, Production NO-GO.**

This is a single .NET 10 Windows x64 broker executable that links (rather than forks) the frozen C9 RC1 Win32 named-pipe policy, service names, client SDDL, legacy read-only response, and disabled commit opcodes. It references the existing `g2-kernel-review` which transitively references `g345-review`, `g3-offline`, and `g5-handle-review`. The actual broker's service handler calls `BrokerRc2Route.EvaluateConnected` -> `G2345PipeReview.EvaluateOneRead` -> real G2 process and client token verification -> G3 signed ticket verification -> G5 retained file identity and SHA256 -> G4 exclusive append+flush reservation -> final G5 recheck. No code path can report `CanExecuteCommit=true`.

## Intentional, mandatory limits

- `--service` is blocked by a hardcoded, non-configurable `static readonly false` gate and returns exit code 32, without starting SCM or creating a pipe. No installer is included.
- Production `GetProductionAuthority()` returns `null` unconditionally. The independently controlled current issuer/checkpoint/root bootstrap and a protected production G4 ledger have not been provided. The broker is not provisionable through a client frame, environment variable, or neighboring file.
- The referenced G2345 review gate is additionally hard-guarded to an ephemeral GitHub-hosted Windows runner. This RC2 cannot be deployed by flipping a build flag or variable.
- There is no writer, replacement operation, delete operation, commit handler, backup mutator, production key material, or live Witness. `EnableLabCommit=true` and `EnableWriteCommit=true` fail the build.
- The already completed, separate two-service positive integration test remains the **positive runtime evidence** for G2/G3/G4/G5. This commit only integrates its path in the new broker host, checks its static denial boundaries and builds the .NET 10 executable. It **does not** positively run the new RC2 service under SCM.

## Scope of this verification

Windows Server 2022 GitHub Actions, .NET 10.0.100 exact, `dotnet publish`, `--selftest`, `--service` denial, writer build-switch denial, SHA256 inventory. This does not sign off any security gate. Next verification would be an isolated run of **RC2 itself** under two temporary services and true root/journal provisioning, without enabling production use.
