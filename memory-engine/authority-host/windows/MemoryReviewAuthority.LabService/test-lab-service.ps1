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
    Copy-Item -LiteralPath $exe -Destination $target -Force

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

    & $sc start $service
    if ($LASTEXITCODE -ne 0) { throw 'LocalService lab host did not start' }
    $running = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $status = & $sc query $service
        if (($status -join ' ') -match 'RUNNING') { $running = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $running) { throw 'service never reached RUNNING state' }
    Write-Host 'PASS: disposable LocalService restricted-SID lab host started; NO_PIPE NO_NETWORK NO_DB'
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
    if (Test-Path -LiteralPath $root) {
        Remove-Item -LiteralPath $root -Force -Recurse -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $root) { throw 'temporary executable directory still exists' }
    Write-Host 'PASS: ephemeral SCM service and executable directory removed'
    # Runner is ephemeral; never delete any pre-existing operator service.
}
