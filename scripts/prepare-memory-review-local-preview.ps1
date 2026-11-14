# Copyright OpenAI. AgentHub M2 local operator TEST BUNDLE builder.
# This script MUST run without elevation on the operator's ordinary Windows x64
# desktop. Build/Verify NEVER creates or starts a Windows Service.
[CmdletBinding()]
param(
    [ValidateSet('Prepare','Verify')]
    [string] $Action = 'Verify',
    [Parameter(Mandatory = $true)]
    [string] $PackageDirectory,
    [string] $RepositoryDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$format = 'agenthub-local-memory-operator-preview-package-v1'
$manifestName = 'operator-preview-package.json'

function Assert-Platform {
    if (-not [Environment]::Is64BitOperatingSystem -or
        -not [Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
            [Runtime.InteropServices.OSPlatform]::Windows)) {
        throw 'Windows x64 only'
    }
    if ($Action -eq 'Prepare') {
        $principal = [Security.Principal.WindowsPrincipal]::new(
            [Security.Principal.WindowsIdentity]::GetCurrent())
        if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and
            $env:GITHUB_ACTIONS -ne 'true') {
            throw 'Build the package as your ordinary user; never elevate a checkout build'
        }
    }
}
function Sha256([string] $path) {
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
}
function Require-OrdinaryFile([string] $path) {
    $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    if (-not ($item -is [System.IO.FileInfo]) -or
        (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) -or
        $item.Length -lt 1 -or $item.Length -gt 300MB) {
        throw 'Missing, redirected, empty or oversized package file'
    }
}
function Get-Files([string] $path) {
    $all = @(Get-ChildItem -LiteralPath $path -Force -Recurse -ErrorAction Stop)
    foreach ($item in $all) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'A package may not contain reparse points / symlinks'
        }
    }
    return @($all | Where-Object { $_ -is [System.IO.FileInfo] } |
        Sort-Object FullName)
}
function Verify-Package([string] $path) {
    $manifestPath = Join-Path $path $manifestName
    Require-OrdinaryFile $manifestPath
    $m = (Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 |
        ConvertFrom-Json -ErrorAction Stop)
    if ($m.format -cne $format -or
        $m.commitSha -cnotmatch '^[0-9a-f]{40}$' -or
        $m.claimsEnabled -ne $false -or
        $m.serviceStartType -cne 'demand' -or
        @($m.files).Count -lt 2 -or @($m.files).Count -gt 100) {
        throw 'Package contract invalid; refuses to stage'
    }
    $seen = [Collections.Generic.HashSet[string]]::new(
        [StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $m.files) {
        $relative = [string]$entry.relativePath
        if ($relative -cnotmatch '^(Service|Operator)/[A-Za-z0-9._/-]{1,190}$' -or
            $relative.Contains('..') -or
            $relative.Contains('//') -or
            $entry.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
            -not $seen.Add($relative)) {
            throw 'Unsafe or duplicate package file path'
        }
        $target = Join-Path $path $relative.Replace('/',[IO.Path]::DirectorySeparatorChar)
        Require-OrdinaryFile $target
        if ((Sha256 $target) -cne $entry.sha256) {
            throw 'Package content hash mismatch'
        }
    }
    $actual = @(Get-Files $path)
    if ($actual.Count -ne @($m.files).Count + 1) {
        throw 'Package contains extra or missing files'
    }
    if (-not $seen.Contains('Service/MemoryReviewAuthority.LabService.exe') -or
        -not $seen.Contains('Operator/MemoryReviewAuthority.OperatorUi.exe')) {
        throw 'Windows host or interactive operator executable missing'
    }
    [pscustomobject]@{
        format = $format
        packageManifestSha256 = (Sha256 $manifestPath)
        commitSha = [string]$m.commitSha
        fileCount = @($m.files).Count
        claimsEnabled = $false
        serviceInstalled = $false
    }
}
Assert-Platform
$package = [IO.Path]::GetFullPath($PackageDirectory)
if ($Action -eq 'Verify') {
    (Verify-Package $package) | ConvertTo-Json -Depth 4
    exit 0
}
if (Test-Path -LiteralPath $package) {
    throw 'Prepare requires a NEW package directory. Never overwrite.'
}
$repo = (Resolve-Path -LiteralPath $RepositoryDirectory -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
    throw 'Git checkout required'
}
$dirty = @(& git -C $repo status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) {
    throw 'Git checkout must be clean. Do not build an agent-mutated checkout'
}
$commit = (& git -C $repo rev-parse --verify HEAD).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $commit -cnotmatch '^[0-9a-f]{40}$') {
    throw 'Commit source pin not established'
}
$parent = Split-Path -Parent $package
if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw 'Package parent must exist'
}
New-Item -ItemType Directory -Path $package -ErrorAction Stop | Out-Null
try {
    $projects = @(
        @{ folder='Service'; project='MemoryReviewAuthority.LabService' },
        @{ folder='Operator'; project='MemoryReviewAuthority.OperatorUi' }
    )
    foreach ($build in $projects) {
        $source = Join-Path $repo (
            'memory-engine/authority-host/windows/' + $build.project + '/' +
            $build.project + '.csproj')
        $output = Join-Path $package $build.folder
        & dotnet publish $source --configuration Release --runtime win-x64 `
            --self-contained true -p:PublishSingleFile=true `
            -p:PublishTrimmed=false -warnaserror --output $output
        if ($LASTEXITCODE -ne 0) { throw 'Windows preview publish failed' }
    }
    $entries = @(Get-Files $package | ForEach-Object {
        $relative = [IO.Path]::GetRelativePath($package, $_.FullName).Replace('\','/')
        [ordered]@{ relativePath=$relative; sha256=(Sha256 $_.FullName) }
    })
    $manifest = [ordered]@{
        format = $format; commitSha = $commit
        serviceStartType = 'demand'; claimsEnabled = $false
        files = $entries
    }
    $json = ConvertTo-Json -InputObject $manifest -Depth 10
    [IO.File]::WriteAllText((Join-Path $package $manifestName), $json,
        [Text.UTF8Encoding]::new($false))
    (Verify-Package $package) | ConvertTo-Json -Depth 4
} catch {
    # A partially prepared unsigned package is NEVER an installable bundle.
    if (Test-Path -LiteralPath $package) {
        Remove-Item -LiteralPath $package -Force -Recurse -ErrorAction Stop
    }
    throw
}
