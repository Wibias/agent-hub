param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path -LiteralPath $ProjectRoot).Path

if ($env:UNDERSTAND_NO_WORKTREE_REDIRECT -eq '1') {
    $resolved
    exit 0
}

$commonOutput = & git -C $resolved rev-parse --path-format=absolute --git-common-dir 2>&1
$commonExit = $LASTEXITCODE
$gitOutput = & git -C $resolved rev-parse --path-format=absolute --git-dir 2>&1
$gitExit = $LASTEXITCODE

if ($commonExit -ne 0 -or $gitExit -ne 0) {
    $resolved
    exit 0
}

$common = [System.IO.Path]::GetFullPath([string]$commonOutput)
$gitDir = [System.IO.Path]::GetFullPath([string]$gitOutput)
$sameGitDirectory = [string]::Equals(
    $common.TrimEnd('\'),
    $gitDir.TrimEnd('\'),
    [System.StringComparison]::OrdinalIgnoreCase
)

if ($sameGitDirectory) {
    $resolved
    exit 0
}

$mainRoot = Split-Path $common -Parent
if (Test-Path -LiteralPath $mainRoot -PathType Container) {
    (Resolve-Path -LiteralPath $mainRoot).Path
    exit 0
}

$resolved
