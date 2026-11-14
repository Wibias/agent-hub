# AgentHub REVIEW-ONLY local Windows x64 preview bootstrap.
# FAIL CLOSED. Must run from a separately Administrator-owned, ACL-pinned
# bootstrap file. Never execute this elevated directly from Git/Downloads.
# This is NOT production Memory Write, not an approval or a persistent install.
[CmdletBinding()]
param(
    [ValidateSet('Inspect','Install','Remove')]
    [string] $Action = 'Inspect',
    [string] $PackageDirectory,
    [string] $ExpectedManifestSha256,
    [string] $EvidenceExportDirectory,
    [string] $OperatorCredentialManifestPath,
    [string] $Consent
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$serviceName = 'AgentHubMemoryReviewLab'
$format = 'agenthub-local-memory-operator-preview-package-v1'
$root = Join-Path $env:ProgramData 'AgentHubMemoryReviewLab-PreviewApp'
$stateRoot = Join-Path $env:ProgramData 'AgentHubMemoryReviewLab-State'
$publicRoot = Join-Path $env:ProgramData 'AgentHubMemoryReviewLab-Public'
$bootstrap = Join-Path $env:ProgramData 'AgentHubMemoryReviewLab-Bootstrap'
$manifestName = 'operator-preview-package.json'
$sc = Join-Path $env:WINDIR 'System32/sc.exe'
$marker = Join-Path $root 'agenthub-preview-install.json'
$stateSource = 'operator-evidence-snapshot.sqlite3'
$stateManifest = 'operator-evidence-manifest.json'
$stateCredential = 'operator-webauthn-credential.json'

function Require([bool]$ok, [string]$why) {
    if (-not $ok) { throw $why }
}
function SID([string]$s) {
    return [Security.Principal.SecurityIdentifier]::new($s)
}
function Sha([string]$path) {
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
}
function Has-ChangeRights([Security.AccessControl.FileSystemRights]$rights) {
    $mutate = [Security.AccessControl.FileSystemRights]::WriteData -bor
        [Security.AccessControl.FileSystemRights]::AppendData -bor
        [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership
    return (($rights -band $mutate) -ne 0)
}
function Inspect-Acl([string]$path, [string[]]$writers) {
    $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    Require (-not (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) 'Reparse-point path forbidden'
    $acl = Get-Acl -LiteralPath $path
    $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    Require ($acl.AreAccessRulesProtected -and $owner -eq 'S-1-5-32-544') (
        'Owner or DACL not protected at ' + $path +
        ' (owner=' + $owner + ', inherited=' + (-not $acl.AreAccessRulesProtected) + ')')
    foreach ($rule in $acl.Access) {
        if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) {
            continue
        }
        $id = $rule.IdentityReference.Translate(
            [Security.Principal.SecurityIdentifier]).Value
        if ((Has-ChangeRights $rule.FileSystemRights) -and $id -notin $writers) {
            throw 'Untrusted writer in protected path: ' + $id
        }
    }
}
function Require-File([string]$path, [long]$max = 300MB) {
    $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    Require ($item -is [IO.FileInfo] -and $item.Length -gt 0 -and $item.Length -le $max -and
        (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)) 'Missing or untrusted input file'
}
function Is-Admin {
    $principal = [Security.Principal.WindowsPrincipal]::new(
        [Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Protect-Directory([string]$path, [object[]]$permissions) {
    New-Item -ItemType Directory -Path $path -ErrorAction Stop | Out-Null
    # Build from an EMPTY DACL. Reusing ProgramData's inherited ACL
    # then deleting individual inherited rules can silently retain the
    # parent security inheritance control bit on Windows.
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner((SID 'S-1-5-32-544'))
    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $propagate = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    foreach ($p in $permissions) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            (SID $p[0]), $p[1], $inherit, $propagate, $allow))
    }
    Set-Acl -LiteralPath $path -AclObject $acl
    # Windows explicitly owns the inheritance control flag. A fresh
    # .NET DirectorySecurity object plus Set-Acl may still leave
    # SE_DACL_PROTECTED unset for a newly created ProgramData child.
    # icacls /inheritance:r explicitly removes the inheritance boundary.
    & (Join-Path $env:WINDIR 'System32/icacls.exe') $path '/inheritance:r' | Out-Null
    Require ($LASTEXITCODE -eq 0) 'Cannot disable inherited directory permissions'
    $allowedWriters = @('S-1-5-18','S-1-5-32-544')
    foreach ($p in $permissions) {
        if ($p[0] -match '^S-1-5-80-' -and
            (Has-ChangeRights $p[1])) {
            $allowedWriters += [string]$p[0]
        }
    }
    Inspect-Acl $path $allowedWriters
}
function Machine-Permissions {
    return @(
        ,@('S-1-5-18', [Security.AccessControl.FileSystemRights]::FullControl),
        ,@('S-1-5-32-544', [Security.AccessControl.FileSystemRights]::FullControl)
    )
}
function Machine-And-ReadPermissions([string]$sid) {
    $p = @(Machine-Permissions)
    return @($p + @(,@($sid,
        [Security.AccessControl.FileSystemRights]::ReadAndExecute)))
}
function Protected-Bootstrap-Required {
    $expected = Join-Path $bootstrap 'install-memory-review-local-preview.ps1'
    Require ([IO.Path]::GetFullPath($PSCommandPath) -ieq [IO.Path]::GetFullPath($expected)) `
        'Never run elevated from an agent-writable checkout; first pin a reviewed installer in protected ProgramData bootstrap'
    Inspect-Acl $bootstrap @('S-1-5-18','S-1-5-32-544')
    Inspect-Acl $expected @('S-1-5-18','S-1-5-32-544')
}
function Verify-Package([string]$path, [string]$expectedHash) {
    Require ($expectedHash -cmatch '^[0-9a-fA-F]{64}$') 'Explicit independently checked manifest SHA256 required'
    $manifestPath = Join-Path $path $manifestName
    Require-File $manifestPath 131072
    Require ((Sha $manifestPath) -ceq $expectedHash.ToLowerInvariant()) `
        'Pinned package-manifest SHA mismatch'
    $m = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 |
        ConvertFrom-Json -ErrorAction Stop
    Require ($m.format -ceq $format -and $m.claimsEnabled -eq $false -and
        $m.serviceStartType -ceq 'demand' -and $m.commitSha -cmatch '^[0-9a-f]{40}$') `
        'Unexpected package contract'
    $files = @($m.files)
    Require ($files.Count -ge 2 -and $files.Count -le 100) 'Package file count invalid'
    $seen = [Collections.Generic.HashSet[string]]::new(
        [StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $files) {
        $r = [string]$entry.relativePath
        Require ($r -cmatch '^(Service|Operator)/[A-Za-z0-9._/-]{1,190}$' -and
            -not $r.Contains('..') -and -not $r.Contains('//') -and
            $entry.sha256 -cmatch '^[0-9a-f]{64}$' -and $seen.Add($r)) `
            'Unsafe/duplicate manifest file'
        $source = Join-Path $path $r.Replace('/',[IO.Path]::DirectorySeparatorChar)
        Require-File $source
        Require ((Sha $source) -ceq $entry.sha256) 'Untrusted published binary hash'
    }
    Require ($seen.Contains('Service/MemoryReviewAuthority.LabService.exe') -and
        $seen.Contains('Operator/MemoryReviewAuthority.OperatorUi.exe')) `
        'Expected service/operator Windows executable missing'
    $all = @(Get-ChildItem -LiteralPath $path -Recurse -Force)
    foreach ($item in $all) {
        Require ((($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)) `
            'Package reparse point forbidden'
    }
    $count = @($all | Where-Object { $_ -is [IO.FileInfo] }).Count
    Require ($count -eq $files.Count + 1) 'Extra/missing package files'
    return $m
}
function Verify-Copy([string]$src, [string]$target, [string]$expectedHash) {
    Require-File $src
    Require ((Sha $src) -ceq $expectedHash) 'Source changed before copying'
    Copy-Item -LiteralPath $src -Destination $target -ErrorAction Stop
    Require ((Sha $target) -ceq $expectedHash) 'Source changed during protected copy'
}
function Set-File-Acl([string]$path, [object[]]$permissions) {
    # Use a new, explicitly protected FileSecurity rather than retaining
    # any source-ACL inheritance or owner metadata from user-writable input.
    $acl = [Security.AccessControl.FileSecurity]::new()
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner((SID 'S-1-5-32-544'))
    foreach ($p in $permissions) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            (SID $p[0]), $p[1],
            [Security.AccessControl.AccessControlType]::Allow))
    }
    Set-Acl -LiteralPath $path -AclObject $acl
    & (Join-Path $env:WINDIR 'System32/icacls.exe') $path '/inheritance:r' | Out-Null
    Require ($LASTEXITCODE -eq 0) 'Cannot disable inherited file permissions'
}
function Check-ServiceOwnership {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    Require ($null -ne $service) 'Preview service not installed'
    $settings = @( & $sc qc $serviceName 2>&1 )
    Require ($LASTEXITCODE -eq 0) 'Cannot inspect SCM identity'
    $asText = $settings -join ' '
    Require ($asText -match 'LocalService' -and $asText -match
        [regex]::Escape((Join-Path $root 'Service/MemoryReviewAuthority.LabService.exe'))) `
        'Existing SCM service has foreign owner/binary'
}
function Stop-And-Delete-Own-Service {
    $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $existing) { return }
    Check-ServiceOwnership
    & $sc stop $serviceName 2>$null | Out-Null
    for ($i = 0; $i -lt 35; $i++) {
        $result = @(& $sc query $serviceName 2>$null) -join ' '
        if ($result -notmatch 'RUNNING|STOP_PENDING') { break }
        Start-Sleep -Milliseconds 200
    }
    $status = @(& $sc query $serviceName 2>$null) -join ' '
    Require ($status -notmatch 'RUNNING|STOP_PENDING') 'Cannot stop own preview service'
    & $sc delete $serviceName | Out-Null
    Require ($LASTEXITCODE -eq 0) 'Cannot delete own preview service'
    for ($i = 0; $i -lt 35; $i++) {
        if ($null -eq (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) {
            return
        }
        Start-Sleep -Milliseconds 200
    }
    throw 'Preview service deletion not confirmed'
}
function Preserve-Protected-State([string]$sid = '') {
    if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) { return $null }
    $writers = @('S-1-5-18','S-1-5-32-544')
    if ($sid -match '^S-1-5-80-') { $writers += $sid }
    Inspect-Acl $stateRoot $writers
    $archive = Join-Path $env:ProgramData (
        'AgentHubMemoryReviewLab-Preserved-' + [guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $stateRoot -Destination $archive -ErrorAction Stop
    return $archive
}

if (-not [Environment]::Is64BitOperatingSystem -or
    -not [Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
        [Runtime.InteropServices.OSPlatform]::Windows)) {
    throw 'Windows x64 only'
}
if ($Action -eq 'Inspect') {
    [pscustomobject]@{
        action='InspectOnly'
        serviceExists=($null -ne (Get-Service -Name $serviceName -ErrorAction SilentlyContinue))
        applicationRootExists=(Test-Path -LiteralPath $root)
        stateExists=(Test-Path -LiteralPath $stateRoot)
        publicPinExists=(Test-Path -LiteralPath $publicRoot)
        productionWriteEnabled=$false
    } | ConvertTo-Json -Depth 3
    exit 0
}
Require (Is-Admin) 'Explicit elevated administrator console required for installation/removal'
Protected-Bootstrap-Required
if ($Action -eq 'Remove') {
    Require ($Consent -ceq 'REMOVE_AGENTHUB_MEMORY_REVIEW_ONLY_PREVIEW') `
        'Explicit removal phrase required'
    Require (Test-Path -LiteralPath $marker -PathType Leaf) `
        'Own install marker missing: never delete an unknown app'
    Inspect-Acl $root @('S-1-5-18','S-1-5-32-544')
    Inspect-Acl $marker @('S-1-5-18','S-1-5-32-544')
    $record = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
    Require ($record.format -ceq $format -and
        $record.service -ceq $serviceName -and
        $record.productionWriteEnabled -eq $false) `
        'Own preview state marker invalid'
    Check-ServiceOwnership
    $oldServiceSid = [Security.Principal.NTAccount]::new(
        'NT SERVICE',$serviceName).Translate(
        [Security.Principal.SecurityIdentifier]).Value
    Stop-And-Delete-Own-Service
    $saved = Preserve-Protected-State $oldServiceSid
    if (Test-Path -LiteralPath $publicRoot) {
        Inspect-Acl $publicRoot @('S-1-5-18','S-1-5-32-544')
        Remove-Item -LiteralPath $publicRoot -Recurse -Force
    }
    Remove-Item -LiteralPath $root -Recurse -Force
    [pscustomobject]@{
        status='preview_removed_service_deleted'
        statePreservedAt=$saved
        productionWriteEnabled=$false
    } | ConvertTo-Json
    exit 0
}
Require ($Action -eq 'Install') 'Unknown action'
Require ($Consent -ceq 'I_APPROVE_TEMPORARY_NO_WRITE_AGENTHUB_PREVIEW') `
    'Explicit temporary no-write Preview opt-in required'
Require (-not [string]::IsNullOrWhiteSpace($PackageDirectory) -and
    -not [string]::IsNullOrWhiteSpace($EvidenceExportDirectory) -and
    -not [string]::IsNullOrWhiteSpace($OperatorCredentialManifestPath)) `
    'Pinned package, real E~ snapshot and public credential source required'
