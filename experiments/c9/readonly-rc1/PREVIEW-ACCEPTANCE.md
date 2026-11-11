# AgentHub Windows Read-Only Preview

**Scope:** Reproducible preview of the pinned C9 read-only source selftest and the real AgentHub Standard/Deep CLI's default-OFF/Legacy behavior. **Not** an installed service, product Memory API or Graph production release.

## Prerequisites

Windows x64, PowerShell 7, Git, Node 22 or 24, .NET SDK 8.0.428. The C9 source/SDK are historical only: .NET 8 is unsupported since 2026-11-10. Do not ship the binary. Use a fresh throwaway clone. Original Codex CLI/Desktop are optional but required to attest an actual agent workflow. No admin/service access is used.

## Local Windows run

~~~powershell
git clone https://github.com/Wibias/agent-hub.git "$HOME\Downloads\AgentHub-ReadOnly-Preview"
Set-Location "$HOME\Downloads\AgentHub-ReadOnly-Preview"
& .\experiments\c9\readonly-rc1\preview-windows.ps1 -RepoRoot (Get-Location).Path -RunCodexCLI
~~~

The PowerShell script requires Graph integration commit 851d868b9e8727af1aca1554bdec3575f6c04063 in the current Git ancestry. It refuses enrolled P70 production trust pins, builds the pinned C9 sources, executes the genuine C9 selftest, requires lab-writer compilation failure and runs Standard and Deep against the actual query-runtime CLI with the no-record-usage argument. The complete JSON stdout and process exit are compared with the original Legacy CLI. Results and build hashes are written locally to experiments/c9/readonly-rc1/preview-evidence.json and build-evidence.json; they must not be committed or described as signed release evidence.

The optional RunCodexCLI flag invokes the **existing original Codex CLI** in read-only sandbox mode, asks it to read AGENTS.md and run the real query CLI, and checks its final claimed AGENTS.md SHA256 against the locally measured file hash. The result REPORTED_PASS_REQUIRES_TRANSCRIPT_REVIEW is **not** independent proof that a model executed the command. To claim actual Codex E2E, inspect the local CLI transcript and observed command/tool run. Missing login/sandbox support results in BLOCKED, never PASS. The script does not persist model transcripts or private tokens into the shared report.

## Original Codex Desktop E2E: Windows operator validation

1. Open the **original Codex Desktop** and add the disposable AgentHub-ReadOnly-Preview checkout as local project. Do not swap in another client.
2. Choose read-only/sandbox mode where supported. If the installation cannot enforce read-only commands, do not execute them.
3. Send this prompt:

> Read AGENTS.md and experiments/c9/readonly-rc1/README.md in this checkout. In the local terminal, execute: node knowledge/design-references/scripts/query-runtime.mjs --profile standard --surface dashboard --job design --platform web --dimensions layout --no-record-usage. Do not write files, install packages, start services, use privileged credentials or change settings. Report the actual command exit code, whether stdout is valid JSON, the records count and whether C9 service activation is disabled. Explicitly distinguish an executed command from an inferred or assumed result.

4. Observe the actual terminal/tool execution in Desktop and compare it with the CLI parity report for this exact Git commit. A model response without tool execution does not count.
5. Only after verifying the GUI session, record CODEX_DESKTOP_E2E=PASS separately with a local screenshot or timestamp and commit SHA. Never include credentials or private conversation contents.

## Acceptance

- Read-only preview source and query parity: PASS only when the pinned C9 build and negative writer compile, Standard/Deep Legacy parity, and null production pins all pass.
- Codex CLI: separate actual execution evidence required. Reported marker is a smoke signal, not a cryptographic attestation.
- Codex Desktop: separate real GUI evidence required; no autonomous Desktop tool access is claimed here.
- Production: NO-GO. C9 G1-G7 remain HOLD; Graph release gates #275 remain open; .NET 8 is unsupported; no Memory read adapter currently connects this inert service-mode C9 source to Codex.

The next functional product increment should be a bounded read-only Memory tool/API adapter with a tested Codex app-server integration. Do not reuse C9's disabled service entry point as a shortcut to Write-Broker.
