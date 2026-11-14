# Windows hosted GitHub Actions ONLY. Never run on an operator's PC.
# Creates a disposable, non-networked LocalService host and always removes it.
param(
    [Parameter(Mandatory = $true)]
    [string]$PublishedExe
)

$ErrorActionPreference = 'Stop'
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
if (Test-Path -LiteralPath $stateRoot) {
    throw 'preexisting state directory: refuse to touch it'
}
$root = Join-Path $env:ProgramData ("AgentHubMemoryReviewLab-" + [guid]::NewGuid().ToString('N'))
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
        ((Get-Content -LiteralPath $ledgerMarker -Raw) -ne 'PENDING_ONLY_NO_AUTHORIZATION')) {
        throw 'service-owned pending-only SQLite ledger missing or incomplete'
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
    }
    Write-Host 'PASS: restricted LocalService wrote a pending-only WAL SQLite ledger under exact service-SID ACL; NO_IPC NO_CLAIMS'
}
finally {
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
    if (Test-Path -LiteralPath $stateRoot) {
        Remove-Item -LiteralPath $stateRoot -Force -Recurse -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $root) {
        Remove-Item -LiteralPath $root -Force -Recurse -ErrorAction Stop
    }
    if ((Test-Path -LiteralPath $stateRoot) -or (Test-Path -LiteralPath $root)) {
        throw 'temporary state or executable directory still exists'
    }
    Write-Host 'PASS: ephemeral SCM service, service-SID state and executable directory removed'
    # Runner is ephemeral; never delete any pre-existing operator service.
}
