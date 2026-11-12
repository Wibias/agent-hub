# Positiver G2-Kernelnachweis auf einem kurzlebigen GitHub-Windows-Runner.
# Niemals auf einem Benutzer-, Produktiv- oder persistenten Windows-Host ausführen.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or
    $env:GITHUB_ACTIONS -cne 'true' -or
    $env:GITHUB_REPOSITORY -cne 'Wibias/agent-hub' -or
    $env:GITHUB_REF -cne 'refs/heads/codex/c9-g3-offline-review') {
    throw 'G2_SERVICE_LAB_REQUIRES_EXPLICIT_EPHEMERAL_GITHUB_RUNNER'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'G2_SERVICE_LAB_REQUIRES_ELEVATED_DISPOSABLE_RUNNER'
}
$sdk = (dotnet --version).Trim()
if ($sdk -cne '10.0.100') { throw "G2_WRONG_SDK $sdk" }

$broker = 'AgentHubEG4528JournalBroker'
$client = 'AgentHubD121417ScratchSvc'
$brokerSid = 'S-1-5-80-1871353128-2073126224-3623205792-890782069-2664301559'
$clientSid = 'S-1-5-80-206086128-3447947495-1842352659-2836494350-1013679070'
$localSid = 'S-1-5-19'
$names = @($broker, $client)

# Bail out without touching an existing service, even on an unexpected runner image.
foreach ($name in $names) {
    if ($null -ne (Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction Stop)) {
        throw "G2_PREEXISTING_SERVICE_DENIED $name"
    }
}
foreach ($pair in @(@($broker, $brokerSid), @($client, $clientSid))) {
    $result = (& sc.exe showsid $pair[0]) -join ' '
    if ($LASTEXITCODE -ne 0 -or -not $result.Contains($pair[1])) {
        throw "G2_FROZEN_SERVICE_SID_NOT_CONFIRMED $($pair[0])"
    }
}

$runId = [Guid]::NewGuid().ToString('N')
$pipe = "c9-g2-two-svc-$runId"
$root = Join-Path $env:ProgramData "AgentHub-C9-G2-Disposable-$runId"
$binary = Join-Path $root 'bin'
$created = [System.Collections.Generic.List[string]]::new()
$cleanupProblems = [System.Collections.Generic.List[string]]::new()

