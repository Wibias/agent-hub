# External, read-only Windows client capture for design-with-ai.
# Produces RAW observation artifacts, not a schema-v2 DWA certification.
# Requires an interactive desktop; the target must be visible and unobscured.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$TargetPid,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$OutputDirectory,
    [ValidateRange(1, 5000)][int]$MaxElements = 1200
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Native window capture requires Windows.' }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct DwaCapturePoint { public int X; public int Y; }

[StructLayout(LayoutKind.Sequential)]
public struct DwaCaptureRect { public int Left; public int Top; public int Right; public int Bottom; }

public static class DwaCaptureNative {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetClientRect(IntPtr hwnd, out DwaCaptureRect rect);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool ClientToScreen(IntPtr hwnd, ref DwaCapturePoint point);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@

# Use per-monitor-v2 awareness when the host allows it. Never silently
# substitute logical coordinates for a claimed physical-pixel measurement.
$previousDpiContext = [DwaCaptureNative]::SetThreadDpiAwarenessContext([IntPtr](-4))
if ($previousDpiContext -eq [IntPtr]::Zero) {
    throw 'Cannot establish per-monitor DPI-aware capture coordinates.'
}

try {
    $process = Get-Process -Id $TargetPid -ErrorAction Stop
    $hwnd = [IntPtr]$process.MainWindowHandle
    if ($hwnd -eq [IntPtr]::Zero) { throw 'Target has no visible main window HWND.' }
    if (-not [DwaCaptureNative]::IsWindowVisible($hwnd) -or [DwaCaptureNative]::IsIconic($hwnd)) {
        throw 'Target window is hidden or minimized; make it visible before capture.'
    }

    $client = New-Object DwaCaptureRect
    $origin = New-Object DwaCapturePoint
    if (-not [DwaCaptureNative]::GetClientRect($hwnd, [ref]$client) -or
        -not [DwaCaptureNative]::ClientToScreen($hwnd, [ref]$origin)) {
        throw 'Cannot read target client coordinates.'
    }
    $width = $client.Right - $client.Left
    $height = $client.Bottom - $client.Top
    if ($width -lt 320 -or $height -lt 240 -or $width -gt 10000 -or $height -gt 10000) {
        throw "Invalid client capture size: $width x $height."
    }
    $dpi = [DwaCaptureNative]::GetDpiForWindow($hwnd)
    if ($dpi -lt 48 -or $dpi -gt 768) { throw "Invalid target window DPI: $dpi." }

    Add-Type -AssemblyName System.Drawing
    $directory = [IO.Path]::GetFullPath($OutputDirectory)
    [void](New-Item -ItemType Directory -Path $directory -Force)
    $captureId = (Get-Date -Format 'yyyyMMddTHHmmssfff') + '-' +
        [guid]::NewGuid().ToString('N').Substring(0, 8)
    $pngName = 'native-client-' + $captureId + '.png'
    $jsonName = 'native-client-' + $captureId + '.json'
    $pngPath = Join-Path $directory $pngName
    $jsonPath = Join-Path $directory $jsonName

    # CopyFromScreen captures the visible desktop. It cannot attest that
    # another window did not occlude the target; inspect the resulting pixels.
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CopyFromScreen(
                $origin.X, $origin.Y, 0, 0,
                [System.Drawing.Size]::new($width, $height),
                [System.Drawing.CopyPixelOperation]::SourceCopy)
        } finally {
            $graphics.Dispose()
        }
        $bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $bitmap.Dispose()
    }

    $nodes = [System.Collections.Generic.List[object]]::new()
    $automationStatus = 'NOT_AVAILABLE'
    $automationError = $null
    try {
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
        if ($null -eq $root) { throw 'UI Automation root unavailable.' }
        $elements = $root.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.Condition]::TrueCondition)
        $automationStatus = 'AVAILABLE'
        foreach ($element in $elements) {
            if ($nodes.Count -ge $MaxElements) {
                $automationStatus = 'TRUNCATED'
                break
            }
            try {
                $current = $element.Current
                $r = $current.BoundingRectangle
                if ([double]::IsNaN($r.X) -or [double]::IsInfinity($r.X) -or
                    $r.Width -le 0 -or $r.Height -le 0) { continue }
                $nodes.Add([ordered]@{
                    automationId = $current.AutomationId
                    controlType = $current.ControlType.ProgrammaticName
                    name = $current.Name
                    boundingRectScreenRaw = @($r.X, $r.Y, $r.Width, $r.Height)
                })
            } catch {
                # Stale UIA nodes are common in live updating process tables.
                continue
            }
        }
    } catch {
        $automationStatus = 'INACCESSIBLE'
        $automationError = $_.Exception.Message
    }

    $hash = (Get-FileHash -LiteralPath $pngPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $observation = [ordered]@{
        format = 'DWA_NATIVE_EXTERNAL_OBSERVATION'
        status = 'RAW_NOT_CERTIFIED'
        capturedAt = (Get-Date).ToUniversalTime().ToString('o')
        processId = $TargetPid
        client = @{
            screenOrigin = @($origin.X, $origin.Y)
            width = $width
            height = $height
            coordinateSystem = 'WINDOW_CLIENT_PHYSICAL_PIXELS'
        }
        dpi = @{
            getDpiForWindow = [int]$dpi
            windowDpiPercent = [math]::Round(100.0 * $dpi / 96.0, 2)
            source = 'GetDpiForWindow'
        }
        screenshot = @{ path = $pngName; sha256 = $hash; occlusionVerified = $false }
        uiAutomation = @{
            status = $automationStatus
            error = $automationError
            elements = $nodes.ToArray()
            coordinateSystem = 'UIA_SCREEN_RAW'
        }
        unverified = @(
            'Exact custom-drawn glyph bounds and KPI text baseline',
            'Native chart model sampling metadata',
            'UIA and screenshot coordinate-space equivalence',
            'Screenshot visibility/occlusion',
            'Viewport identity, state and independent render review',
            'Different-DPI SCALED profile and DWA schema-v2 completion'
        )
        note = 'External, read-only observation. No changes made to target app. Do not use as a schema-v2 manifest without separate evidence reconciliation.'
    }
    $json = $observation | ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText($jsonPath, $json, [Text.UTF8Encoding]::new($false))
    Write-Output $jsonPath
} finally {
    [void][DwaCaptureNative]::SetThreadDpiAwarenessContext($previousDpiContext)
}
