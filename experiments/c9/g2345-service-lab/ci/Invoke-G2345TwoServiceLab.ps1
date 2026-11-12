# Positiver G2/G3/G4/G5-Komplettnachweis auf einem kurzlebigen GitHub-Windows-Runner.
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
    throw 'G2345_SERVICE_LAB_REQUIRES_EXPLICIT_EPHEMERAL_GITHUB_RUNNER'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'G2345_SERVICE_LAB_REQUIRES_ELEVATED_DISPOSABLE_RUNNER'
}
$sdk = (dotnet --version).Trim()
if ($sdk -cne '10.0.100') { throw "G2345_WRONG_SDK $sdk" }

$broker = 'AgentHubEG4528JournalBroker'
$client = 'AgentHubD121417ScratchSvc'
$brokerSid = 'S-1-5-80-1871353128-2073126224-3623205792-890782069-2664301559'
$clientSid = 'S-1-5-80-206086128-3447947495-1842352659-2836494350-1013679070'
$localSid = 'S-1-5-19'
$names = @($broker, $client)

# Bail out without touching an existing service, even on an unexpected runner image.
foreach ($name in $names) {
    if ($null -ne (Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction Stop)) {
        throw "G2345_PREEXISTING_SERVICE_DENIED $name"
    }
}
foreach ($pair in @(@($broker, $brokerSid), @($client, $clientSid))) {
    $result = (& sc.exe showsid $pair[0]) -join ' '
    if ($LASTEXITCODE -ne 0 -or -not $result.Contains($pair[1])) {
        throw "G2345_FROZEN_SERVICE_SID_NOT_CONFIRMED $($pair[0])"
    }
}

$runId = [Guid]::NewGuid().ToString('N')
$pipe = "c9-g2345-two-svc-$runId"
$root = Join-Path $env:ProgramData "AgentHub-C9-G2345-Disposable-$runId"
$binary = Join-Path $root 'bin'
$created = [System.Collections.Generic.List[string]]::new()
$cleanupProblems = [System.Collections.Generic.List[string]]::new()

