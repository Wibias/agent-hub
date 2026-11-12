# Direct Windows 11 x64 user-mode pilot. No administrator, VM, service or Codex config changes.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $IsWindows -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [Runtime.InteropServices.Architecture]::X64) {
    throw 'G5_PILOT_BLOCKED: Windows x64 is required.'
}
$os = Get-CimInstance -ClassName Win32_OperatingSystem
if ([int]$os.ProductType -ne 1 -or [int]$os.BuildNumber -lt 22000) {
    throw 'G5_PILOT_BLOCKED: this direct pilot is for Windows 11 x64 client builds only.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'G5_PILOT_BLOCKED: use a regular, non-elevated PowerShell/Codex session.'
}
if (-not (Get-Command 'dotnet' -ErrorAction SilentlyContinue)) {
    throw 'G5_PILOT_BLOCKED: .NET 10 SDK is missing. No software was installed.'
}
$sdks = @(& dotnet --list-sdks)
if ($LASTEXITCODE -ne 0 -or -not @($sdks | Where-Object { $_ -match '^10\.' }).Count) {
    throw 'G5_PILOT_BLOCKED: .NET 10 SDK is required. No software was installed.'
}
$local = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($local) -or -not [IO.Path]::IsPathFullyQualified($local)) {
    throw 'G5_PILOT_BLOCKED: LocalApplicationData path unavailable.'
}
$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($local))
if ($drive.DriveFormat -ne 'NTFS') {
    throw 'G5_PILOT_BLOCKED: local data volume must be NTFS.'
}

$root = Join-Path $local ("AgentHub-G5-Pilot-" + [guid]::NewGuid().ToString('N'))
$created = $false
function Invoke-G5([string[]]$Arguments) {
    & $script:exe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "G5_PILOT_FAILED: native command $($Arguments[0]) returned $LASTEXITCODE."
    }
}
function Assert-Target([string]$Expected) {
    if ([IO.File]::ReadAllText($script:target) -cne $Expected) {
        throw 'G5_PILOT_FAILED: target content did not match the expected value.'
    }
}
try {
    [IO.Directory]::CreateDirectory($root) | Out-Null
    $created = $true
    # Isolate the generated binary, staging and target from existing project/data paths.
    & icacls.exe $root '/inheritance:r' '/grant:r' "*$($identity.User.Value):(OI)(CI)(F)" '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'G5_PILOT_FAILED: local scratch ACL setup failed.' }
    $src = Join-Path $root 'src'
    $output = Join-Path $root 'out'
    $staging = Join-Path $root 'staging'
    $protected = Join-Path $root 'protected'
    foreach ($path in @($src,$output,$staging,$protected)) {
        [IO.Directory]::CreateDirectory($path) | Out-Null
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Program.cs') -Destination $src
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'G5.HandleRenameLab.csproj') -Destination $src
    & dotnet publish (Join-Path $src 'G5.HandleRenameLab.csproj') --configuration Release --runtime win-x64 --self-contained false --output $output --nologo
    if ($LASTEXITCODE -ne 0) { throw 'G5_PILOT_FAILED: .NET 10 build failed.' }
    $exe = Join-Path $output 'G5.HandleRenameLab.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
        throw 'G5_PILOT_FAILED: native x64 apphost missing.'
    }
    $target = Join-Path $protected 'payload.txt'
    [IO.File]::WriteAllText($target, 'BASE')
    Invoke-G5 @('commit',(Join-Path $staging 'first.tmp'),$protected,'payload.txt','NEW')
    Assert-Target 'NEW'
    Write-Output 'G5_WIN11_USERMODE_HANDLE_COMMIT_PASS'

    $orphan = Join-Path $staging 'uncommitted.tmp'
    Invoke-G5 @('prepare',$orphan,'UNCOMMITTED')
    if (-not (Test-Path -LiteralPath $orphan -PathType Leaf)) {
        throw 'G5_PILOT_FAILED: staged file missing.'
    }
    Assert-Target 'NEW'
    Invoke-G5 @('recover',$orphan)
    if (Test-Path -LiteralPath $orphan) { throw 'G5_PILOT_FAILED: orphan not removed.' }
    Invoke-G5 @('commit',(Join-Path $staging 'retry.tmp'),$protected,'payload.txt','RECOVERED')
    Assert-Target 'RECOVERED'
    Write-Output 'G5_WIN11_USERMODE_RECOVERY_PASS'
    Write-Output 'G5_WIN11_PILOT_2_OF_2_PASS'
    Write-Output 'G5_WIN11_LOCAL_SERVICE_ATTACK=NOT_RUN'
    Write-Output 'CODEX_MCP_WRITE_INTEGRATION=NOT_IMPLEMENTED'
    Write-Output 'G5_WRITE=HOLD PRODUCTION=NO_GO'
}
finally {
    if ($created -and (Test-Path -LiteralPath $root -PathType Container)) {
        $info = Get-Item -LiteralPath $root -Force
        if (($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
            Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop
        }
    }
}
