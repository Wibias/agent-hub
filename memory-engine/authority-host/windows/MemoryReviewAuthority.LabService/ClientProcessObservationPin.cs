using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using Microsoft.Win32.SafeHandles;

namespace MemoryReviewAuthority.LabService;

/// <summary>
/// WINDOWS-ONLY DIAGNOSTIC: correlates a named-pipe caller's KERNEL-supplied
/// process ID to a process handle captured by a trusted host at launch.
/// This does not authenticate code running *inside* that process and is
/// NOT a production Codex session authorization primitive.
/// No client-provided PID, path, SID or repository identifier is trusted.
/// </summary>
internal sealed class ClientProcessObservationPin : IDisposable
{
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint WaitTimeout = 0x102;
    private readonly SafeProcessHandle _processHandle;
    private readonly uint _processId;
    private readonly ulong _creationFileTime;
    private bool _disposed;

    private ClientProcessObservationPin(SafeProcessHandle handle, uint processId,
        ulong creationFileTime)
    {
        _processHandle = handle;
        _processId = processId;
        _creationFileTime = creationFileTime;
    }

    // This must be called by a trusted OS host with a process object it
    // launched itself, NEVER from a pipe/request-supplied PID.
    internal static ClientProcessObservationPin CaptureTrustedLaunch(Process launched)
    {
        ArgumentNullException.ThrowIfNull(launched);
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException();
        uint processId = checked((uint)launched.Id);
        if (processId == 0)
            throw new InvalidOperationException("process_observation_invalid_pid");
        var handle = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (handle.IsInvalid)
        {
            handle.Dispose();
            throw new InvalidOperationException("process_observation_open_failed");
        }
        try
        {
            if (WaitForSingleObject(handle, 0) != WaitTimeout
                || !TryReadCreationTime(handle, out var born))
                throw new InvalidOperationException("process_observation_not_live");
            // Holding the real kernel handle avoids accepting PID reuse.
            return new ClientProcessObservationPin(handle, processId, born);
        }
        catch
        {
            handle.Dispose();
            throw;
        }
    }

    internal bool MatchesConnectedClient(NamedPipeServerStream pipe)
    {
        ArgumentNullException.ThrowIfNull(pipe);
        if (_disposed || !pipe.IsConnected)
            return false;
        try
        {
            // This ID comes from Windows kernel pipe metadata, NOT the
            // bytes read from the client or an impersonated JSON claim.
            return GetNamedPipeClientProcessId(pipe.SafePipeHandle, out var kernelPid)
                && kernelPid == _processId
                && kernelPid != 0
                && WaitForSingleObject(_processHandle, 0) == WaitTimeout
                && TryReadCreationTime(_processHandle, out var liveBorn)
                && liveBorn == _creationFileTime;
        }
        catch (Exception error) when (error is IOException
            or ObjectDisposedException or InvalidOperationException)
        {
            return false;
        }
    }

    internal bool PinnedProcessStillLive()
    {
        if (_disposed) return false;
        return WaitForSingleObject(_processHandle, 0) == WaitTimeout
            && TryReadCreationTime(_processHandle, out var liveBorn)
            && liveBorn == _creationFileTime;
    }

    private static bool TryReadCreationTime(SafeProcessHandle handle, out ulong time)
    {
        time = 0;
        if (!GetProcessTimes(handle, out var created, out _, out _, out _))
            return false;
        time = ((ulong)(uint)created.dwHighDateTime << 32)
            | (uint)created.dwLowDateTime;
        return time != 0;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _processHandle.Dispose();
    }

    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    private static extern SafeProcessHandle OpenProcess(
        uint access, [MarshalAs(UnmanagedType.Bool)] bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(
        SafePipeHandle pipe, out uint clientProcessId);

    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessTimes(SafeProcessHandle handle,
        out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);

    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    private static extern uint WaitForSingleObject(SafeProcessHandle handle, uint timeoutMs);
}
