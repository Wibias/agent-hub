# Windows hosted GitHub Actions ONLY. Never run on an operator's PC.
# Creates a disposable, non-networked LocalService host and always removes it.
param(
    [Parameter(Mandatory = $true)]
    [string]$PublishedExe,
    [Parameter(Mandatory = $true)]
    [string]$AccessProbeExe,
    [switch]$NativeEnrollmentMode
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..\..')).Path
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or
    [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
    throw 'SCM lab is permitted only on an ephemeral Windows GitHub runner'
}
$service = 'AgentHubMemoryReviewLab'
$sc = Join-Path $env:WINDIR 'System32\sc.exe'
$exe = (Resolve-Path -LiteralPath $PublishedExe).Path
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'published exe missing' }
& $sc query $service 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { throw 'service already exists: refuse to touch it' }

$stateRoot = Join-Path $env:ProgramData 'AgentHubMemoryReviewLab-State'
$publicRoot = Join-Path $env:ProgramData 'AgentHubMemoryReviewLab-Public'
if ((Test-Path -LiteralPath $stateRoot) -or
    (Test-Path -LiteralPath $publicRoot)) {
    throw 'preexisting lab state or admin-public-key directory: refuse to touch it'
}
$root = Join-Path $env:ProgramData ("AgentHubMemoryReviewLab-" + [guid]::NewGuid().ToString('N'))
$labGitRoot = Join-Path $env:RUNNER_TEMP ("AgentHubProtectedReadRepo-" + [guid]::NewGuid().ToString('N'))
$target = Join-Path $root 'MemoryReviewAuthority.LabService.exe'
$created = $false
try {
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $dirAcl = Get-Acl -LiteralPath $root
    $dirAcl.SetAccessRuleProtection($true, $false)
    $dirAcl.Access | ForEach-Object { [void]$dirAcl.RemoveAccessRuleSpecific($_) }
    $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $propagate = [System.Security.AccessControl.PropagationFlags]::None
    $allow = [System.Security.AccessControl.AccessControlType]::Allow
    $rules = @(
        @('S-1-5-18', [System.Security.AccessControl.FileSystemRights]::FullControl),
        @('S-1-5-32-544', [System.Security.AccessControl.FileSystemRights]::FullControl),
        @('S-1-5-19', [System.Security.AccessControl.FileSystemRights]::ReadAndExecute)
    )
    foreach ($item in $rules) {
        $sid = [System.Security.Principal.SecurityIdentifier]::new($item[0])
        $ace = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid, $item[1], $inherit, $propagate, $allow)
        $dirAcl.AddAccessRule($ace)
    }
    Set-Acl -LiteralPath $root -AclObject $dirAcl
    # SQLitePCLRaw publishes a native e_sqlite3.dll alongside the single
    # managed service EXE. Copy the *complete* publish output to the protected
    # directory; a lone EXE cannot load the native provider.
    $publishedDirectory = Split-Path -Parent $exe
    foreach ($publishedItem in @(Get-ChildItem -LiteralPath $publishedDirectory -Force)) {
        Copy-Item -LiteralPath $publishedItem.FullName -Destination (
            Join-Path $root $publishedItem.Name) -Recurse -Force
    }
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
        throw 'published service EXE not staged'
    }
    if (-not @(Get-ChildItem -LiteralPath $root -Filter 'e_sqlite3.dll' -File -Recurse).Count) {
        throw 'native SQLite library missing from protected publish output'
    }

    # Ordinary logged-in users must not get write access to the executable.
    $actual = Get-Acl -LiteralPath $root
    if (-not $actual.AreAccessRulesProtected) { throw 'lab directory inherits untrusted ACLs' }
    foreach ($ace in $actual.Access) {
        $sid = $ace.IdentityReference.Translate(
            [System.Security.Principal.SecurityIdentifier]).Value
        if ($sid -notin @('S-1-5-18','S-1-5-32-544','S-1-5-19')) {
            throw 'unexpected directory ACE'
        }
        if ($sid -eq 'S-1-5-19' -and
            (($ace.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::WriteData) -ne 0)) {
            throw 'LocalService must not write to the executable directory'
        }
    }

    # sc.exe requires a space after each option's '='. Use separate native
    # argv elements; the ProgramData GUID path contains no spaces.
    # Directories alone are insufficient. Audit every staged DLL/EXE and
    # nested directory; inherited or copied file ACEs must not grant ordinary
    # same-account users access or allow LocalService to modify binaries.
    foreach ($item in @(Get-ChildItem -LiteralPath $root -Recurse -Force)) {
        $fileAcl = Get-Acl -LiteralPath $item.FullName
        foreach ($ace in $fileAcl.Access) {
            $sid = $ace.IdentityReference.Translate(
                [System.Security.Principal.SecurityIdentifier]).Value
            if ($sid -notin @('S-1-5-18','S-1-5-32-544','S-1-5-19')) {
                throw 'unexpected DLL, EXE or directory ACL'
            }
            if ($sid -eq 'S-1-5-19' -and
                (($ace.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::WriteData) -ne 0)) {
                throw 'LocalService must not modify the executable or native DLL'
            }
        }
    }

    & $sc create $service binPath= $target start= demand obj= 'NT AUTHORITY\LocalService' type= own
    if ($LASTEXITCODE -ne 0) { throw 'could not create disposable service' }
    $created = $true
    & $sc sidtype $service restricted
    if ($LASTEXITCODE -ne 0) { throw 'restricted service SID configuration failed' }
    $sidInfo = & $sc qsidtype $service
    if ($LASTEXITCODE -ne 0 -or (($sidInfo -join ' ') -notmatch 'RESTRICTED')) {
        throw 'SCM restricted service SID not observed'
    }
    $config = & $sc qc $service
    if ($LASTEXITCODE -ne 0 -or (($config -join ' ') -notmatch 'LocalService')) {
        throw 'wrong SCM service identity'
    }

    # The test's persistent-state boundary is protected by its OWN
    # service SID. Do not grant the broad LocalService SID on this directory.
    $serviceSid = [System.Security.Principal.NTAccount]::new(
        'NT SERVICE', $service).Translate([System.Security.Principal.SecurityIdentifier])
    if (-not $serviceSid.Value.StartsWith('S-1-5-80-')) {
        throw 'invalid service-specific SID'
    }
    New-Item -ItemType Directory -Path $stateRoot | Out-Null
    $stateAcl = Get-Acl -LiteralPath $stateRoot
    $stateAcl.SetAccessRuleProtection($true, $false)
    # The same logged-in user must not own the protected directory: an
    # object's owner can otherwise rewrite its DACL despite missing WRITE ACEs.
    $stateAcl.SetOwner([System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $stateAcl.Access | ForEach-Object { [void]$stateAcl.RemoveAccessRuleSpecific($_) }
    foreach ($item in @(
        @('S-1-5-18', [System.Security.AccessControl.FileSystemRights]::FullControl),
        @('S-1-5-32-544', [System.Security.AccessControl.FileSystemRights]::FullControl)
    )) {
        $sid = [System.Security.Principal.SecurityIdentifier]::new($item[0])
        $stateAcl.AddAccessRule(
            [System.Security.AccessControl.FileSystemAccessRule]::new(
                $sid, $item[1], $inherit, $propagate, $allow))
    }
    $stateAcl.AddAccessRule(
        [System.Security.AccessControl.FileSystemAccessRule]::new(
            $serviceSid, [System.Security.AccessControl.FileSystemRights]::Modify,
            $inherit, $propagate, $allow))
    Set-Acl -LiteralPath $stateRoot -AclObject $stateAcl
    $actualState = Get-Acl -LiteralPath $stateRoot
    if (-not $actualState.AreAccessRulesProtected) {
        throw 'service state ACL inherits ordinary user rights'
    }
    $stateOwner = $actualState.GetOwner(
        [System.Security.Principal.SecurityIdentifier]).Value
    if ($stateOwner -ne 'S-1-5-32-544') {
        throw 'service state has unsafe owner; ordinary same-account user could change its DACL'
    }
    $allowedStateSids = @('S-1-5-18', 'S-1-5-32-544', $serviceSid.Value)
    foreach ($ace in $actualState.Access) {
        $sid = $ace.IdentityReference.Translate(
            [System.Security.Principal.SecurityIdentifier]).Value
        if ($sid -notin $allowedStateSids) {
            throw 'unexpected account allowed access to protected service state'
        }
    }
    if (-not ($actualState.Access | Where-Object {
        $_.IdentityReference.Translate(
            [System.Security.Principal.SecurityIdentifier]).Value -eq $serviceSid.Value -and
        ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::WriteData) -ne 0
    })) {
        throw 'service-specific SID lacks necessary write access'
    }

    # Stage a canonical user-Evidence-schema SQLite snapshot only after the
    # Administrator-owned service directory ACL has been independently checked.
    # The service itself opens only the fixed file names, never a client path.
    $fixtureScript = Join-Path $repoRoot 'tests/memory-engine/create-operator-evidence-scm-fixture.mjs'
    # PowerShell enumerates arrays returned by if expressions. Always keep
    # a real object[] for native-argv splatting, including legacy one-item mode.
    [object[]]$fixtureArgs = @()
    if ($NativeEnrollmentMode.IsPresent) {
        $fixtureArgs = @('--native-enroll-only', $stateRoot)
    } else {
        $fixtureArgs = @($stateRoot)
    }
    & node $fixtureScript @fixtureArgs
    if ($LASTEXITCODE -ne 0) {
        throw 'canonical E~ source fixture creation failed'
    }

    if ($NativeEnrollmentMode.IsPresent) {
        # Created ONLY by this ephemeral CI script after the protected
        # service SID DACL has been independently verified. The regular
        # No-Write Preview installer never creates this marker.
        $publishGate = Join-Path $stateRoot 'agenthub-synthetic-direct-claim-ci-only.enable'
        [IO.File]::WriteAllText($publishGate,
            'AGENTHUB_SYNTHETIC_DIRECT_CLAIM_CI_ONLY_V1',
            [Text.UTF8Encoding]::new($false))
        # CI only: no normal Preview installation is permitted to register
        # even a test recipient or obtain an unconsented read channel.
        $deliveryGate = Join-Path $stateRoot 'agenthub-read-once-ci-only.enable'
        [IO.File]::WriteAllText($deliveryGate,
            'AGENTHUB_READ_ONCE_CI_ONLY_NO_PRODUCTION_V1',
            [Text.ASCIIEncoding]::new())
        $sourceScope = Get-Content -LiteralPath (Join-Path $stateRoot 'operator-evidence-manifest.json') -Raw | ConvertFrom-Json
        $ciSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        if ($sourceScope.projectId -cne 'github.com/example/operator-evidence' -or
            $sourceScope.branch -cne 'main' -or
            $sourceScope.revisionSha.Length -ne 40 -or
            $sourceScope.revisionSha -notmatch '^[0-9a-f]+$' -or
            $ciSid -notmatch '^S-1-5-21-') {
            throw 'CI direct read enrollment scope invalid'
        }
        $directPolicy = Join-Path $stateRoot 'agenthub-direct-read-ci-only.json'
        $policy = @{
            policy = 'agenthub-direct-read-ci-sid-scope-v1'
            principalSid = $ciSid
            projectId = $sourceScope.projectId
            branch = $sourceScope.branch
            revisionSha = $sourceScope.revisionSha
        } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($directPolicy, $policy,
            [Text.UTF8Encoding]::new($false))
        # Separate CI-only exact-Windows-account reader. The normal
        # installed Preview NEVER provisions this protected enrollment.
        $userReadPolicyPath = Join-Path $stateRoot 'agenthub-user-direct-read-ci-only.json'
        $userReadPolicy = @{
            policy = 'agenthub-user-direct-read-ci-sid-scope-v1'
            principalSid = $ciSid
            projectId = $sourceScope.projectId
            branch = $sourceScope.branch
            revisionSha = $sourceScope.revisionSha
        } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($userReadPolicyPath, $userReadPolicy,
            [Text.UTF8Encoding]::new($false))
    }

    & $sc start $service
    if ($LASTEXITCODE -ne 0) { throw 'LocalService lab host did not start' }
    $running = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $status = & $sc query $service
        if (($status -join ' ') -match 'RUNNING') { $running = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $running) {
        Write-Host ('DIAG SCM: ' + ((& $sc queryex $service) -join ' '))
        $labMarkerExists = Test-Path -LiteralPath (Join-Path $stateRoot 'service-started.txt')
        $ledgerExists = Test-Path -LiteralPath (Join-Path $stateRoot 'review-authority.sqlite3')
        Write-Host "DIAG before cleanup: marker=$labMarkerExists ledger=$ledgerExists"
        try {
            $failures = @(Get-WinEvent -FilterHashtable @{
                LogName='Application'
                StartTime=(Get-Date).AddMinutes(-3)
            } -MaxEvents 30 -ErrorAction Stop | Where-Object {
                $_.ProviderName -in @('.NET Runtime','Application Error')
                -and $_.Message -match 'MemoryReviewAuthority'
            } | Select-Object -First 2)
            foreach ($failure in $failures) {
                $detail = $failure.Message.Substring(0, [Math]::Min(1500, $failure.Message.Length))
                Write-Host "DIAG managed event $($failure.Id): $detail"
            }
        } catch { Write-Host 'DIAG managed event unavailable' }
        throw 'service never reached RUNNING state'
    }
    $markerFile = Join-Path $stateRoot 'service-started.txt'
    if (-not (Test-Path -LiteralPath $markerFile -PathType Leaf) -or
        ((Get-Content -LiteralPath $markerFile -Raw) -ne 'SERVICE_SID_STATE_WRITE_OK')) {
        throw 'restricted service failed to write protected state marker'
    }
    $ledgerPath = Join-Path $stateRoot 'review-authority.sqlite3'
    $ledgerMarker = Join-Path $stateRoot 'protected-ledger-ok.txt'
    if (-not (Test-Path -LiteralPath $ledgerPath -PathType Leaf) -or
        ((Get-Item -LiteralPath $ledgerPath).Length -lt 4096) -or
        -not (Test-Path -LiteralPath $ledgerMarker -PathType Leaf) -or
        ((Get-Content -LiteralPath $ledgerMarker -Raw) -ne 'SYNTHETIC_PROTECTED_CLAIM_NO_HUMAN_APPROVAL')) {
        throw 'service-owned pending-only SQLite ledger missing or incomplete'
    }
    $importMarker = Join-Path $stateRoot 'operator-evidence-imported.txt'
    if (-not (Test-Path -LiteralPath $importMarker -PathType Leaf) -or
        (Get-Content -LiteralPath $importMarker -Raw) -ne 'REAL_EVIDENCE_PENDING_NO_CLAIM') {
        throw 'restricted LocalService did not ingest real E~ Evidence without creating a Claim'
    }
    Write-Host 'PASS: real E~ canonical SQLite/Evidence imported by restricted LocalService as PENDING only; NO Claim, NO human approval'
    $pinnedCredentialMarker = Join-Path $stateRoot 'operator-credential-pinned.txt'
    if ($NativeEnrollmentMode.IsPresent) {
        if (Test-Path -LiteralPath $pinnedCredentialMarker) {
            throw 'native enrollment lab must not stage unverified browser key'
        }
        Write-Host 'PASS: native enrollment lab starts with zero existing operator credentials'
    } else {
        if (-not (Test-Path -LiteralPath $pinnedCredentialMarker -PathType Leaf) -or
            (Get-Content -LiteralPath $pinnedCredentialMarker -Raw) -ne
                'OPERATOR_CREDENTIAL_UNVERIFIED_NO_APPROVAL') {
            throw 'restricted LocalService did not persist unverified WebAuthn credential under service SID'
        }
        Write-Host 'PASS: restricted LocalService pinned operator ES256 public key as unverified in protected SQLite; no claim or approval'
    }
    $stateFiles = @(Get-ChildItem -LiteralPath $stateRoot -File)
    foreach ($stateFile in $stateFiles) {
        $fileAcl = Get-Acl -LiteralPath $stateFile.FullName
        foreach ($ace in $fileAcl.Access) {
            $sid = $ace.IdentityReference.Translate(
                [System.Security.Principal.SecurityIdentifier]).Value
            if ($sid -notin $allowedStateSids) {
                throw 'service-owned SQLite or journal file has a user-writable ACL'
            }
        }
        $ownerSid = $fileAcl.GetOwner(
            [System.Security.Principal.SecurityIdentifier]).Value
        if ($ownerSid -notin @('S-1-5-18', 'S-1-5-19', 'S-1-5-32-544', $serviceSid.Value)) {
            throw 'service-owned SQLite or journal file has an unexpected owner'
        }
    }
    # Real negative I/O under a restricted token of the SAME CI account.
    # The Administrators SID is deny-only and elevated privileges are removed.
    $accessProbe = (Resolve-Path -LiteralPath $AccessProbeExe).Path
    & $accessProbe $stateRoot
    if ($LASTEXITCODE -ne 0) { throw 'same-account nonadmin SQLite access denial failed' }
    # Publish ONLY the service-generated public key under a separate
    # Administrators-owned directory. Ordinary users may read this key but
    # cannot replace it with a forged same-account pipe server identity.
    $sourcePin = Join-Path $stateRoot 'review-service-signing-key.pub.pem'
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        if (Test-Path -LiteralPath $sourcePin -PathType Leaf) { break }
        Start-Sleep -Milliseconds 150
    }
    if (-not (Test-Path -LiteralPath $sourcePin -PathType Leaf)) {
        throw 'protected signing public key was not generated'
    }
    $privateKey = Join-Path $stateRoot 'review-service-signing-key.pk8'
    if (-not (Test-Path -LiteralPath $privateKey -PathType Leaf)) {
        throw 'protected signing private key was not generated'
    }
    New-Item -ItemType Directory -Path $publicRoot | Out-Null
    $publicAcl = Get-Acl -LiteralPath $publicRoot
    $publicAcl.SetAccessRuleProtection($true, $false)
    $publicAcl.SetOwner([System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $publicAcl.Access | ForEach-Object { [void]$publicAcl.RemoveAccessRuleSpecific($_) }
    foreach ($grant in @(
        @('S-1-5-18', [System.Security.AccessControl.FileSystemRights]::FullControl),
        @('S-1-5-32-544', [System.Security.AccessControl.FileSystemRights]::FullControl),
        @('S-1-5-32-545', [System.Security.AccessControl.FileSystemRights]::ReadAndExecute)
    )) {
        $sid = [System.Security.Principal.SecurityIdentifier]::new($grant[0])
        $publicAcl.AddAccessRule(
            [System.Security.AccessControl.FileSystemAccessRule]::new(
                $sid, $grant[1], $inherit, $propagate, $allow))
    }
    Set-Acl -LiteralPath $publicRoot -AclObject $publicAcl
    $publishedPin = Join-Path $publicRoot 'review-service-signing-key.pub.pem'
    Copy-Item -LiteralPath $sourcePin -Destination $publishedPin
    # Force owner and DACL on the copied file (do not trust Copy-Item to
    # inherit the destination directory security on all runner versions).
    $pinAcl = Get-Acl -LiteralPath $publishedPin
    $pinAcl.SetAccessRuleProtection($true, $false)
    $pinAcl.SetOwner([System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $pinAcl.Access | ForEach-Object { [void]$pinAcl.RemoveAccessRuleSpecific($_) }
    foreach ($grant in @(
        @('S-1-5-18', [System.Security.AccessControl.FileSystemRights]::FullControl),
        @('S-1-5-32-544', [System.Security.AccessControl.FileSystemRights]::FullControl),
        @('S-1-5-32-545', [System.Security.AccessControl.FileSystemRights]::ReadAndExecute)
    )) {
        $sid = [System.Security.Principal.SecurityIdentifier]::new($grant[0])
        $pinAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid, $grant[1], $allow))
    }
    Set-Acl -LiteralPath $publishedPin -AclObject $pinAcl
    $actualPin = Get-Acl -LiteralPath $publishedPin
    if (-not $actualPin.AreAccessRulesProtected -or
        $actualPin.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-32-544') {
        throw 'published service identity pin has an unsafe ACL or owner'
    }
    foreach ($ace in $actualPin.Access) {
        $sid = $ace.IdentityReference.Translate(
            [System.Security.Principal.SecurityIdentifier]).Value
        if ($sid -notin @('S-1-5-18','S-1-5-32-544','S-1-5-32-545')) {
            throw 'published identity pin has an unexpected access rule'
        }
        if ($sid -eq 'S-1-5-32-545' -and
            (($ace.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::WriteData) -ne 0)) {
            throw 'ordinary users can replace the service identity pin'
        }
    }

    # Exercise the REAL service-owned E~ content in a new ADMIN-ACL-only
    # WebAuthn pipe: signed exact fact and challenge are issued by restricted
    # LocalService, a software ECDSA test key gives UV proof, persisted
    # hardware-like nonzero sign-counter replay is rejected on next ticket.
    # Absolutely NO human approval and NO protected real Claim.
    if ($NativeEnrollmentMode.IsPresent) {
        # A generated software key exercises native-registration protocol,
        # strict COSE, second possession challenge, persistence and replay.
        # This is NOT a hardware/physical human test.
        $enrollProbe = Join-Path $repoRoot 'scripts/probe-operator-service-native-enrollment.mjs'
        $enrollOutput = & node $enrollProbe $publishedPin
        if ($LASTEXITCODE -ne 0) {
            throw 'native enrollment service E2E synthetic protocol failed'
        }
        $enroll = $enrollOutput | ConvertFrom-Json
        if ($enroll.status -ne 'synthetic_native_enrollment_bridge_pass_not_human' -or
            -not $enroll.original_fact_service_signed -or
            -not $enroll.independent_create_and_get_challenges -or
            -not $enroll.protected_key_persisted_for_probe -or
            -not $enroll.nonzero_sign_counter_replay_denied -or
            $enroll.source_kind -cne 'knowledge' -or
            -not $enroll.purpose_bound_reaffirmation_intent_recorded -or
            -not $enroll.separate_purpose_bound_claim_commit -or
            -not $enroll.private_direct_claim_committed -or
            -not $enroll.protected_read_offer_exact_claim_and_query -or
            -not $enroll.read_purpose_uv_one_use_only -or
            $enroll.read_released -or
            $enroll.published_to_codex -or
            $enroll.historical_evidence_verified -or
            $enroll.hardware_attestation_verified -or
            $enroll.human_approval_verified -or -not $enroll.claim_written -or
            -not $enroll.production_no_go) {
            throw 'synthetic native enrollment incorrectly granted approval'
        }
        Write-Host 'PASS: native claim commit then separate one-use read-preview UV, exact snapshot, no read release'
        # Actual compiled WinForms client reads the exact protected Claim text
        # from the running service and validates the administrator-owned pin.
        # No physical Hello or Codex recipient is used by this headless mode.
        $operatorUiProject = Join-Path $repoRoot 'memory-engine/authority-host/windows/MemoryReviewAuthority.OperatorUi/MemoryReviewAuthority.OperatorUi.csproj'
        & dotnet run --project $operatorUiProject -c Release --runtime win-x64 --no-build --no-restore -- --read-preview-smoke
        if ($LASTEXITCODE -ne 0) {
            $readDiag = Join-Path $env:RUNNER_TEMP 'AgentHubNativeReadPreviewFailure.txt'
            if (Test-Path -LiteralPath $readDiag -PathType Leaf) {
                Write-Host ('Native read preview diagnosis: ' +
                    (Get-Content -LiteralPath $readDiag -Raw))
            }
            throw 'native operator UI did not verify signed private Claim and recipient'
        }
        Write-Host 'PASS: native elevated operator UI independently verifies exact signed private Claim and recipient; NO Hello, NO Codex release'
        $reaffirmAudit = Join-Path $repoRoot 'scripts/verify-operator-reaffirmation-scm-state.mjs'
        $readbackOutput = & node $reaffirmAudit
        if ($LASTEXITCODE -ne 0) {
            throw 'protected native reaffirmation SQLite audit failed'
        }
        $readback = $readbackOutput | ConvertFrom-Json
        if ($readback.status -cne 'protected_operator_direct_claim_scm_readback_pass' -or
            $readback.intent_rows -ne 1 -or
            $readback.original_source_verified -or
            $readback.real_claim_rows -ne 1 -or
            $readback.synthetic_claim_rows -ne 0 -or
            $readback.codex_published -or
            $readback.verified_review_intent_rows -ne 0 -or
            $readback.credential_count -ne 4 -or
            $readback.protected_source_kind -cne 'knowledge') {
            throw 'Reaffirmation readback unexpectedly promoted historical source or Claim'
        }
        Write-Host 'PASS: protected SQLite readback has exactly one private user-direct Claim, unverifiable old source, zero signed Codex publication'
        $directProbe = Join-Path $repoRoot 'scripts/probe-protected-direct-read-ci.mjs'
        $directOutput = & node $directProbe --pin $publishedPin --sid $ciSid --revision $sourceScope.revisionSha
        if ($LASTEXITCODE -ne 0) { throw 'direct CI signed read failed' }
        $direct = $directOutput | ConvertFrom-Json
        if ($direct.status -cne 'protected_direct_read_ci_sid_scope_signature_pass' -or
            $direct.claim_count -ne 1 -or
            -not $direct.principal_sid_matches_os -or
            -not $direct.signed_response_verified -or
            -not $direct.wrong_revision_denied -or
            -not $direct.wrong_sid_denied -or
            $direct.actual_physical_hello_verified -or
            $direct.trusted_for_production_recall -or
            $direct.published_to_codex -or
            -not $direct.production_no_go) {
            throw 'direct CI signed read falsely claimed authority'
        }
        Write-Host 'PASS: signed direct CI read binds OS SID and Git revision'
        # SAME logged-in account, but with the Administrators group
        # disabled by a real restricted Windows impersonation token.
        # A successful signed read MUST coexist with denial of direct DB
        # access and both admin-only operator/read pipes.
        & $accessProbe $stateRoot --signed-user-ci $sourceScope.revisionSha $publishedPin
        if ($LASTEXITCODE -ne 0) {
            throw 'same-account nonadmin signed Claim read denied or admin pipe exposed'
        }
        Write-Host 'PASS: non-elevated same-account token verifies signed user Claim and cannot reach admin, UV or SQLite'
        # Simulate an exact administrator revocation while the existing
        # LocalService remains running. A cached startup policy must not
        # authorize later reads. The same-account restricted token must
        # receive NO signed response. Restoring IDENTICAL bytes must not
        # re-enable the old in-memory pipe without deliberate SCM restart.
        $userReadEnrollment = Join-Path $stateRoot 'agenthub-user-direct-read-ci-only.json'
        $originalUserPolicy = [IO.File]::ReadAllBytes($userReadEnrollment)
        Remove-Item -LiteralPath $userReadEnrollment -Force
        & $accessProbe $stateRoot --revoked-user-ci $sourceScope.revisionSha $publishedPin
        if ($LASTEXITCODE -ne 0) {
            throw 'service kept serving private Claim after live revocation'
        }
        [IO.File]::WriteAllBytes($userReadEnrollment, $originalUserPolicy)
        & $accessProbe $stateRoot --revoked-user-ci $sourceScope.revisionSha $publishedPin
        if ($LASTEXITCODE -ne 0) {
            throw 'revoked private read was resurrected by policy file recreation'
        }
        $scStatus = & $sc query $service
        if ($LASTEXITCODE -ne 0 -or ($scStatus -join ' ') -notmatch 'RUNNING') {
            throw 'denied read was caused by stopped SCM service, not live revocation'
        }
        Write-Host 'PASS: protected policy withdrawal denies signed user read, latches until restart, SCM still RUNNING'
        # The independent admin-only direct-read pipe must also revoke
        # without requiring service shutdown. Mutate the protected policy
        # (not the signed data) while the service is running, then prove
        # that reintroducing the original bytes does not resurrect reads.
        $adminReadEnrollment = Join-Path $stateRoot 'agenthub-direct-read-ci-only.json'
        $originalAdminPolicy = [IO.File]::ReadAllBytes($adminReadEnrollment)
        $tampered = [Text.Encoding]::UTF8.GetString($originalAdminPolicy) |
            ConvertFrom-Json
        $tampered.revisionSha = 'c' * 40
        [IO.File]::WriteAllText($adminReadEnrollment,
            ($tampered | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
        & node $directProbe --pin $publishedPin --sid $ciSid --revision $sourceScope.revisionSha *> $null
        if ($LASTEXITCODE -eq 0) {
            throw 'admin direct-read policy alteration did not revoke access'
        }
        [IO.File]::WriteAllBytes($adminReadEnrollment, $originalAdminPolicy)
        & node $directProbe --pin $publishedPin --sid $ciSid --revision $sourceScope.revisionSha *> $null
        if ($LASTEXITCODE -eq 0) {
            throw 'admin direct read was resurrected without service restart'
        }
        $scStatus = & $sc query $service
        if ($LASTEXITCODE -ne 0 -or ($scStatus -join ' ') -notmatch 'RUNNING') {
            throw 'administrative read denial was due to stopped service'
        }
        Write-Host 'PASS: admin direct-read policy mutation revokes live read and cannot auto-reactivate'
        $readbackAfterRevocation = & node (Join-Path $repoRoot 'scripts/verify-operator-reaffirmation-scm-state.mjs') |
            ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or
            $readbackAfterRevocation.status -cne 'protected_operator_direct_claim_scm_readback_pass' -or
            $readbackAfterRevocation.real_claim_rows -ne 1 -or
            $readbackAfterRevocation.credential_count -ne 4) {
            throw 'read revocation unexpectedly affected protected direct Claim storage'
        }
        Write-Host 'PASS: all signed reads revoked, but one private direct Claim and credential counter remain unchanged'
        # A fresh SERVICE PROCESS must not resurrect the same read
        # enrollment when the operator restores the original JSON bytes.
        # The service-owned FULL-WAL append-only tombstone is authoritative.
        & $sc stop $service | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'CI service stop for durable revoke test failed' }
        $stopped = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            $status = (& $sc query $service) -join ' '
            if ($status -match 'STOPPED') { $stopped = $true; break }
            Start-Sleep -Milliseconds 250
        }
        if (-not $stopped) { throw 'CI service failed to stop before durable restart test' }
        & $sc start $service | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'CI service restart failed after revocation' }
        $restarted = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            $status = (& $sc query $service) -join ' '
            if ($status -match 'RUNNING') { $restarted = $true; break }
            Start-Sleep -Milliseconds 250
        }
        if (-not $restarted) { throw 'CI service did not reach RUNNING after revocation' }
        & $accessProbe $stateRoot --revoked-user-ci $sourceScope.revisionSha $publishedPin
        if ($LASTEXITCODE -ne 0) {
            throw 'same-user signed reader returned a private Claim AFTER service restart'
        }
        & node $directProbe --pin $publishedPin --sid $ciSid --revision $sourceScope.revisionSha *> $null
        if ($LASTEXITCODE -eq 0) {
            throw 'administrator signed reader returned private Claim AFTER service restart'
        }
        $auditPath = Join-Path $repoRoot 'scripts/verify-direct-read-revocation-ci.mjs'
        $journal = & node $auditPath | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or
            $journal.status -cne 'durable_direct_ci_read_revocation_survived_scm_restart' -or
            $journal.event_rows -ne 4 -or $journal.revoked_lanes -ne 2 -or
            $journal.private_direct_claim_rows -ne 1 -or
            $journal.credential_sign_count -ne 4 -or
            $journal.reenable_authorized -or -not $journal.production_no_go) {
            throw 'protected revoke journal or Claim changed after SCM restart'
        }
        Write-Host 'PASS: both private CI read scopes revoked durably after SCM restart with original policy files restored'
        Write-Host 'PASS: immutable protected journal 4 events, 2 revoked lanes, Claim and counter unchanged'
    } else {
    $operatorProbe = Join-Path $repoRoot 'scripts/probe-operator-service-web-authn.mjs'
    $operatorOutput = & node $operatorProbe $publishedPin
    if ($LASTEXITCODE -ne 0) {
        throw 'admin-only WebAuthn proof bridge for actual E~ source failed'
    }
    $operator = $operatorOutput | ConvertFrom-Json
    if ($operator.status -ne 'operator_real_E_source_uv_service_bridge_test_pass' -or
        -not $operator.exact_service_signed_fact_verified -or
        -not $operator.service_generated_challenge_verified -or
        -not $operator.protected_operator_credential_counter_persisted -or
        -not $operator.stale_nonzero_counter_denied -or
        $operator.human_approval_verified -or $operator.claim_written -or
        -not $operator.production_no_go) {
        throw 'operator proof wrongly classified synthetic CI assertion as human approval'
    }
    Write-Host 'PASS: real E~ protected exact fact -> admin-only LocalService WebAuthn challenge -> signed UV receipt; replay denied, NO Claim'
    }

    # The *real native Windows GUI executable*, rather than a Node-simulated
    # browser, must itself connect with elevated token, verify Admin-owned
    # service signing key + parent ACL and the service's exact signed E~ fact.
    # --service-smoke does not invoke Hello or create any Claim; physical user
    # approval remains a separate, explicitly initiated acceptance step.
    $nativeProject = Join-Path $repoRoot 'memory-engine/authority-host/windows/MemoryReviewAuthority.OperatorUi/MemoryReviewAuthority.OperatorUi.csproj'
    & dotnet run --project $nativeProject -c Release --runtime win-x64 --no-build --no-restore -- --service-smoke
    if ($LASTEXITCODE -ne 0) {
        $operatorDiag = Join-Path $env:RUNNER_TEMP 'AgentHubNativeOperatorSmokeFailure.txt'
        if (Test-Path -LiteralPath $operatorDiag -PathType Leaf) {
            Write-Host ('Native Windows operator CI-only diagnostic: ' +
                (Get-Content -LiteralPath $operatorDiag -Raw))
        }
        throw 'native operator Windows GUI failed to verify signed real E~ from live service'
    }
    Write-Host 'PASS: native elevated operator Windows GUI client validates actual protected E~ and Admin-owned signer via SCM pipe; NO Hello, NO Claim'

    $probeScript = Join-Path $repoRoot 'scripts/probe-protected-memory-lab.mjs'
    # Resolve script path from GitHub checkout, never from service IPC input.
    if (-not (Test-Path -LiteralPath $probeScript -PathType Leaf)) {
        throw 'repository read probe not present'
    }
    $goodJson = & node $probeScript --pin $publishedPin
    if ($LASTEXITCODE -ne 0) { throw 'signed service read failed' }
    $good = $goodJson | ConvertFrom-Json
    if ($good.status -ne 'found_lab_only' -or
        -not $good.signed_response_verified -or
        $good.trusted_for_production_recall -or
        $good.real_human_approval_verified -or
        @($good.items).Count -ne 1 -or
        $good.items[0].value -ne 'Synthetic non-authorizing lab fact') {
        throw 'verified protected read had incorrect content or authority flags'
    }
    $forgedPin = Join-Path $env:RUNNER_TEMP 'agenthub-review-forged-key.pem'
    Set-Content -LiteralPath $forgedPin -Value 'not-a-valid-public-key'
    $forgedJson = & node $probeScript --pin $forgedPin
    $forgedExit = $LASTEXITCODE
    $forged = $forgedJson | ConvertFrom-Json
    if ($forgedExit -ne 2 -or
        $forged.status -ne 'protected_lab_read_unverified' -or
        @($forged.items).Count -ne 0) {
        throw 'forged signing key was not rejected closed'
    }
    # Exercise the exact EXISTING memory_recall MCP tool, not a separate
    # diagnostic interface. Server mode is explicitly lab-only. The project
    # is selected from actual process cwd + Git identity + enrolled root.
    New-Item -ItemType Directory -Path $labGitRoot | Out-Null
    & git -C $labGitRoot init -b main | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'temporary lab git init failed' }
    & git -C $labGitRoot config user.email 'signed-lab@example.invalid'
    & git -C $labGitRoot config user.name 'Signed Lab Test'
    & git -C $labGitRoot config commit.gpgsign false
    & git -C $labGitRoot remote add origin 'https://github.com/example/lab-fixture.git'
    Set-Content -LiteralPath (Join-Path $labGitRoot 'README.md') -Value 'synthetic SCM signed read only'
    & git -C $labGitRoot add README.md
    & git -C $labGitRoot commit -m fixture | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'temporary lab git commit failed' }
    $scopePath = Join-Path $labGitRoot 'test-scope.json'
    @{
        schema = 1
        memory_db = (Join-Path $labGitRoot 'not-used-for-protected-read.sqlite3')
        projects = @(@{
            root = $labGitRoot
            project_id = 'github.com/example/lab-fixture'
            repo_identity = 'github.com/example/lab-fixture'
        })
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $scopePath
    $mcpScript = Join-Path $repoRoot 'scripts/run-codex-memory-mcp.mjs'
    $rpc = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory_recall","arguments":{"query":"Synthetic non-authorizing lab fact","max_items":3}}}'
    Push-Location -LiteralPath $labGitRoot
    try {
        $rpcResponse = $rpc | & node $mcpScript --lab-protected-read --scope $scopePath --pin $publishedPin
        $rpcExit = $LASTEXITCODE
    } finally { Pop-Location }
    if ($rpcExit -ne 0) { throw 'actual protected Codex MCP read failed' }
    $mcp = $rpcResponse | ConvertFrom-Json
    if ($mcp.result.isError -or @($mcp.result.content).Count -ne 1) {
        throw 'signed lab read failed in existing MCP dispatcher'
    }
    $memory = $mcp.result.content[0].text | ConvertFrom-Json
    if ($memory.status -ne 'found_lab_only' -or
        -not $memory.signed_response_verified -or
        $memory.trusted_for_production_recall -or
        @($memory.items).Count -ne 1 -or
        $memory.items[0].value -ne 'Synthetic non-authorizing lab fact') {
        throw 'Codex MCP returned wrong or unverified protected lab Claim'
    }

    # A model cannot choose another source, root, database or pin as an MCP
    # argument. These are pinned by the host at startup.
    $badRpc = '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory_recall","arguments":{"query":"Synthetic","projectId":"github.com/other/repo"}}}'
    Push-Location -LiteralPath $labGitRoot
    try { $badResponse = $badRpc | & node $mcpScript --lab-protected-read --scope $scopePath --pin $publishedPin }
    finally { Pop-Location }
    $badTool = (($badResponse | ConvertFrom-Json).result.content[0].text) | ConvertFrom-Json
    if ($badTool.status -ne 'forbidden_argument') {
        throw 'model could override signed read scope'
    }

    # Same MCP binary from an unapproved cwd must fail BEFORE it tries to
    # fetch any protected Claim or trusts a fake caller project ID.
    Push-Location -LiteralPath $repoRoot
    try { $denyResponse = $rpc | & node $mcpScript --lab-protected-read --scope $scopePath --pin $publishedPin }
    finally { Pop-Location }
    $denied = (($denyResponse | ConvertFrom-Json).result.content[0].text) | ConvertFrom-Json
    if ($denied.status -ne 'project_not_approved' -or @($denied.items).Count -ne 0) {
        throw 'unapproved Git checkout reached protected Claim read'
    }
    Write-Host 'PASS: existing Codex MCP memory_recall sees exactly one signed, synthetic SCM Claim; wrong cwd/model args deny'
    Write-Host 'PASS: SCM restricted service signed one synthetic protected Claim; Node verified Admin-pinned service origin, one nonce, and strict scope'
    Write-Host 'PASS: forged pin rejected; NO REAL USER APPROVAL, NO PRODUCTION IPC'
    Write-Host 'PASS: restricted LocalService protected SQLite ACL and same-account negative access'
}
finally {
    $ephemeralOperatorTestPrivateKey = Join-Path $env:RUNNER_TEMP 'AgentHubMemoryReviewLab-TestOperatorPrivateKey.pem'
    if (Test-Path -LiteralPath $ephemeralOperatorTestPrivateKey) {
        Remove-Item -LiteralPath $ephemeralOperatorTestPrivateKey -Force -ErrorAction SilentlyContinue
    }
    if ($created) {
        & $sc stop $service 2>$null | Out-Null
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            $status = & $sc query $service 2>$null
            if (($status -join ' ') -notmatch 'RUNNING|STOP_PENDING') { break }
            Start-Sleep -Milliseconds 300
        }
        & $sc delete $service 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'temporary SCM service deletion failed' }
        $gone = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            if ($null -eq (Get-Service -Name $service -ErrorAction SilentlyContinue)) {
                $gone = $true
                break
            }
            Start-Sleep -Milliseconds 300
        }
        if (-not $gone) { throw 'temporary SCM service was not fully removed' }
    }
    if (Test-Path -LiteralPath $labGitRoot) {
        Remove-Item -LiteralPath $labGitRoot -Force -Recurse -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $publicRoot) {
        Remove-Item -LiteralPath $publicRoot -Force -Recurse -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $stateRoot) {
        Remove-Item -LiteralPath $stateRoot -Force -Recurse -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $root) {
        Remove-Item -LiteralPath $root -Force -Recurse -ErrorAction Stop
    }
    if ((Test-Path -LiteralPath $stateRoot) -or
        (Test-Path -LiteralPath $publicRoot) -or
        (Test-Path -LiteralPath $labGitRoot) -or
        (Test-Path -LiteralPath $root)) {
        throw 'temporary state or executable directory still exists'
    }
    Write-Host 'PASS: ephemeral SCM service, service-SID state and executable directory removed'
    # Runner is ephemeral; never delete any pre-existing operator service.
}