try {
    New-Item -ItemType Directory -Path $binary -Force -ErrorAction Stop | Out-Null
    # Read/write for LocalService only in this GUID-scoped temporary directory.
    # Administrative runner and SYSTEM retain full control for guaranteed cleanup.
    & icacls.exe $root /inheritance:r | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'G2_ACL_INHERITANCE_FAILED' }
    & icacls.exe $root /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'G2_ACL_GRANT_FAILED' }
    & icacls.exe $binary /inheritance:e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'G2_BIN_ACL_FAILED' }

    dotnet publish src/AgentHub.C9.G2.ServiceLab.csproj --configuration Release --output $binary
    if ($LASTEXITCODE -ne 0) { throw 'G2_SERVICE_LAB_BUILD_FAILED' }
    $exe = Join-Path $binary 'AgentHub.C9.G2.ServiceLab.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'G2_SERVICE_HOST_EXE_MISSING' }

    foreach ($pair in @(@($broker, 'broker'), @($client, 'client'))) {
        $name = $pair[0]
        $role = $pair[1]
        $binaryPath = '"' + $exe + '" --isolated-g2-lab ' + $role + ' ' + $pipe + ' "' + $root + '"'
        & sc.exe create $name 'binPath=' $binaryPath 'start=' 'demand' 'type=' 'own' 'obj=' 'NT AUTHORITY\LocalService' 'DisplayName=' "C9 isolated G2 $role review (disposable)"
        if ($LASTEXITCODE -ne 0) { throw "G2_SERVICE_CREATE_FAILED $name" }
        $created.Add($name)
        & sc.exe sidtype $name unrestricted
        if ($LASTEXITCODE -ne 0) { throw "G2_SIDTYPE_CONFIG_FAILED $name" }
        $sidtype = (& sc.exe qsidtype $name) -join ' '
        if ($LASTEXITCODE -ne 0 -or $sidtype -notmatch 'UNRESTRICTED') {
            throw "G2_SIDTYPE_NOT_ENABLED $name"
        }
        $svc = Get-CimInstance Win32_Service -Filter "Name='$name'"
        if ($null -eq $svc -or $svc.StartName -cne 'NT AUTHORITY\LocalService' -or
            $svc.StartMode -cne 'Manual' -or $svc.ServiceType -notmatch 'Own Process') {
            throw "G2_SC_CONFIG_MISMATCH $name"
        }
    }

    & sc.exe start $broker
    if ($LASTEXITCODE -ne 0) { throw 'G2_BROKER_TEST_SERVICE_START_FAILED' }
    & sc.exe start $client
    if ($LASTEXITCODE -ne 0) { throw 'G2_CLIENT_TEST_SERVICE_START_FAILED' }

    $brokerFile = Join-Path $root 'broker.json'
    $clientFile = Join-Path $root 'client.json'
    $deadline = (Get-Date).AddSeconds(35)
    while ((-not (Test-Path -LiteralPath $brokerFile)) -or (-not (Test-Path -LiteralPath $clientFile))) {
        if ((Get-Date) -gt $deadline) {
            $failureFiles = Get-ChildItem -LiteralPath $root -Filter '*.failure' -ErrorAction SilentlyContinue
            foreach ($f in $failureFiles) { Write-Host (Get-Content -LiteralPath $f.FullName -Raw) }
            throw 'G2_TEST_SERVICES_DID_NOT_REPORT'
        }
        Start-Sleep -Milliseconds 300
    }
    $b = Get-Content -LiteralPath $brokerFile -Raw | ConvertFrom-Json -Depth 12
    $c = Get-Content -LiteralPath $clientFile -Raw | ConvertFrom-Json -Depth 12

    if ($b.Role -cne 'broker' -or $c.Role -cne 'client' -or
        $b.ProcessUserSid -cne $localSid -or $c.ProcessUserSid -cne $localSid -or
        $b.ProcessTokenType -ne 1 -or $c.ProcessTokenType -ne 1 -or
        $b.ProcessRestrictedSidCount -ne 0 -or $c.ProcessRestrictedSidCount -ne 0 -or
        $brokerSid -cnotin @($b.ProcessEnabledSids) -or $clientSid -cin @($b.ProcessEnabledSids) -or
        $clientSid -cnotin @($c.ProcessEnabledSids) -or $brokerSid -cin @($c.ProcessEnabledSids) -or
        $b.PipeClientUserSid -cne $localSid -or
        $clientSid -cnotin @($b.PipeClientEnabledSids) -or
        $brokerSid -cin @($b.PipeClientEnabledSids) -or
        $b.PipeClientRestrictedSidCount -ne 0 -or
        $b.PipeClientTokenType -ne 2 -or $b.PipeClientImpersonationLevel -ne 2 -or
        $b.FrameRead -ne $true -or $b.BrokerTokenMatched -ne $true -or
        $b.ClientTokenMatched -ne $true -or $b.ImpersonationReverted -ne $true -or
        $b.G2Positive -ne $true -or $b.CanExecuteCommit -ne $false -or
        $c.ClientTokenMatched -ne $true -or $c.G2Positive -ne $true -or
        $c.CanExecuteCommit -ne $false) {
        throw "G2_REAL_TWO_SERVICE_SID_PROOF_FAILED broker=$($b | ConvertTo-Json -Compress) client=$($c | ConvertTo-Json -Compress)"
    }
    Write-Host 'G2_REAL_WINDOWS_SERVICE_SIDS_POSITIVE_PASS broker=LocalService+BrokerServiceSid client=LocalService+ClientServiceSid'
    Write-Host 'G2_REAL_PIPE_CLIENT_IMPERSONATION_PASS level=2 reverted=true no_cross_role_sid=true'
    Write-Host 'G2_NONEXECUTABLE_RECEIPT_PASS CanExecuteCommit=false G2345=NOT_RUN'
}
finally {
    # Even a failed assertion or interrupted service test must remove only the
    # two services this run itself created. Never touch a pre-existing service.
    [array]::Reverse($names)
    foreach ($name in $names) {
        if (-not $created.Contains($name)) { continue }
        try {
            & sc.exe stop $name 2>&1 | Out-Null
            $stopDeadline = (Get-Date).AddSeconds(12)
            while ((Get-Date) -lt $stopDeadline) {
                $service = Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction SilentlyContinue
                if ($null -eq $service -or $service.State -ceq 'Stopped') { break }
                Start-Sleep -Milliseconds 200
            }
            $service = Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction SilentlyContinue
            if ($null -ne $service -and $service.State -cne 'Stopped') {
                throw "G2_SC_STOP_TIMEOUT $name"
            }
            & sc.exe delete $name | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "G2_SC_DELETE_FAILED $name" }
            $deleteDeadline = (Get-Date).AddSeconds(12)
            while ((Get-Date) -lt $deleteDeadline) {
                if ($null -eq (Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction SilentlyContinue)) { break }
                Start-Sleep -Milliseconds 200
            }
            if ($null -ne (Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction SilentlyContinue)) {
                throw "G2_SC_DELETE_NOT_VERIFIED $name"
            }
        }
        catch { $cleanupProblems.Add($_.Exception.Message) }
    }
    try {
        if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop }
        if (Test-Path -LiteralPath $root) { throw 'G2_TEMP_ROOT_NOT_REMOVED' }
    }
    catch { $cleanupProblems.Add($_.Exception.Message) }
    if ($cleanupProblems.Count -ne 0) { throw "G2_EPHEMERAL_CLEANUP_FAILED $($cleanupProblems -join '; ')" }
    Write-Host 'G2_REAL_SCM_CLEANUP_PASS services=2 files=removed existing_services=untouched'
    Write-Host "G2_TWO_SERVICE_LAB_REVIEW_COMPLETE SHA=$env:GITHUB_SHA G2_HOLD GATES_0_OF_7 PRODUCTION_NO_GO"
}
