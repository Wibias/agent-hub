<#
.SYNOPSIS
 Cluster-aware mechanical anti-slop leads for design-with-ai.

.DESCRIPTION
 Compatibility wrapper around taste-gate.mjs. Exit 0 = no mechanically decisive
 P0 hit, exit 1 = mechanically decisive P0 hit, exit 2 = usage/path/config error.
 Contextual style signals are grouped into independent semantic families. A
 REVIEW_CLUSTER verdict is a review lead, not an automatic failure.

.PARAMETER Path
 File or directory to scan.

.PARAMETER Extensions
 File extensions to include when Path is a directory.

.PARAMETER IntentPath
 Optional JSON intent/exception contract. Contextual exceptions require a reason.
 Hard-gate rules cannot be suppressed.

.PARAMETER Json
 Emit JSON summary instead of human output.
#>
[CmdletBinding()]
param(
 [Parameter(Mandatory = $true, Position = 0)]
 [string] $Path,

 [string[]] $Extensions = @(
 '.tsx', '.jsx', '.vue', '.svelte', '.html', '.css', '.scss',
 '.module.css', '.mdx', '.md'
 ),

 [string] $IntentPath,

 [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$engine = Join-Path $PSScriptRoot 'taste-gate.mjs'
if (-not (Test-Path -LiteralPath $engine)) {
 Write-Error "taste-gate engine not found: $engine"
 exit 2
}

$argsList = @($engine, '--path', $Path, '--extensions', ($Extensions -join ','))
if ($IntentPath) { $argsList += @('--intent', $IntentPath) }
if ($Json) { $argsList += '--json' }

& node @argsList
exit $LASTEXITCODE
