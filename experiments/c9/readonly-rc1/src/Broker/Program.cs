#if AGENTHUB_C9_LAB_COMMIT
#error A C9 READ-ONLY SOURCE CANDIDATE MUST NEVER COMPILE WITH LAB COMMIT ENABLED
#endif
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace AgentHub.LaneB;

internal static class Program
{
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate void ServiceMainProc(uint argc, IntPtr argv);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate void HandlerProc(uint control);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ServiceTableEntry
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string? Name;
        [MarshalAs(UnmanagedType.FunctionPtr)] public ServiceMainProc? Entry;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus
    {
        public uint ServiceType;
        public uint CurrentState;
        public uint ControlsAccepted;
        public uint Win32ExitCode;
        public uint ServiceSpecificExitCode;
        public uint CheckPoint;
        public uint WaitHint;
    }

    private const uint ServiceStopped = 1;
    private const uint ServiceStartPending = 2;
    private const uint ServiceStopPending = 3;
    private const uint ServiceRunning = 4;
    private static SafeFileHandle? currentPipe;
    private static IntPtr statusHandle;
    private static bool stopping;
    private static readonly bool ServiceActivationAuthorized = false;
    private static readonly ServiceMainProc mainDelegate = ServiceMain;
    private static readonly HandlerProc controlDelegate = Control;

    [DllImport("advapi32.dll", EntryPoint="StartServiceCtrlDispatcherW", CharSet=CharSet.Unicode, SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool StartServiceCtrlDispatcher([In] ServiceTableEntry[] services);

    [DllImport("advapi32.dll", EntryPoint="RegisterServiceCtrlHandlerW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern IntPtr RegisterServiceCtrlHandler(string serviceName, HandlerProc handler);

    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetServiceStatus(IntPtr handle, ref ServiceStatus status);

    private static void Report(uint state, uint error = 0)
    {
        var status = new ServiceStatus {
            ServiceType = 0x10,
            CurrentState = state,
            ControlsAccepted = state == ServiceRunning ? 1u : 0u,
            Win32ExitCode = error,
            CheckPoint = state == ServiceStartPending ? 1u : 0u,
            WaitHint = state == ServiceStartPending ? 10000u : 0u
        };
        if (statusHandle != IntPtr.Zero && !SetServiceStatus(statusHandle, ref status))
            throw Native.LastError("SetServiceStatus");
    }

    private static void Control(uint code)
    {
        if (code != 1) return;
        stopping = true;
        try { Report(ServiceStopPending); } catch (Exception) { }
        SafeFileHandle? pipe = currentPipe;
        if (pipe != null && !pipe.IsClosed) Native.CancelIoEx(pipe, IntPtr.Zero);
    }

    private static void HandleConnection(SafeFileHandle pipe)
    {
        // This is deliberately a one-client, one-read read-only candidate.
        byte[] frame = new byte[128];
        if (!Native.ReadFile(pipe, frame, (uint)frame.Length, out uint count, IntPtr.Zero) || count == 0)
            throw Native.LastError("ReadFile(pipe)");
        if (!TokenProof.CheckClientAfterRead(pipe))
            throw new UnauthorizedAccessException("CLIENT_SERVICE_TOKEN_DENIED");
        // No request parsing, writing, or logging occurs under impersonation.
        byte[] response = BrokerRequestRouter.Evaluate(frame.AsSpan(0, checked((int)count)));
        if (!Native.WriteFile(pipe, response, (uint)response.Length, out uint written, IntPtr.Zero) ||
            written != (uint)response.Length)
            throw Native.LastError("WriteFile(pipe)");
        Native.FlushFileBuffers(pipe);
        Native.DisconnectNamedPipe(pipe);
    }

    private static void ServiceMain(uint argc, IntPtr argv)
    {
        statusHandle = RegisterServiceCtrlHandler(BrokerIdentity.BrokerServiceName, controlDelegate);
        if (statusHandle == IntPtr.Zero) return;
        uint exitCode = 0;
        try
        {
            Report(ServiceStartPending);
            TokenProof.CheckBrokerProcess();
            using SafeFileHandle pipe = Native.CreateRestrictedPipe();
            currentPipe = pipe;
            Report(ServiceRunning);
            if (!Native.ConnectNamedPipe(pipe, IntPtr.Zero))
            {
                int error = Marshal.GetLastWin32Error();
                if (error != 535 && !stopping)
                    throw new Win32Exception(error, "ConnectNamedPipe failed");
            }
            if (!stopping) HandleConnection(pipe);
        }
        catch (Exception) { exitCode = 1066; }
        finally
        {
            currentPipe = null;
            try { Report(ServiceStopped, exitCode); } catch (Exception) { }
        }
    }

    private static int Selftest()
    {
        if (!ReadOnlyPolicy.IsApprovedPing("AHB1|PING"u8)) return 21;
        if (ReadOnlyPolicy.IsApprovedPing("AHB1|APPLY"u8)) return 22;
        if (ReadOnlyPolicy.IsApprovedPing("AHB1|PING!"u8)) return 23;
        string denied = Encoding.UTF8.GetString(ReadOnlyPolicy.Evaluate("AHB1|APPLY"u8));
        if (!denied.Contains("NOT_COMMITTED", StringComparison.Ordinal) ||
            !denied.Contains("false", StringComparison.Ordinal)) return 24;
        // Always deny the legacy APPLY route, including in the opt-in lab build.
        if (!BrokerRequestRouter.IsLegacyApplyDenied("AHB1|APPLY"u8)) return 25;
        if (BrokerRequestRouter.IsLabCommitCommand("AHB2|LAB_COMMIT|success!"u8)) return 26;
        if (BrokerRequestRouter.IsLabCommitCommand("AHB2|LAB_COMMIT|success"u8)) return 29;
        string labDenied = Encoding.UTF8.GetString(BrokerRequestRouter.Evaluate("AHB2|LAB_COMMIT|success"u8));
        if (!labDenied.Contains("NOT_COMMITTED", StringComparison.Ordinal) ||
            !labDenied.Contains("false", StringComparison.Ordinal)) return 30;
        Console.WriteLine("C9_READ_ONLY_SOURCE_RC_COMMIT_DENY_PASS");
        Console.WriteLine("LANE_B_READ_ONLY_SELFTEST_PASS (no native service operations)");
        return 0;
    }

    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows() || !Environment.Is64BitProcess) return 11;
        if (args.Length != 1) return 12;
        if (args[0] == "--selftest") return Selftest();
        if (args[0] != "--service") return 12;
        // Review-only release invariant: no Windows service may be started.
        if (!ServiceActivationAuthorized)
        {
            Console.Error.WriteLine("C9_REVIEW_SOURCE_SERVICE_DISABLED");
            return 32;
        }
        try
        {
            if (!StartServiceCtrlDispatcher(new[] {
                new ServiceTableEntry { Name=BrokerIdentity.BrokerServiceName, Entry=mainDelegate },
                new ServiceTableEntry { Name=null, Entry=null }
            })) throw Native.LastError("StartServiceCtrlDispatcher");
            return 0;
        }
        catch (Exception) { return 13; }
    }
}
