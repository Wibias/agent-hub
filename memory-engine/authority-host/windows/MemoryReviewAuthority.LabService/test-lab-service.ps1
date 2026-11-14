# Windows hosted GitHub Actions ONLY. Never run on an operator's PC.
# Creates a disposable, non-networked LocalService host and always removes it.
param(
    [Parameter(Mandatory = $true)]
    [string]$PublishedExe,
    [Parameter(Mandatory = $true)]
    [string]$AccessProbeExe
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
    & node $fixtureScript $stateRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'canonical E~ source fixture creation failed'
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
    if (-not (Test-Path -LiteralPath $pinnedCredentialMarker -PathType Leaf) -or
        (Get-Content -LiteralPath $pinnedCredentialMarker -Raw) -ne
            'OPERATOR_CREDENTIAL_UNVERIFIED_NO_APPROVAL') {
        throw 'restricted LocalService did not persist unverified WebAuthn credential under service SID'
    }
    Write-Host 'PASS: restricted LocalService pinned operator ES256 public key as unverified in protected SQLite; no claim or approval'
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

    # The *real native Windows GUI executable*, rather than a Node-simulated
    # browser, must itself connect with elevated token, verify Admin-owned
    # service signing key + parent ACL and the service's exact signed E~ fact.
    # --service-smoke does not invoke Hello or create any Claim; physical user
    # approval remains a separate, explicitly initiated acceptance step.
    $nativeProject = Join-Path $repoRoot 'memory-engine/authority-host/windows/MemoryReviewAuthority.OperatorUi/MemoryReviewAuthority.OperatorUi.csproj'
    & dotnet run --project $nativeProject -c Release --runtime win-x64 --no-build --no-restore -- --service-smoke
    if ($LASTEXITCODE -ne 0) {
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
