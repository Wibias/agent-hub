#requires -Version 7.0
param(
    [switch]$Apply,
    [string]$RepoPath = '',
    [string]$ExpectedBranch = 'codex/p39-profile-access-monitoring-20261108',
    [string]$ExpectedHead = '0fb1e28267f5ae7e4e99bcd7d864e2e8d93d8f04',
    [string]$RunnerPath = (Join-Path $env:LOCALAPPDATA 'agent-hub\reference-graph\p39-p38-monitor-runner.ps1'),
    [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'agent-hub\reference-graph\p19-soak-hourly-config.json'),
    [string]$StatePath = (Join-Path $env:LOCALAPPDATA 'agent-hub\reference-graph\p39-p38-monitor-state.json'),
    [string]$LogPath = (Join-Path $env:LOCALAPPDATA 'agent-hub\reference-graph\p39-p38-monitor-alerts.jsonl'),
    [string]$RunLogPath = (Join-Path $env:LOCALAPPDATA 'agent-hub\reference-graph\p39-p38-monitor-runs.jsonl'),
    [string]$WebhookSecretPath = (Join-Path $env:LOCALAPPDATA 'agent-hub\reference-graph\p39-alert-webhook.dpapi')
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($RepoPath)) {
    $RepoPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}
$taskName = 'AgentHub Reference Graph P38 Monitor'
$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
$runnerSource = Join-Path $RepoPath 'reference-graph\ops\p39-p38-monitor-runner.ps1'
$arguments = @(
    '-NoLogo', '-NonInteractive', '-WindowStyle', 'Hidden', '-NoProfile',
    '-ExecutionPolicy', 'Bypass', '-File', ('"' + $RunnerPath + '"'),
    '-RepoPath', ('"' + $RepoPath + '"'),
    '-ExpectedBranch', ('"' + $ExpectedBranch + '"'),
    '-ExpectedHead', ('"' + $ExpectedHead + '"'),
    '-ConfigPath', ('"' + $ConfigPath + '"'),
    '-StatePath', ('"' + $StatePath + '"'),
    '-LogPath', ('"' + $LogPath + '"'),
    '-RunLogPath', ('"' + $RunLogPath + '"'),
    '-WebhookSecretPath', ('"' + $WebhookSecretPath + '"')
) -join ' '

$impact = [ordered]@{
    task_name = $taskName
    cadence = 'every 5 minutes'
    run_as = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    run_level = 'Limited'
    window_style = 'Hidden'
    action = $pwsh + ' ' + $arguments
    reads = 'public freshness view via existing publishable-key config'
    writes = 'local state/log files and optional DPAPI-configured webhook'
    database_changes = $false
    cron_changes = $false
    routing_changes = $false
}

if (-not $Apply) {
    [pscustomobject]$impact | Format-List
    Write-Output 'DRY-RUN ONLY: re-run with -Apply after separate approval.'
    return
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw 'P38 monitor task already exists; audit it instead of replacing it'
}
if (-not (Test-Path -LiteralPath $runnerSource -PathType Leaf)) { throw 'runner source missing' }
New-Item -ItemType Directory -Force -Path (Split-Path $RunnerPath) | Out-Null
Copy-Item -LiteralPath $runnerSource -Destination $RunnerPath -Force

$action = New-ScheduledTaskAction -Execute $pwsh -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(5)) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Description 'Read-only P39 P38 public freshness monitor; no DB/cron/routing changes'
Write-Output ('Registered ' + $taskName)