$pkg = (Resolve-Path -LiteralPath $PackageDirectory).Path
$evidence = (Resolve-Path -LiteralPath $EvidenceExportDirectory).Path
$publicCredential = (Resolve-Path -LiteralPath $OperatorCredentialManifestPath).Path
$m = Verify-Package $pkg $ExpectedManifestSha256
$sourceEvidence = Join-Path $evidence $stateSource
$sourceManifest = Join-Path $evidence $stateManifest
Require-File $sourceEvidence 512MB
Require-File $sourceManifest 4096
Require-File $publicCredential 8192
$credentialPreview = Get-Content -LiteralPath $publicCredential -Raw |
    ConvertFrom-Json -ErrorAction Stop
Require ($credentialPreview.protocol -ceq 'agenthub-operator-credential-pin-v1') `
    'Only the unapproved public WebAuthn candidate manifest may be staged'
$requested = @($root,$stateRoot,$publicRoot)
foreach ($path in $requested) {
    Require (-not (Test-Path -LiteralPath $path)) `
        'Preview path already exists: refuse to touch or replace existing state'
}
Require ($null -eq (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) `
    'Refusing to modify any existing SCM service'
$evidenceDigest = Sha $sourceEvidence
$manifestDigest = Sha $sourceManifest
$credentialDigest = Sha $publicCredential
$serviceMade = $false
$machine = @(Machine-Permissions)
$program = @(Machine-And-ReadPermissions 'S-1-5-19')
try {
    Protect-Directory $root $machine
    Protect-Directory (Join-Path $root 'Service') $program
    Protect-Directory (Join-Path $root 'Operator') $machine
    foreach ($entry in @($m.files)) {
        $relative = [string]$entry.relativePath
        $src = Join-Path $pkg $relative.Replace('/',[IO.Path]::DirectorySeparatorChar)
        $dst = Join-Path $root $relative.Replace('/',[IO.Path]::DirectorySeparatorChar)
        $dir = Split-Path -Parent $dst
        if (-not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null
        }
        Verify-Copy $src $dst $entry.sha256
        $targetAcl = if ($relative.StartsWith('Service/')) { $program } else { $machine }
        Set-File-Acl $dst $targetAcl
    }
    $target = Join-Path $root 'Service/MemoryReviewAuthority.LabService.exe'
    & $sc create $serviceName binPath= $target start= demand `
        obj= 'NT AUTHORITY\LocalService' type= own | Out-Null
    Require ($LASTEXITCODE -eq 0) 'Cannot create isolated demand-start LocalService preview'
    $serviceMade = $true
    & $sc sidtype $serviceName restricted | Out-Null
    Require ($LASTEXITCODE -eq 0) 'Restricted per-service SID required'
    $serviceSid = [Security.Principal.NTAccount]::new(
        'NT SERVICE',$serviceName).Translate(
        [Security.Principal.SecurityIdentifier]).Value
    Require ($serviceSid.StartsWith('S-1-5-80-')) 'Expected exact service SID'
    $stateRights = @($machine + @(,@($serviceSid,
        [Security.AccessControl.FileSystemRights]::Modify)))
    Protect-Directory $stateRoot $stateRights
    Verify-Copy $sourceEvidence (Join-Path $stateRoot $stateSource) $evidenceDigest
    Verify-Copy $sourceManifest (Join-Path $stateRoot $stateManifest) $manifestDigest
    Verify-Copy $publicCredential (Join-Path $stateRoot $stateCredential) $credentialDigest
    foreach ($inputName in @($stateSource,$stateManifest,$stateCredential)) {
        Set-File-Acl (Join-Path $stateRoot $inputName) $stateRights
    }
    & $sc start $serviceName | Out-Null
    Require ($LASTEXITCODE -eq 0) 'Preview service start refused'
    $sourcePub = Join-Path $stateRoot 'review-service-signing-key.pub.pem'
    $private = Join-Path $stateRoot 'review-service-signing-key.pk8'
    for ($i=0; $i -lt 35; $i++) {
        if ((Test-Path -LiteralPath $sourcePub -PathType Leaf) -and
            (Test-Path -LiteralPath $private -PathType Leaf)) { break }
        Start-Sleep -Milliseconds 200
    }
    Require ((Test-Path -LiteralPath $sourcePub -PathType Leaf) -and
        (Test-Path -LiteralPath $private -PathType Leaf)) `
        'Restricted LocalService did not generate its own signer'
    $pubRights = @($machine + @(,@('S-1-5-32-545',
        [Security.AccessControl.FileSystemRights]::ReadAndExecute)))
    Protect-Directory $publicRoot $pubRights
    $pub = Join-Path $publicRoot 'review-service-signing-key.pub.pem'
    Verify-Copy $sourcePub $pub (Sha $sourcePub)
    Set-File-Acl $pub $pubRights
    Inspect-Acl $pub @('S-1-5-18','S-1-5-32-544')
    Inspect-Acl $publicRoot @('S-1-5-18','S-1-5-32-544')
    $record = [ordered]@{
        format=$format; service=$serviceName
        sha256=$ExpectedManifestSha256.ToLowerInvariant()
        commitSha=$m.commitSha; installedAt=(Get-Date).ToUniversalTime().ToString('O')
        originUnverified=$true
        humanApprovalVerified=$false
        productionWriteEnabled=$false
    }
    [IO.File]::WriteAllText($marker,
        (ConvertTo-Json -InputObject $record -Depth 4), [Text.UTF8Encoding]::new($false))
    Set-File-Acl $marker $machine
    [pscustomobject]@{
        status='temporary_restricted_operator_preview_ready'
        nativeOperatorExe=(Join-Path $root 'Operator/MemoryReviewAuthority.OperatorUi.exe')
        service=$serviceName
        humanApprovalVerified=$false
        claimsEnabled=$false
        uninstallAction='Remove'
    } | ConvertTo-Json -Depth 4
} catch {
    # Fail closed. Never leave a failed, privileged preview service running.
    # Privacy rule: every imported user SQLite copy is PRESERVED under the
    # same protected owner/DACL instead of being silently deleted.
    $knownSid = ''
    if ($serviceMade) {
        $knownSid = [Security.Principal.NTAccount]::new(
            'NT SERVICE',$serviceName).Translate(
            [Security.Principal.SecurityIdentifier]).Value
        Stop-And-Delete-Own-Service
    }
    $preserved = Preserve-Protected-State $knownSid
    foreach ($path in @($publicRoot,$root)) {
        if (Test-Path -LiteralPath $path) {
            Inspect-Acl $path @('S-1-5-18','S-1-5-32-544')
            Remove-Item -LiteralPath $path -Force -Recurse
        }
    }
    if ($null -ne $preserved) {
        Write-Warning ('Failed preview state preserved under protected ' + $preserved)
    }
    throw
}
