param(
  [switch]$Provider,
  [string]$Model = "",
  [ValidateSet("low", "medium", "high")]
  [string]$ReasoningEffort = "medium"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Invoke-NodeStep {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  Write-Host "==> $Name"
  & node @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

Invoke-NodeStep -Name "Codex host dry-run" -Arguments @(
  ".\scripts\setup-codex-host.mjs"
)

Invoke-NodeStep -Name "Memory doctor" -Arguments @(
  ".\scripts\doctor-memory.mjs"
)

$HooksPath = Join-Path $HOME ".codex\hooks.json"
if (-not (Test-Path -LiteralPath $HooksPath)) {
  throw "Codex hooks file not found: $HooksPath"
}

$Hooks = Get-Content -LiteralPath $HooksPath -Raw | ConvertFrom-Json
$PromptHook = @(
  $Hooks.hooks.UserPromptSubmit |
    ForEach-Object { @($_.hooks) } |
    Where-Object {
      # commandWindows is intentionally an EncodedCommand payload on Windows,
      # so identify the managed hook from its readable cross-platform command
      # and then execute that hook's exact installed commandWindows value.
      $_.command -is [string] -and
      $_.command -match "codex-hook-cli\.mjs" -and
      $_.commandWindows -is [string] -and
      -not [string]::IsNullOrWhiteSpace($_.commandWindows)
    }
) | Select-Object -First 1

if ($null -eq $PromptHook) {
  throw "Managed UserPromptSubmit memory hook with executable commandWindows was not found."
}

$Event = @{
  session_id = "memory-windows-release-smoke"
  cwd = $RepoRoot
  hook_event_name = "UserPromptSubmit"
  turn_id = "health"
  prompt = "memory health"
} | ConvertTo-Json -Compress

Write-Host "==> PowerShell commandWindows dispatch"
$HookOutput = $Event |
  & powershell.exe -NoProfile -NonInteractive -Command $PromptHook.commandWindows

if ($LASTEXITCODE -ne 0) {
  throw "Installed commandWindows hook failed with exit code $LASTEXITCODE"
}
if ([string]::IsNullOrWhiteSpace(($HookOutput -join ""))) {
  throw "Installed commandWindows hook returned no output for memory health."
}

$HookResult = ($HookOutput -join [Environment]::NewLine) | ConvertFrom-Json
if (
  $HookResult.decision -ne "block" -or
  [string]$HookResult.reason -notmatch "Memory health"
) {
  throw "Installed commandWindows hook did not return the expected memory health response."
}

$GoldenArgs = @(
  ".\scripts\run-memory-golden-smoke.mjs",
  "--reasoning-effort",
  $ReasoningEffort
)
if ($Provider) {
  $GoldenArgs += "--provider"
}
if (-not [string]::IsNullOrWhiteSpace($Model)) {
  $GoldenArgs += @("--model", $Model)
}

Invoke-NodeStep -Name "Golden memory E2E smoke" -Arguments $GoldenArgs

Write-Host ""
Write-Host "Automated Windows memory release smoke passed."
Write-Host "Final Desktop check:"
Write-Host "  1. Restart Codex Desktop."
Write-Host "  2. Send: Reply only with OK."
Write-Host "  3. Verify there is no 'Failed UserPromptSubmit' / hook exit code 1 message."