try {
    New-Item -ItemType Directory -Path $binary -Force -ErrorAction Stop | Out-Null
    # Test inputs and code are read-only to LocalService. Only the BROKER
    # service SID may modify its G4 journal; client cannot write the target.
    & icacls.exe $root /inheritance:r | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'G2345_ACL_INHERITANCE_FAILED' }
    & icacls.exe $root /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'G2345_ACL_GRANT_FAILED' }
    & icacls.exe $binary /inheritance:r | Out-Null
    & icacls.exe $binary /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'G2345_BIN_ACL_FAILED' }
    foreach ($role in @('broker', 'client')) {
        $out = Join-Path $root "$role-output"
        New-Item -ItemType Directory -Path $out -Force | Out-Null
        $serviceSid = if ($role -ceq 'broker') { $brokerSid } else { $clientSid }
        & icacls.exe $out /inheritance:r | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "G2345_OUTPUT_ACL_INHERITANCE_FAILED $role" }
        & icacls.exe $out /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*$serviceSid`:(OI)(CI)M" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "G2345_OUTPUT_ROLE_ACL_FAILED $role" }
    }

    dotnet publish src/AgentHub.C9.G2345.ServiceLab.csproj --configuration Release --output $binary
    if ($LASTEXITCODE -ne 0) { throw 'G2345_SERVICE_LAB_BUILD_FAILED' }
    $exe = Join-Path $binary 'AgentHub.C9.G2345.ServiceLab.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'G2345_SERVICE_HOST_EXE_MISSING' }

    & $exe --isolated-g2345-setup $root
    if ($LASTEXITCODE -ne 0) { throw 'G2345_EPHEMERAL_TICKET_SETUP_FAILED' }
    $journalFile = Join-Path $root 'g4.journal'
    & icacls.exe $journalFile /inheritance:r | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'G2345_JOURNAL_ACL_INHERITANCE_FAILED' }
    & icacls.exe $journalFile /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' "*$brokerSid`:M" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'G2345_JOURNAL_BROKER_ONLY_ACL_FAILED' }
    $currentAcl = (Get-Acl -LiteralPath $journalFile).Access
    if (-not ($currentAcl | Where-Object { $_.IdentityReference.Value -eq $brokerSid -and $_.FileSystemRights.ToString() -match 'Modify' })) {
        # Get-Acl may resolve a SID to NT SERVICE\name; icacls was definitive.
        Write-Host 'G2345_JOURNAL_ACL_SET broker_service_sid=only_mutator'
    }

    foreach ($pair in @(@($broker, 'broker'), @($client, 'client'))) {
        $name = $pair[0]
        $role = $pair[1]
        $binaryPath = '"' + $exe + '" --isolated-g2345-lab ' + $role + ' ' + $pipe + ' "' + $root + '"'
        & sc.exe create $name 'binPath=' $binaryPath 'start=' 'demand' 'type=' 'own' 'obj=' 'NT AUTHORITY\LocalService' 'DisplayName=' "C9 isolated G2345 $role review (disposable)"
        if ($LASTEXITCODE -ne 0) { throw "G2345_SERVICE_CREATE_FAILED $name" }
        $created.Add($name)
        & sc.exe sidtype $name unrestricted
        if ($LASTEXITCODE -ne 0) { throw "G2345_SIDTYPE_CONFIG_FAILED $name" }
        $sidtype = (& sc.exe qsidtype $name) -join ' '
        if ($LASTEXITCODE -ne 0 -or $sidtype -notmatch 'UNRESTRICTED') {
            throw "G2345_SIDTYPE_NOT_ENABLED $name"
        }
        $svc = Get-CimInstance Win32_Service -Filter "Name='$name'"
        if ($null -eq $svc -or $svc.StartName -cne 'NT AUTHORITY\LocalService' -or
            $svc.StartMode -cne 'Manual' -or $svc.ServiceType -notmatch 'Own Process') {
            throw "G2345_SC_CONFIG_MISMATCH $name"
        }
    }

    & sc.exe start $broker
    if ($LASTEXITCODE -ne 0) { throw 'G2345_BROKER_TEST_SERVICE_START_FAILED' }
    & sc.exe start $client
    if ($LASTEXITCODE -ne 0) { throw 'G2345_CLIENT_TEST_SERVICE_START_FAILED' }

    $brokerFile = Join-Path $root 'broker-output\broker.json'
    $clientFile = Join-Path $root 'client-output\client.json'
    $deadline = (Get-Date).AddSeconds(35)
    while ((-not (Test-Path -LiteralPath $brokerFile)) -or (-not (Test-Path -LiteralPath $clientFile))) {
        if ((Get-Date) -gt $deadline) {
            $failureFiles = Get-ChildItem -LiteralPath $root -Filter '*.failure' -Recurse -ErrorAction SilentlyContinue
            foreach ($f in $failureFiles) { Write-Host (Get-Content -LiteralPath $f.FullName -Raw) }
            throw 'G2345_TEST_SERVICES_DID_NOT_REPORT'
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
        $b.ServiceTokenMatched -ne $true -or $c.ServiceTokenMatched -ne $true -or
        $b.G2Verified -ne $true -or $b.G3Verified -ne $true -or
        $b.G5Bound -ne $true -or $b.G4Reserved -ne $true -or
        $b.ReplayDenied -ne $true -or $b.TargetUntouched -ne $true -or
        $b.JournalCount -ne 1 -or $b.PositiveReason -cne 'G345_LOCAL_REVIEW_RESERVED_ONLY' -or
        $b.ReplayReason -cne 'G4_REPLAY_DENIED' -or
        $b.CanExecuteCommit -ne $false -or $c.CanExecuteCommit -ne $false -or
        $c.PositiveReason -cne 'SENT_TWICE') {
        throw "G2345_POSITIVE_TWO_SERVICE_CHAIN_DENIED broker=$($b | ConvertTo-Json -Compress) client=$($c | ConvertTo-Json -Compress)"
    }
    # Verify persisted reservation AFTER the broker service has exited/closed
    # its exclusive G4 journal handle. This is independent of receipt flags.
    $deadlineStop = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadlineStop) {
        $notStopped = @($names | ForEach-Object {
            Get-CimInstance Win32_Service -Filter "Name='$_'" -ErrorAction Stop
        } | Where-Object { $_.State -cne 'Stopped' })
        if ($notStopped.Count -eq 0) { break }
        Start-Sleep -Milliseconds 200
    }
    if ($notStopped.Count -ne 0) { throw 'G2345_SERVICES_NOT_STOPPED_AFTER_TEST' }
    $journalLines = @(Get-Content -LiteralPath $journalFile -ErrorAction Stop)
    if ($journalLines.Count -ne 2 -or $journalLines[0] -cne 'agenthub-c9-g4-nonce-journal-v1') {
        throw 'G2345_G4_JOURNAL_NOT_PERSISTED'
    }
    $saved = $journalLines[1] | ConvertFrom-Json -Depth 4
    $ticketFile = Join-Path $root 'ticket.json'
    $ticket = Get-Content -LiteralPath $ticketFile -Raw | ConvertFrom-Json -Depth 8
    $ticketHash = (Get-FileHash -LiteralPath $ticketFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $targetHash = (Get-FileHash -LiteralPath (Join-Path $root 'target.bin') -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($saved.TicketId -cne $ticket.TicketId -or
        $saved.RequestId -cne $ticket.RequestId -or $saved.Nonce -cne $ticket.Nonce -or
        $saved.TicketSha256 -cne $ticketHash -or $saved.PreimageSha256 -cne $ticket.PreimageSha256 -or
        $targetHash -cne $ticket.PreimageSha256 -or $saved.Sequence -ne 1) {
        throw 'G2345_DURABLE_RESERVATION_OR_TARGET_INTEGRITY_DENIED'
    }
    Write-Host 'G2345_REAL_WINDOWS_SERVICE_SIDS_POSITIVE_PASS broker=LocalService+BrokerServiceSid client=LocalService+ClientServiceSid'
    Write-Host 'G2345_FULL_READ_ONLY_POSITIVE_PASS G2=true G3=true G5=true G4=true CanExecuteCommit=false'
    Write-Host 'G2345_REAL_PIPE_REPLAY_DENIED_PASS nonce_consumed_once=true'
    Write-Host 'G2345_DURABLE_JOURNAL_AFTER_EXIT_PASS entries=1 target_unchanged=true'

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
                throw "G2345_SC_STOP_TIMEOUT $name"
            }
            & sc.exe delete $name | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "G2345_SC_DELETE_FAILED $name" }
            $deleteDeadline = (Get-Date).AddSeconds(12)
            while ((Get-Date) -lt $deleteDeadline) {
                if ($null -eq (Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction SilentlyContinue)) { break }
                Start-Sleep -Milliseconds 200
            }
            if ($null -ne (Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction SilentlyContinue)) {
                throw "G2345_SC_DELETE_NOT_VERIFIED $name"
            }
        }
        catch { $cleanupProblems.Add($_.Exception.Message) }
    }
    try {
        if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop }
        if (Test-Path -LiteralPath $root) { throw 'G2345_TEMP_ROOT_NOT_REMOVED' }
    }
    catch { $cleanupProblems.Add($_.Exception.Message) }
    if ($cleanupProblems.Count -ne 0) { throw "G2345_EPHEMERAL_CLEANUP_FAILED $($cleanupProblems -join '; ')" }
    Write-Host 'G2345_REAL_SCM_CLEANUP_PASS services=2 files=removed existing_services=untouched'
    Write-Host "G2345_TWO_SERVICE_LAB_REVIEW_COMPLETE SHA=$env:GITHUB_SHA G2_G3_G4_G5_HOLD GATES_0_OF_7 PRODUCTION_NO_GO"
}
