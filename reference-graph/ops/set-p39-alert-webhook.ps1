#requires -Version 7.0
param(
    [string]$Path = (Join-Path $env:LOCALAPPDATA 'agent-hub\reference-graph\p39-alert-webhook.dpapi')
)

$ErrorActionPreference = 'Stop'
$secure = Read-Host -AsSecureString 'P39 alert webhook URL'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    $bytes = [Text.Encoding]::UTF8.GetBytes($plain)
    $protected = [Security.Cryptography.ProtectedData]::Protect(
        $bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
    [IO.File]::WriteAllBytes($Path, $protected)
    [Array]::Clear($bytes, 0, $bytes.Length)
    Write-Output ('DPAPI webhook secret written to ' + $Path)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    Remove-Variable secure, plain -ErrorAction SilentlyContinue
    [GC]::Collect()
}
