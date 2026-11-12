using System.ComponentModel;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;
using AgentHub.C9.G2;
using Microsoft.Win32.SafeHandles;

namespace AgentHub.C9.G2.ServiceLab;

// Ephemeral, non-production test service ONLY. It never starts the real C9 broker,
// creates a privileged target or exposes a write-capable operation.
internal static class Program
{
    private const string BrokerName = "AgentHubEG4528JournalBroker";
    private const string ClientName = "AgentHubD121417ScratchSvc";
    private const int ServiceStopped = 1;
    private const int ServiceStartPending = 2;
    private const int ServiceRunning = 4;
    private const uint ServiceAcceptStop = 1;

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate void ServiceMainDelegate(uint argc, IntPtr argv);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate void HandlerDelegate(uint control);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ServiceEntry
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string? Name;
        [MarshalAs(UnmanagedType.FunctionPtr)] public ServiceMainDelegate? Main;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus
    {
        public uint ServiceType;
        public uint CurrentState;
        public uint ControlsAccepted;
        public uint Win32ExitCode;
        public uint ServiceSpecificExitCode;
        public uint Checkpoint;
        public uint WaitHint;
    }

    [DllImport("advapi32.dll", EntryPoint = "StartServiceCtrlDispatcherW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool StartDispatcher([In] ServiceEntry[] entries);

    [DllImport("advapi32.dll", EntryPoint = "RegisterServiceCtrlHandlerW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr RegisterHandler(string name, HandlerDelegate callback);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetServiceStatus(IntPtr handle, ref ServiceStatus value);

    [DllImport("kernel32.dll", EntryPoint = "ReadFile", SetLastError = true, ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReadNative(SafePipeHandle pipe, byte[] buffer, uint length,
        out uint count, IntPtr overlapped);

    private static readonly ServiceMainDelegate MainCallback = ServiceMain;
    private static readonly HandlerDelegate StopCallback = Control;
    private static IntPtr statusHandle;
    private static NamedPipeServerStream? activePipe;
    private static bool stopRequested;
    private static string role = "";
    private static string pipeName = "";
    private static string resultDirectory = "";

    private static int Main(string[] args)
    {
        // There is deliberately no console or production service mode.
        if (!OperatingSystem.IsWindows() || !Environment.Is64BitProcess ||
            args.Length != 4 || args[0] != "--isolated-g2-lab" ||
            args[1] is not ("broker" or "client") ||
            !args[2].StartsWith("c9-g2-two-svc-", StringComparison.Ordinal) ||
            args[2].Length is < 20 or > 75 ||
            args[2].Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-') ||
            !Path.IsPathFullyQualified(args[3]) ||
            !Directory.Exists(args[3]) ||
            !Path.GetFileName(args[3]).StartsWith("AgentHub-C9-G2-Disposable-", StringComparison.Ordinal))
            return 76;
        role = args[1]; pipeName = args[2]; resultDirectory = args[3];
        string name = role == "broker" ? BrokerName : ClientName;
        return StartDispatcher([
            new ServiceEntry { Name = name, Main = MainCallback },
            new ServiceEntry { Name = null, Main = null }
        ]) ? 0 : Marshal.GetLastWin32Error();
    }

    private static void Report(int state, uint error = 0)
    {
        var status = new ServiceStatus {
            ServiceType = 0x10, // SERVICE_WIN32_OWN_PROCESS, one SID per process
            CurrentState = (uint)state,
            ControlsAccepted = state == ServiceRunning ? ServiceAcceptStop : 0,
            Win32ExitCode = error,
            Checkpoint = state == ServiceStartPending ? 1u : 0u,
            WaitHint = state == ServiceStartPending ? 10000u : 0u
        };
        if (!SetServiceStatus(statusHandle, ref status))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "G2_SERVICE_STATUS_FAILED");
    }

    private static void Control(uint command)
    {
        if (command != 1) return;
        stopRequested = true;
        try { activePipe?.Dispose(); } catch (IOException) { }
    }

    private static void ServiceMain(uint argc, IntPtr argv)
    {
        string name = role == "broker" ? BrokerName : ClientName;
        statusHandle = RegisterHandler(name, StopCallback);
        if (statusHandle == IntPtr.Zero) return;
        uint code = 0;
        try
        {
            Report(ServiceStartPending);
            Report(ServiceRunning);
            if (role == "broker") RunBroker();
            else RunClient();
            if (stopRequested) throw new InvalidOperationException("G2_SERVICE_STOP_REQUESTED");
        }
        catch (Exception e)
        {
            code = 1066;
            try { File.WriteAllText(Path.Combine(resultDirectory, role + ".failure"), e.ToString()); }
            catch { /* Never claim a pass if failure report cannot be written. */ }
        }
        finally
        {
            activePipe = null;
            try { Report(ServiceStopped, code); } catch { }
        }
    }

    private static void WriteResult(string file, LabReceipt value)
    {
        string path = Path.Combine(resultDirectory, file);
        string temporary = path + ".pending";
        using (var fs = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write,
            FileShare.None, 4096, FileOptions.WriteThrough))
        {
            JsonSerializer.Serialize(fs, value);
            fs.Flush(flushToDisk: true);
        }
        File.Move(temporary, path);
    }

    private static void RunBroker()
    {
        KernelTokenSnapshot own = G2KernelIdentity.SnapshotProcess();
        using var server = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1,
            PipeTransmissionMode.Byte, PipeOptions.None);
        activePipe = server;
        // An explicit timeout avoids hanging the SCM when client setup fails.
        Task connection = Task.Run(server.WaitForConnection);
        if (!connection.Wait(TimeSpan.FromSeconds(25)) || !server.IsConnected)
        {
            server.Dispose();
            throw new TimeoutException("G2_CLIENT_DID_NOT_CONNECT");
        }
        byte[] message = new byte[1];
        bool read = ReadNative(server.SafePipeHandle, message, 1,
            out uint count, IntPtr.Zero) && count == 1 && message[0] == 0x47;
        // Immediately impersonate after ReadFile on this exact native thread.
        KernelTokenSnapshot? client = read
            ? G2KernelIdentity.SnapshotClientAfterRead(server.SafePipeHandle) : null;
        bool reverted = G2KernelIdentity.ThreadIsUnimpersonated();
        bool brokerOk = G2KernelIdentity.BrokerIsExpectedService(own);
        bool clientOk = G2KernelIdentity.ClientIsExpectedService(client);
        bool allowed = read && brokerOk && clientOk && reverted;
        WriteResult("broker.json", new LabReceipt(role, own.UserSid,
            own.EnabledGroupSids.ToArray(), own.RestrictedSidCount, own.TokenType,
            client?.UserSid, client?.EnabledGroupSids.ToArray(),
            client?.RestrictedSidCount, client?.TokenType, client?.ImpersonationLevel,
            read, brokerOk, clientOk, reverted, allowed, false));
    }

    private static void RunClient()
    {
        KernelTokenSnapshot own = G2KernelIdentity.SnapshotProcess();
        bool clientPrimary = own.UserSid == FrozenServiceIdentity.LocalServiceSid &&
            own.TokenType == 1 && own.RestrictedSidCount == 0 &&
            own.EnabledGroupSids.Contains(FrozenServiceIdentity.ClientServiceSid,
                StringComparer.OrdinalIgnoreCase) &&
            !own.EnabledGroupSids.Contains(FrozenServiceIdentity.BrokerServiceSid,
                StringComparer.OrdinalIgnoreCase);
        using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.Out,
            PipeOptions.None, TokenImpersonationLevel.Impersonation);
        client.Connect(20000);
        client.WriteByte(0x47);
        client.Flush();
        WriteResult("client.json", new LabReceipt(role, own.UserSid,
            own.EnabledGroupSids.ToArray(), own.RestrictedSidCount, own.TokenType,
            null, null, null, null, null, true, false, clientPrimary, true,
            clientPrimary, false));
    }
}

// A receipt records native observations. It is evidence for a disposable test,
// not a signed, transferable authorization credential.
internal sealed record LabReceipt(
    string Role, string ProcessUserSid, string[] ProcessEnabledSids,
    int ProcessRestrictedSidCount, int ProcessTokenType,
    string? PipeClientUserSid, string[]? PipeClientEnabledSids,
    int? PipeClientRestrictedSidCount, int? PipeClientTokenType,
    int? PipeClientImpersonationLevel, bool FrameRead,
    bool BrokerTokenMatched, bool ClientTokenMatched,
    bool ImpersonationReverted, bool G2Positive, bool CanExecuteCommit);
