# Windows Command Map

Use these PowerShell patterns instead of Bash snippets in the upstream pipeline.

## Resolve Roots

```powershell
$ProjectRoot = (Resolve-Path -LiteralPath $RequestedPath).Path
$PluginRoot = (Resolve-Path -LiteralPath (
    Join-Path $env:USERPROFILE '.understand-anything-plugin'
)).Path
$SkillDir = Join-Path $PluginRoot 'skills\understand'
```

## Detect Worktrees

```powershell
$resolver = Join-Path $SkillDir 'scripts\resolve-project-root.ps1'
$ProjectRoot = & pwsh -NoProfile -File $resolver -ProjectRoot $ProjectRoot
if ($LASTEXITCODE -ne 0) { throw 'Project-root resolution failed' }
```

## Create Working Directories

```powershell
$state = Join-Path $ProjectRoot '.understand-anything'
$intermediate = Join-Path $state 'intermediate'
$temp = Join-Path $state 'tmp'
New-Item -ItemType Directory -Path $intermediate,$temp -Force | Out-Null
```

## Run Bundled Scripts

```powershell
$state = Join-Path $ProjectRoot '.understand-anything'
$scanResult = Join-Path $state 'intermediate\scan-result.json'
$importResult = Join-Path $state 'intermediate\import-map.json'
New-Item -ItemType Directory -Path (Split-Path $scanResult -Parent) -Force |
    Out-Null
& node (Join-Path $SkillDir 'scan-project.mjs') $ProjectRoot $scanResult
if ($LASTEXITCODE -ne 0) { throw 'scan-project.mjs failed' }

$scan = Get-Content -Raw -LiteralPath $scanResult | ConvertFrom-Json
$importInput = [ordered]@{
    projectRoot = $ProjectRoot
    files = $scan.files
}
$importInput | ConvertTo-Json -Depth 20 |
    Set-Content -LiteralPath $importResult -Encoding utf8NoBOM
& node (Join-Path $SkillDir 'extract-import-map.mjs') $importResult $importResult
if ($LASTEXITCODE -ne 0) { throw 'extract-import-map.mjs failed' }

$imports = Get-Content -Raw -LiteralPath $importResult | ConvertFrom-Json
$scan | Add-Member -NotePropertyName importMap -NotePropertyValue $imports.importMap -Force
$scan | ConvertTo-Json -Depth 100 |
    Set-Content -LiteralPath $scanResult -Encoding utf8NoBOM

& python (Join-Path $SkillDir 'merge-batch-graphs.py') $ProjectRoot
if ($LASTEXITCODE -ne 0) { throw 'merge-batch-graphs.py failed' }
```

Build dependencies only from the trusted plugin checkout, never from the project
being analyzed:

```powershell
Push-Location $PluginRoot
try {
    corepack pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
    corepack pnpm --filter '@understand-anything/core' build
    if ($LASTEXITCODE -ne 0) { throw 'core build failed' }
} finally {
    Pop-Location
}
```

## Write JSON

Use structured serialization rather than here-strings:

```powershell
$meta = [ordered]@{
    lastAnalyzedAt = [DateTimeOffset]::UtcNow.ToString('o')
    gitCommitHash = $CommitHash
    version = '1.0.0'
    analyzedFiles = $AnalyzedFiles
}
$json = $meta | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText(
    (Join-Path $state 'meta.json'),
    $json,
    [System.Text.UTF8Encoding]::new($false)
)
```

## Safe Cleanup

Move transient output instead of recursively deleting fresh directories:

```powershell
$trash = Join-Path $state (
    '.trash-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
)
New-Item -ItemType Directory -Path $trash -Force | Out-Null
Get-ChildItem -LiteralPath $intermediate -Force |
    Where-Object Name -ne 'scan-result.json' |
    Move-Item -Destination $trash
if (Test-Path -LiteralPath $temp) {
    Move-Item -LiteralPath $temp -Destination $trash
}
```

Never use `2>$null`, Bash command substitution, `realpath`, `readlink`,
`mkdir -p`, `rm -rf`, or raw semicolon chaining in Windows agent shell calls.

---

Source: local Windows adaptation for Egonex-AI/Understand-Anything.
Adapted 2026-07-10.
