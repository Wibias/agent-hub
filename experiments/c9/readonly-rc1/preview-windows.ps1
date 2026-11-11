# AgentHub Windows Read-Only Preview; no service, named pipe, production key, or write broker.
#Requires -Version 7.0
[CmdletBinding()]
param([string]$RepoRoot = (Get-Location).Path, [switch]$RunCodexCLI)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or [Environment]::Is64BitProcess -ne $true) { throw 'PREVIEW_DENY_WINDOWS_X64_REQUIRED' }
$Root = (Resolve-Path -LiteralPath $RepoRoot).Path
$GraphCommit = '851d868b9e8727af1aca1554bdec3575f6c04063'
& git -C $Root merge-base --is-ancestor $GraphCommit HEAD
if ($LASTEXITCODE -ne 0) { throw 'PREVIEW_DENY_GRAPH_MERGE_MISSING' }
$C9 = Join-Path $Root 'experiments/c9/readonly-rc1'
$Build = Join-Path $C9 'build-windows.ps1'
$Legacy = Join-Path $Root 'knowledge/design-references/scripts/query.mjs'
$Runtime = Join-Path $Root 'knowledge/design-references/scripts/query-runtime.mjs'
foreach ($p in @($Build, $Legacy, $Runtime)) {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw 'PREVIEW_DENY_SOURCE_MISSING' }
}
$Pins = Get-Content -LiteralPath (Join-Path $Root 'reference-graph/p70-production-release-gate.mjs') -Raw
if ($Pins -notmatch '(?s)P70_ENROLLED_PRODUCTION_PINS=Object.freeze\(\{\s*owner:null,\s*reviewer:null,\s*coordinator:null,') {
    throw 'PREVIEW_DENY_PRODUCTION_PINS_ENROLLED'
}
$nodeVersion = (& node --version)
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(22|24)\.') { throw 'PREVIEW_DENY_NODE_22_OR_24_REQUIRED' }
$Head = (& git -C $Root rev-parse HEAD).Trim()
$OldGitHubSha = [Environment]::GetEnvironmentVariable('GITHUB_SHA', 'Process')
try {
    [Environment]::SetEnvironmentVariable('GITHUB_SHA', $Head, 'Process')
    & $Build
    if ($LASTEXITCODE -ne 0) { throw 'PREVIEW_FAILED_C9_BUILD' }
} finally {
    [Environment]::SetEnvironmentVariable('GITHUB_SHA', $OldGitHubSha, 'Process')
}
$BuildReport = Join-Path $C9 'build-evidence.json'
$BuildData = Get-Content -LiteralPath $BuildReport -Raw | ConvertFrom-Json
if ($BuildData.normal_build -ne 'PASS' -or $BuildData.readonly_selftest -ne 'PASS' -or
    $BuildData.production_go -ne $false -or $BuildData.service_started -ne $false) {
    throw 'PREVIEW_DENY_C9_BUILD_REPORT'
}
function Invoke-Query([string]$Script, [string]$Profile) {
    $q = @($Script, '--profile', $Profile, '--surface', 'dashboard',
        '--job', 'design', '--platform', 'web', '--dimensions', 'layout', '--no-record-usage')
    Push-Location $Root
    try {
        $out = (& node @q 2>&1 | Out-String).Trim()
        $rc = $LASTEXITCODE
    } finally { Pop-Location }
    if ($rc -notin @(0, 2)) { throw 'PREVIEW_FAILED_QUERY_EXIT' }
    try { $j = $out | ConvertFrom-Json -Depth 100 }
    catch { throw 'PREVIEW_FAILED_QUERY_JSON' }
    if ($j.profile -cne $Profile -or $null -eq $j.coverageGaps -or $null -eq $j.records) {
        throw 'PREVIEW_FAILED_QUERY_SCHEMA'
    }
    return [pscustomobject]@{ output=$out; exit=$rc; records=@($j.records).Count }
}
$Results = @()
foreach ($Profile in @('standard', 'deep')) {
    $a = Invoke-Query -Script $Legacy -Profile $Profile
    $b = Invoke-Query -Script $Runtime -Profile $Profile
    if ($a.exit -ne $b.exit -or $a.output -cne $b.output) {
        throw ('PREVIEW_FAILED_LEGACY_PARITY_' + $Profile)
    }
    $Results += [ordered]@{ profile=$Profile; result='PASS'; records=$b.records }
}
$CodexStatus = 'NOT_RUN'
if ($RunCodexCLI) {
    if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
        $CodexStatus = 'BLOCKED_NOT_INSTALLED'
    } else {
        $expected = (Get-FileHash -LiteralPath (Join-Path $Root 'AGENTS.md') -Algorithm SHA256).Hash.ToLowerInvariant()
        $outPath = Join-Path ([IO.Path]::GetTempPath()) ('agenthub-codex-' + [guid]::NewGuid().ToString('N') + '.txt')
        $prompt = 'In this repository, read AGENTS.md, independently calculate its SHA256 from the file bytes, and run node knowledge/design-references/scripts/query-runtime.mjs --profile standard --surface dashboard --job design --platform web --dimensions layout --no-record-usage. Only if the command exits 0 or 2 with JSON records and coverageGaps, finish with one line AGENTHUB_PREVIEW_SHA256=<lowercase SHA256>. Otherwise write BLOCKED. Never modify files, start services, or claim an unobserved test.'
        try {
            & codex exec --sandbox read-only --cd $Root --output-last-message $outPath $prompt *> $null
            if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $outPath)) {
                $msg = Get-Content -LiteralPath $outPath -Raw
                $CodexStatus = if ($msg -match ('(?m)^AGENTHUB_PREVIEW_SHA256=' + $expected + '\s*$')) {
                    'REPORTED_PASS_REQUIRES_TRANSCRIPT_REVIEW'
                } else { 'BLOCKED_MARKER_NOT_VERIFIED' }
            } else { $CodexStatus = 'BLOCKED_CODEX_NONZERO' }
        } catch { $CodexStatus = 'BLOCKED_CODEX_EXCEPTION' }
        finally { Remove-Item -LiteralPath $outPath -Force -ErrorAction SilentlyContinue }
    }
}
$Report = [ordered]@{
    schema=1; scope='READ_ONLY_PREVIEW'; source_commit=$Head
    c9_build='PASS'; c9_writes_enabled=$false; c9_service_started=$false
    graph_production_pins='NULL'; standard_deep_legacy_parity=$Results
    codex_cli=$CodexStatus; codex_desktop='NOT_TESTED_MANUAL'
    production_go=$false
}
$Path = Join-Path $C9 'preview-evidence.json'
$Report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding utf8
Write-Host 'AGENTHUB_READONLY_PREVIEW_BUILD_AND_CLI_PARITY_PASS'
Write-Host "PREVIEW_REPORT_SHA256=$((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash)"
Write-Host "CODEX_CLI=$CodexStatus CODEX_DESKTOP=NOT_TESTED PRODUCTION=NO_GO"
