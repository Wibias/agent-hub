# Windows-native wrapper for @playwright/cli (hub agent stack).
# Usage: pwsh -File playwright_cli.ps1 <playwright-cli args...>
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $CliArgs
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  Write-Error "npx is required but not on PATH. Install Node.js/npm, then retry."
  exit 1
}

$cmd = @('npx', '--yes', '--package', '@playwright/cli', 'playwright-cli')
$hasSession = $false
foreach ($a in $CliArgs) {
  if ($a -eq '--session' -or $a -like '--session=*') { $hasSession = $true; break }
}
if (-not $hasSession -and $env:PLAYWRIGHT_CLI_SESSION) {
  $cmd += @('--session', $env:PLAYWRIGHT_CLI_SESSION)
}
if ($CliArgs) { $cmd += $CliArgs }

& $cmd[0] $cmd[1..($cmd.Length - 1)]
exit $LASTEXITCODE
