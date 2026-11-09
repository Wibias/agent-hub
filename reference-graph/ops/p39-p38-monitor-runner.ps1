#requires -Version 7.0
param(
    [string]$RepoPath = '',
    [string]$ExpectedBranch = '',
    [string]$ExpectedHead = '',
    [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'agent-hub\reference-graph\p19-soak-hourly-config.json'),
    [string]$StatePath = (Join-Path $env:LOCALAPPDATA 'agent-hub\reference-graph\p39-p38-monitor-state.json'),
    [string]$LogPath = (Join-Path $env:LOCALAPPDATA 'agent-hub\reference-graph\p39-p38-monitor-alerts.jsonl'),
    [string]$RunLogPath = (Join-Path $env:LOCALAPPDATA 'agent-hub\reference-graph\p39-p38-monitor-runs.jsonl'),
    [string]$WebhookSecretPath = (Join-Path $env:LOCALAPPDATA 'agent-hub\reference-graph\p39-alert-webhook.dpapi')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$exitCode = 4
if ([string]::IsNullOrWhiteSpace($RepoPath)) { throw 'RepoPath is required' }
if ([string]::IsNullOrWhiteSpace($ExpectedBranch) -or [string]::IsNullOrWhiteSpace($ExpectedHead)) {
    throw 'ExpectedBranch and ExpectedHead are required'
}

function Write-RunLog([string]$Status, [int]$Code, $Output = $null) {
    New-Item -ItemType Directory -Force -Path (Split-Path $RunLogPath) | Out-Null
    $record = [ordered]@{
        schema_version = 'reference-graph.p39-p38-monitor-run.v1'
        observed_at = [DateTimeOffset]::UtcNow.ToString('o')
        status = $Status
        exit_code = $Code
        output = $Output
    }
    Add-Content -LiteralPath $RunLogPath -Value ($record | ConvertTo-Json -Depth 12 -Compress) -Encoding utf8
}

try {
    if (-not (Test-Path -LiteralPath $RepoPath -PathType Container)) { throw 'repo path missing' }
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw 'publishable config missing' }
    Set-Location -LiteralPath $RepoPath

    $branch = (& git branch --show-current).Trim()
    $head = (& git rev-parse HEAD).Trim()
    $dirty = @(& git status --porcelain)
    if ($branch -ne $ExpectedBranch -or $head -ne $ExpectedHead -or $dirty.Count -ne 0) {
        Write-RunLog 'WATCH_GUARD_FAIL' 3 ([ordered]@{ branch = $branch; head = $head; dirty_count = $dirty.Count })
        $exitCode = 3
        throw 'P39_WATCH_GUARD_FAIL'
    }

    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    Remove-Item Env:SUPABASE_SECRET_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
    $env:SUPABASE_URL = [string]$config.supabase_url
    $env:SUPABASE_PUBLISHABLE_KEY = [string]$config.supabase_publishable_key

    if (Test-Path -LiteralPath $WebhookSecretPath -PathType Leaf) {
        $protected = [IO.File]::ReadAllBytes($WebhookSecretPath)
        $bytes = [Security.Cryptography.ProtectedData]::Unprotect(
            $protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $env:P39_ALERT_WEBHOOK_URL = [Text.Encoding]::UTF8.GetString($bytes)
        [Array]::Clear($bytes, 0, $bytes.Length)
    }

    $text = (& node reference-graph/cli/p39-p38-public-monitor.mjs --state $StatePath --log $LogPath 2>&1 | Out-String).Trim()
    $exitCode = $LASTEXITCODE
    if ([string]::IsNullOrWhiteSpace($text)) {
        Write-RunLog 'MONITOR_OUTPUT_EMPTY' 4 $null
        $exitCode = 4
    } else {
        try {
            $parsed = $text | ConvertFrom-Json
            Write-RunLog 'MONITOR_COMPLETED' $exitCode $parsed
        } catch {
            Write-RunLog 'MONITOR_OUTPUT_INVALID' 4 ([ordered]@{ chars = $text.Length })
            $exitCode = 4
        }
    }
} catch {
    if ($_.Exception.Message -eq 'P39_WATCH_GUARD_FAIL') {
        $exitCode = 3
    } else {
        Write-RunLog 'MONITOR_ERROR' 4 ([ordered]@{ error_type = $_.Exception.GetType().Name })
        $exitCode = 4
    }
} finally {
    Remove-Item Env:SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_SECRET_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:P39_ALERT_WEBHOOK_URL -ErrorAction SilentlyContinue
}

exit $exitCode
