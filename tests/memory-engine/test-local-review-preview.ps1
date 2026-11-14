# Genuine Windows SCM local opt-in Preview test. CI ONLY.
# Invokes the SAME protected bootstrap, package, fixed service and native
# operator UI that a human may later explicitly install. Never approves Claim.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or
    [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
    throw 'Temporary local preview integration is GitHub Windows runner only'
}
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$prepareScript = Join-Path $repo 'scripts/prepare-memory-review-local-preview.ps1'
$originalInstaller = Join-Path $repo 'scripts/install-memory-review-local-preview.ps1'
$pkg = Join-Path $env:RUNNER_TEMP 'AgentHubReviewPreview-Package'
$export = Join-Path $env:RUNNER_TEMP 'AgentHubReviewPreview-EvidenceExport'
$bootstrap = Join-Path $env:ProgramData 'AgentHubMemoryReviewLab-Bootstrap'
$installed = Join-Path $env:ProgramData 'AgentHubMemoryReviewLab-PreviewApp'
$state = Join-Path $env:ProgramData 'AgentHubMemoryReviewLab-State'
$pub = Join-Path $env:ProgramData 'AgentHubMemoryReviewLab-Public'
$service = 'AgentHubMemoryReviewLab'
if ((Get-Service -Name $service -ErrorAction SilentlyContinue) -or
    (Test-Path -LiteralPath $bootstrap) -or
    (Test-Path -LiteralPath $installed) -or
    (Test-Path -LiteralPath $state) -or
    (Test-Path -LiteralPath $pub) -or
    (Test-Path -LiteralPath $pkg) -or
    (Test-Path -LiteralPath $export)) {
    throw 'CI must not overwrite an existing service, state, bootstrap or package'
}
$installer = $null
$installedSuccessfully = $false
$removed = $false
try {
    & $prepareScript -Action Prepare -PackageDirectory $pkg -RepositoryDirectory $repo
    if ($LASTEXITCODE -ne 0) { throw 'Preview package preparation failed' }
    $manifestPath = Join-Path $pkg 'operator-preview-package.json'
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $verified = & $prepareScript -Action Verify -PackageDirectory $pkg |
        ConvertFrom-Json
    if ($verified.packageManifestSha256 -cne $manifestHash -or
        $verified.claimsEnabled -or $verified.serviceInstalled) {
        throw 'Untrusted local preview bundle manifest'
    }
    & node (Join-Path $repo 'tests/memory-engine/create-operator-evidence-scm-fixture.mjs') --preview-export $export
    if ($LASTEXITCODE -ne 0) { throw 'Real Git/E~ local preview export fixture failed' }
    $credential = Join-Path $export 'operator-webauthn-credential.json'

    # Must reject an elevated installer launched from the agent-writable
    # Git checkout. Never use this form on the operator's real PC.
    $untrustedScriptDenied = $false
    try {
        & $originalInstaller -Action Install -PackageDirectory $pkg `
            -ExpectedManifestSha256 $manifestHash -EvidenceExportDirectory $export `
            -OperatorCredentialManifestPath $credential `
            -Consent 'I_APPROVE_TEMPORARY_NO_WRITE_AGENTHUB_PREVIEW' *> $null
    } catch {
        $untrustedScriptDenied = $_.Exception.Message -match 'agent-writable checkout'
    }
    if (-not $untrustedScriptDenied) {
        throw 'Unprotected elevated Git script execution was not denied'
    }
    if (Test-Path -LiteralPath $state) {
        throw 'Untrusted installer created privileged state'
    }

    # GitHub runner is ephemeral Administrator. Pin the script into an
    # Admin-owned protected ProgramData directory via trusted OS APIs
    # BEFORE invoking its Install action.
    New-Item -ItemType Directory -Path $bootstrap | Out-Null
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $adminSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $propagate = [Security.AccessControl.PropagationFlags]::None
    $acl = Get-Acl -LiteralPath $bootstrap
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner($adminSid)
    foreach ($ace in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($ace) }
    foreach ($sid in @($adminSid,$systemSid)) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $sid,[Security.AccessControl.FileSystemRights]::FullControl,
            $inherit,$propagate,$allow))
    }
    Set-Acl -LiteralPath $bootstrap -AclObject $acl
    $installer = Join-Path $bootstrap 'install-memory-review-local-preview.ps1'
    Copy-Item -LiteralPath $originalInstaller -Destination $installer
    $fileAcl = Get-Acl -LiteralPath $installer
    $fileAcl.SetAccessRuleProtection($true,$false)
    $fileAcl.SetOwner($adminSid)
    foreach ($ace in @($fileAcl.Access)) { [void]$fileAcl.RemoveAccessRuleSpecific($ace) }
    foreach ($sid in @($adminSid,$systemSid)) {
        $fileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $sid,[Security.AccessControl.FileSystemRights]::FullControl,$allow))
    }
    Set-Acl -LiteralPath $installer -AclObject $fileAcl
    if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -cne
        (Get-FileHash -LiteralPath $originalInstaller -Algorithm SHA256).Hash) {
        throw 'Protected bootstrap was tampered with during pinning'
    }

    $badPinDenied = $false
    try {
        & $installer -Action Install -PackageDirectory $pkg `
            -ExpectedManifestSha256 ('0' * 64) -EvidenceExportDirectory $export `
            -OperatorCredentialManifestPath $credential `
            -Consent 'I_APPROVE_TEMPORARY_NO_WRITE_AGENTHUB_PREVIEW' *> $null
    } catch {
        $badPinDenied = $_.Exception.Message -match 'SHA mismatch'
    }
    if (-not $badPinDenied -or (Test-Path -LiteralPath $state)) {
        throw 'Wrong expected package-manifest SHA did not fail closed'
    }

    $result = & $installer -Action Install -PackageDirectory $pkg `
        -ExpectedManifestSha256 $manifestHash -EvidenceExportDirectory $export `
        -OperatorCredentialManifestPath $credential `
        -Consent 'I_APPROVE_TEMPORARY_NO_WRITE_AGENTHUB_PREVIEW' |
        ConvertFrom-Json
    if ($result.status -cne 'temporary_restricted_operator_preview_ready' -or
        $result.claimsEnabled -or $result.humanApprovalVerified -or
        -not (Test-Path -LiteralPath $result.nativeOperatorExe -PathType Leaf)) {
        throw 'Protected local preview install did not establish correct no-Claim state'
    }
    $installedSuccessfully = $true
    Write-Host 'PASS: pinned manifest + Administrator-protected service and native UI installed from actual clean Git package, NO Claim'

    # Run the ACTUAL installed native WinForms binary against the ACTUAL
    # restricted LocalService and protected signing pin. No Hello/prompt in CI.
    $native = Start-Process -FilePath $result.nativeOperatorExe `
        -ArgumentList @('--service-smoke') -Wait -PassThru -NoNewWindow
    if ($native.ExitCode -ne 0) {
        throw 'Installed native UI failed to verify service-signed real E~'
    }
    Write-Host 'PASS: installed, admin-owned native UI authenticates signed real E~ over restricted SCM pipe, no Hello, no approval'

    $uninstall = & $installer -Action Remove `
        -Consent 'REMOVE_AGENTHUB_MEMORY_REVIEW_ONLY_PREVIEW' |
        ConvertFrom-Json
    $removed = $true
    if ($uninstall.status -cne 'preview_removed_service_deleted' -or
        -not (Test-Path -LiteralPath $uninstall.statePreservedAt -PathType Container) -or
        (Get-Service -Name $service -ErrorAction SilentlyContinue) -or
        (Test-Path -LiteralPath $installed) -or
        (Test-Path -LiteralPath $state) -or
        (Test-Path -LiteralPath $pub)) {
        throw 'Local preview uninstall/backup cleanup incomplete'
    }
    $archiveAcl = Get-Acl -LiteralPath $uninstall.statePreservedAt
    if (-not $archiveAcl.AreAccessRulesProtected -or
        $archiveAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne
            'S-1-5-32-544') {
        throw 'Sensitive E~ snapshot backup lost protected owner/DACL'
    }
    Write-Host 'PASS: exact own Windows preview service deleted, executable/public pin removed, source Evidence/SQLite preserved under protected owner/DACL'
    Write-Host 'LOCAL_REVIEW_PREVIEW_WINDOWS_SCM PASS: protected_install native_signed_E_source_hash_pin_wrong_key_deny untrusted_bootstrap_deny no_claim backup_uninstall'
} finally {
    if ($installedSuccessfully -and -not $removed) {
        try {
            & $installer -Action Remove `
                -Consent 'REMOVE_AGENTHUB_MEMORY_REVIEW_ONLY_PREVIEW' | Out-Null
        } catch {
            Write-Warning 'CI cleanup failed; ephemeral runner discarded'
        }
    }
    if (Test-Path -LiteralPath $bootstrap) {
        Remove-Item -LiteralPath $bootstrap -Force -Recurse -ErrorAction Stop
    }
    # Preserved private Memory state is intentionally not deleted by the
    # product. Github-hosted VM is disposable; no persistent operator data.
}
