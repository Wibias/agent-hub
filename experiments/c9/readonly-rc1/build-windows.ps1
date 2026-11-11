# Source-only, Windows x64 build attestation. Never starts or installs a service.
#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ManifestPath = Join-Path $Root 'source-manifest.json'
$SourceDir = Join-Path $Root 'src/Broker'
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if (-not $IsWindows -or [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString() -ne 'X64') {
    throw 'C9_BUILD_DENY: WINDOWS_X64_REQUIRED'
}
if ($Manifest.production_go -ne $false -or $Manifest.security_gates_approved -ne 0 -or $Manifest.binary_built -ne $false) {
    throw 'C9_BUILD_DENY: REVIEW_ONLY_MANIFEST_REQUIRED'
}
$Expected = @{}
foreach ($f in $Manifest.source_files) {
    $n = [string] $f.name
    if ($Expected.ContainsKey($n) -or $n -notmatch '^[a-zA-Z0-9_.-]+$') { throw 'C9_BUILD_DENY: UNSAFE_OR_DUPLICATE_MANIFEST_NAME' }
    $Expected[$n] = $f
}
$Actual = @(Get-ChildItem -LiteralPath $SourceDir -File | ForEach-Object { $_.Name })
if ($Actual.Count -ne $Expected.Count) { throw 'C9_BUILD_DENY: UNEXPECTED_SOURCE_FILES' }
foreach ($n in $Actual) {
    if (-not $Expected.ContainsKey($n)) { throw 'C9_BUILD_DENY: UNLISTED_SOURCE_FILE' }
    $file = Get-Item -LiteralPath (Join-Path $SourceDir $n)
    if ($file.Length -ne [long]$Expected[$n].bytes) { throw "C9_BUILD_DENY: BAD_SIZE $n" }
    if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$Expected[$n].sha256) {
        throw "C9_BUILD_DENY: BAD_HASH $n"
    }
}
Push-Location $Root
try { $Version = (& dotnet --version) } finally { Pop-Location }
if ($LASTEXITCODE -ne 0 -or $Version.Trim() -cne [string]$Manifest.build_sdk) {
    throw "C9_BUILD_DENY: SDK_MISMATCH expected=$($Manifest.build_sdk) actual=$Version"
}
$TempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$Work = Join-Path $TempRoot ('agenthub-c9-review-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Work -ErrorAction Stop | Out-Null
$BuildDir = Join-Path $Work 'build'
New-Item -ItemType Directory -Path $BuildDir | Out-Null
$env:DOTNET_NOLOGO='1'; $env:DOTNET_CLI_TELEMETRY_OPTOUT='1'
$env:NUGET_PACKAGES=Join-Path $Work 'nuget'
$Project = Join-Path $SourceDir 'AgentHub.C9.ReadOnlyBroker.csproj'
Push-Location $SourceDir
try {
    & dotnet restore $Project --configfile (Join-Path $Root 'NuGet.Config') --disable-parallel --nologo
    if ($LASTEXITCODE -ne 0) { throw 'C9_BUILD_FAILED: RESTORE' }
    & dotnet build $Project --no-restore --configuration Release --nologo --output $BuildDir -p:EnableLabCommit=false
    if ($LASTEXITCODE -ne 0) { throw 'C9_BUILD_FAILED: BUILD' }
    $Dll = Join-Path $BuildDir 'AgentHub.C9.ReadOnlyBroker.dll'
    if (-not (Test-Path -LiteralPath $Dll)) { throw 'C9_BUILD_FAILED: DLL_NOT_FOUND' }
    & dotnet $Dll --selftest
    if ($LASTEXITCODE -ne 0) { throw 'C9_BUILD_FAILED: SELFTEST' }
    # Deliberate negative compilation; no service start, SCM, pipe, key or write route.
    $BadOutput = Join-Path $Work 'negative'
    & dotnet build $Project --no-restore --configuration Release --nologo --output $BadOutput -p:EnableLabCommit=true
    if ($LASTEXITCODE -eq 0) { throw 'C9_BUILD_FAILED: LAB_WRITER_FLAG_ACCEPTED' }
} finally { Pop-Location }
$files = @(Get-ChildItem -LiteralPath $BuildDir -File | Sort-Object Name | ForEach-Object {
    [ordered]@{name=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
})
$Report = [ordered]@{
    schema = 1
    candidate_version = [string]$Manifest.version
    repository_commit_sha = [string]$env:GITHUB_SHA
    source_archive_sha256 = [string]$Manifest.source_archive_sha256
    source_tree_sha256 = [string]$Manifest.source_tree_sha256
    sdk_version = $Version.Trim()
    os = [Runtime.InteropServices.RuntimeInformation]::OSDescription
    architecture = 'x64'
    target_framework = 'net8.0-windows'
    release_sdk_supported = $false
    normal_build = 'PASS'
    readonly_selftest = 'PASS'
    writer_flag_negative_build = 'PASS (rejected)'
    service_started = $false
    production_go = $false
    files = $files
}
$ReportPath = Join-Path $Root 'build-evidence.json'
($Report | ConvertTo-Json -Depth 6) + "`n" | Set-Content -LiteralPath $ReportPath -Encoding utf8
Write-Host 'C9_WINDOWS_SOURCE_BUILD_PASS'
Write-Host "C9_BUILD_SDK=$($Report.sdk_version)"
Write-Host "C9_BUILD_EVIDENCE_SHA256=$((Get-FileHash -LiteralPath $ReportPath -Algorithm SHA256).Hash.ToLowerInvariant())"
Write-Host 'SERVICE=NOT_STARTED PRODUCTION=NO_GO G1=HOLD'
