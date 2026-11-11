# AgentHub C9 read-only source provenance

**Scope:** Self-managed reconstructed Windows Broker read-only source 0.1.0-rc.1. This is not the historical V3 original. No write-capable runtime is part of this candidate. No service installation or activation is authorized. All seven release gates remain HOLD and Production remains NO-GO.

The seven active build files from the owner-adopted local review snapshot are tracked individually in `src/Broker/`. Their byte hashes and source tree SHA256 are recorded in `source-manifest.json`. Original C8/C9 LabWriter code, host installers, test fixtures and the large research archives are **excluded** from the public source directory. The manifest contains a hash of the historical local source ZIP for provenance but the ZIP is not needed or published for the build.

## Build

- Windows x64, GitHub-hosted Windows runner, .NET SDK **8.0.428** (`global.json` pin). All C# sources checked against exact pinned SHA256 before dotnet.
- Windows workflow runs `build-windows.ps1`, checks the local source files and writes `build-evidence.json` with output DLL/EXE SHA256 and SDK information.
- NuGet sources are disabled via `NuGet.Config`. This `net8.0-windows` build is **historical compatibility evidence only**, as .NET 8 reached end of support November 10, 2026. Migrate and review on supported .NET 10 LTS before production consideration.
- `--selftest` executes without creating a service; an attempted build with `EnableLabCommit=true` must fail.
- Workflow uploads JSON evidence only. **No binaries are uploaded**. Check the completed run on the exact GitHub commit before claiming PASS.

The declared source identity does not by itself prove author origin, code safety, a signed release, reproducible binary hashes across hosts, or G1 clearance.
