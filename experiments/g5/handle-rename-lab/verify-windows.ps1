# Windows x64, administrative ephemeral CI runner only. Never targets user or production paths.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $IsWindows) { throw 'This lab requires Windows.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'An isolated administrative Windows test runner is required to register a temporary LocalService task.'
}
$volume = Get-Volume -DriveLetter ([IO.Path]::GetPathRoot($env:ProgramData).Substring(0, 1))
if ($volume.FileSystem -ne 'NTFS') { throw 'The lab requires an NTFS test volume.' }

$project = Join-Path $PSScriptRoot 'G5.HandleRenameLab.csproj'
$output = Join-Path $PSScriptRoot 'out'
dotnet publish $project -c Release -r win-x64 --self-contained false -p:UseAppHost=true -o $output
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed.' }
$binary = Join-Path $output 'G5.HandleRenameLab.exe'
if (-not (Test-Path $binary)) { throw 'Published apphost missing.' }
Write-Output "G5_SDK=$(dotnet --version)"
Write-Output "G5_BINARY_SHA256=$((Get-FileHash $binary -Algorithm SHA256).Hash)"

$unique = [guid]::NewGuid().ToString('N')
$root = Join-Path $env:ProgramData "AgentHub-G5-Lab-$unique"
$task = "AgentHub-G5-Lab-$unique"
$registered = $false
$writerSid = $identity.User.Value

function Invoke-Acl([string[]]$Arguments) {
    & icacls.exe @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls failed: $($Arguments -join ' ')" }
}
function Invoke-Program([string[]]$Arguments) {
    & $script:labExe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Lab program failed: $($Arguments[0])" }
}
function Assert-Content([string]$Path, [string]$Expected) {
    $actual = [IO.File]::ReadAllText($Path)
    if ($actual -cne $Expected) { throw "Unexpected target content (expected $Expected)." }
}

try {
    New-Item -ItemType Directory -Path $root | Out-Null
    # Root: writer + privileged administrators, LocalService traverse/read only.
    Invoke-Acl -Arguments @($root, '/inheritance:r', '/grant:r',
        "*$($writerSid):(OI)(CI)(F)", '*S-1-5-18:(OI)(CI)(F)',
        '*S-1-5-32-544:(OI)(CI)(F)', '*S-1-5-19:(RX)')
    $protected = Join-Path $root 'protected'
    $staging = Join-Path $root 'staging'
    $probe = Join-Path $root 'probe'
    $bin = Join-Path $root 'bin'
    foreach ($dir in @($protected, $staging, $probe, $bin)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
    }
    # Only the adversary's own probe and binary directories grant it extra rights.
    Invoke-Acl -Arguments @($probe, '/grant:r', '*S-1-5-19:(OI)(CI)(M)')
    Invoke-Acl -Arguments @($bin, '/grant:r', '*S-1-5-19:(OI)(CI)(RX)')
    Copy-Item -Path (Join-Path $output '*') -Destination $bin -Recurse -Force
    $labExe = Join-Path $bin 'G5.HandleRenameLab.exe'
    $target = Join-Path $protected 'payload.txt'
    [IO.File]::WriteAllText($target, 'BASE')
    Write-Output 'G5_TARGET_ACL:'
    & icacls.exe $protected

    # Test 1: the sole authorized writer commits through open source/directory handles.
    Invoke-Program -Arguments @('commit', (Join-Path $staging 'first.tmp'), $protected, 'payload.txt', 'NEW')
    Assert-Content $target 'NEW'
    Write-Output 'G5_TEST_1_COMMIT_PASS'

    # Test 2: an actual LocalService process tries to replace the same target.
    $receipt = Join-Path $probe 'attack-receipt.txt'
    $action = New-ScheduledTaskAction -Execute $labExe -Argument ('attack "{0}" "{1}" "{2}"' -f $probe, $target, $receipt)
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
    Register-ScheduledTask -TaskName $task -Action $action -Principal $taskPrincipal -Settings $settings -Force | Out-Null
    $registered = $true
    Start-ScheduledTask -TaskName $task
    $completed = $false
    for ($i = 0; $i -lt 80; $i++) {
        $state = (Get-ScheduledTask -TaskName $task).State
        if ((Test-Path $receipt) -and $state -ne 'Running') {
            $completed = $true
            break
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $completed) { throw 'LocalService task did not produce a completed receipt.' }
    $result = [IO.File]::ReadAllText($receipt)
    $lastResult = (Get-ScheduledTaskInfo -TaskName $task).LastTaskResult
    if ($lastResult -ne 0 -or $result -cne 'ATTACK_DENIED_ACCESS_5') {
        throw "LocalService denial unproven: task=$lastResult receipt=$result"
    }
    Assert-Content $target 'NEW'
    Write-Output 'G5_TEST_2_LOCAL_SERVICE_REPLACE_DENIED_PASS'

    # Test 3: a separate invocation flushes staging and exits before the rename;
    # the next invocation discards the orphan and safely performs a new commit.
    $orphan = Join-Path $staging 'interrupted.tmp'
    Invoke-Program -Arguments @('prepare', $orphan, 'PARTIAL')
    if (-not (Test-Path $orphan)) { throw 'No interrupted staging file.' }
    Assert-Content $target 'NEW'
    Invoke-Program -Arguments @('recover', $orphan)
    if (Test-Path $orphan) { throw 'Orphaned staging file remains.' }
    Invoke-Program -Arguments @('commit', (Join-Path $staging 'retry.tmp'), $protected, 'payload.txt', 'RECOVERED')
    Assert-Content $target 'RECOVERED'
    Write-Output 'G5_TEST_3_PROCESS_RESTART_PASS'
    Write-Output 'G5_LAB_3_OF_3_PASS PRODUCTION_NO_GO'
}
finally {
    if ($registered) {
        Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
    }
    if (Test-Path $root) { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}
