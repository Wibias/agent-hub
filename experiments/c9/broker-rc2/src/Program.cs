#if AGENTHUB_C9_LAB_COMMIT || AGENTHUB_C9_WRITE_COMMIT
#error AgentHub C9 RC2 cannot be compiled with a writer
#endif
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using AgentHub.C9.G2;
using Microsoft.Win32.SafeHandles;

namespace AgentHub.LaneB;

internal static class Program
{
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate void ServiceMainProc(uint argc, IntPtr argv);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate void HandlerProc(uint control);

    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    private struct ServiceEntry
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string? Name;
        [MarshalAs(UnmanagedType.FunctionPtr)] public ServiceMainProc? Entry;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus
    {
        public uint ServiceType, CurrentState, ControlsAccepted, Win32ExitCode,
            ServiceSpecificExitCode, CheckPoint, WaitHint;
    }

    private const uint ServiceStopped = 1;
    private const uint ServiceStartPending = 2;
    private const uint ServiceStopPending = 3;
    private const uint ServiceRunning = 4;
    // Release guard is literal and not environment-configurable.
    private const bool ServiceActivationAuthorized = false;
    private static readonly ServiceMainProc MainDelegate = ServiceMain;
    private static readonly HandlerProc ControlDelegate = Control;
    private static SafeFileHandle? currentPipe;
    private static IntPtr statusHandle;
    private static bool stopping;

    [DllImport("advapi32.dll", EntryPoint="StartServiceCtrlDispatcherW", CharSet=CharSet.Unicode, SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool StartDispatcher([In] ServiceEntry[] entries);

    [DllImport("advapi32.dll", EntryPoint="RegisterServiceCtrlHandlerW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern IntPtr RegisterHandler(string name, HandlerProc handler);

    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetServiceStatus(IntPtr handle, ref ServiceStatus status);

    private static void Report(uint state, uint error = 0)
    {
        var status = new ServiceStatus {
            ServiceType=0x10, CurrentState=state,
            ControlsAccepted=state==ServiceRunning?1u:0u, Win32ExitCode=error,
            CheckPoint=state==ServiceStartPending?1u:0u,
            WaitHint=state==ServiceStartPending?10000u:0u
        };
        if(statusHandle!=IntPtr.Zero && !SetServiceStatus(statusHandle,ref status))
            throw Native.LastError("SetServiceStatus");
    }

    private static void Control(uint command)
    {
        if (command != 1) return;
        stopping=true;
        try { Report(ServiceStopPending); } catch (Exception) { }
        SafeFileHandle? pipe=currentPipe;
        if(pipe is { IsClosed:false }) Native.CancelIoEx(pipe,IntPtr.Zero);
    }

    private static void ServiceMain(uint argc, IntPtr argv)
    {
        // This path is built for review, but is not callable from Main in RC2.
        statusHandle=RegisterHandler(BrokerIdentity.BrokerServiceName,ControlDelegate);
        if(statusHandle==IntPtr.Zero) return;
        uint code=0;
        try
        {
            Report(ServiceStartPending);
            if(!G2KernelIdentity.BrokerIsExpectedService(G2KernelIdentity.SnapshotProcess()))
                throw new UnauthorizedAccessException("RC2_BROKER_KERNEL_IDENTITY_DENIED");
            VerifiedReviewAuthority? authority=BrokerRc2Route.GetProductionAuthority();
            if(authority is null)
                throw new UnauthorizedAccessException("RC2_EXTERNAL_TRUST_NOT_PROVISIONED");
            using SafeFileHandle pipe=Native.CreateRestrictedPipe();
            currentPipe=pipe;
            Report(ServiceRunning);
            if(!Native.ConnectNamedPipe(pipe,IntPtr.Zero))
            {
                int error=Marshal.GetLastWin32Error();
                if(error!=535 && !stopping) throw new Win32Exception(error,"ConnectNamedPipe failed");
            }
            if(!stopping)
            {
                // Native G2 token capture occurs in G2345PipeReview on the same
                // thread as the final ReadFile and reverts before any G3/G4/G5 IO.
                byte[] answer=BrokerRc2Route.EvaluateConnected(pipe,authority).WireResponse();
                if(!Native.WriteFile(pipe,answer,(uint)answer.Length,out uint written,IntPtr.Zero)
                    || written!=answer.Length)
                    throw Native.LastError("WriteFile(pipe)");
                Native.FlushFileBuffers(pipe);
                Native.DisconnectNamedPipe(pipe);
            }
        }
        catch (Exception) { code=1066; }
        finally
        {
            currentPipe=null;
            try { Report(ServiceStopped,code); } catch (Exception) { }
        }
    }

    private static int Selftest()
    {
        if(!ReadOnlyPolicy.IsApprovedPing("AHB1|PING"u8)) return 21;
        if(ReadOnlyPolicy.IsApprovedPing("AHB1|APPLY"u8)) return 22;
        if(!BrokerRc2Route.IsForbiddenLegacyCommand("AHB1|APPLY"u8)) return 23;
        if(!BrokerRc2Route.IsForbiddenLegacyCommand("AHB2|LAB_COMMIT|success"u8)) return 24;
        if(!BrokerRc2Route.IsForbiddenLegacyCommand("AHB2|COMMIT"u8)) return 25;
        if(!BrokerRc2Route.IsForbiddenLegacyCommand("AHB2|APPLY"u8)) return 26;
        if(BrokerRequestRouter.IsLabCommitCommand("AHB2|LAB_COMMIT|success"u8)) return 27;
        string legacy=Encoding.UTF8.GetString(ReadOnlyPolicy.Evaluate("AHB1|APPLY"u8));
        if(!legacy.Contains("NOT_COMMITTED",StringComparison.Ordinal) ||
           !legacy.Contains("false",StringComparison.Ordinal)) return 28;
        if(BrokerRc2Route.GetProductionAuthority() is not null) return 29;
        using SafeFileHandle invalid=new(IntPtr.Zero,ownsHandle:false);
        Rc2ReviewResult denied=BrokerRc2Route.EvaluateConnected(invalid,null);
        string response=Encoding.UTF8.GetString(denied.WireResponse());
        if(denied.CanExecuteCommit || denied.G2Verified || denied.G3Verified ||
           denied.G5Bound || denied.G4Reserved ||
           denied.Reason!="RC2_INDEPENDENT_TRUST_OR_PIPE_UNAVAILABLE" ||
           !response.Contains("\"Applied\":false",StringComparison.Ordinal) ||
           !response.Contains("\"CanExecuteCommit\":false",StringComparison.Ordinal)) return 30;
        // Kernel inspection on the disposable CI process must not produce a
        // privileged Broker Service SID. No SCM service is created by selftest.
        if(G2KernelIdentity.BrokerIsExpectedService(G2KernelIdentity.SnapshotProcess())) return 31;
        Console.WriteLine("C9_RC2_NET10_LINKED_BROKER_SOURCE_PASS");
        Console.WriteLine("C9_RC2_G2345_NATIVE_ROUTE_BOUND_PASS (no independent production authority)");
        Console.WriteLine("C9_RC2_NO_COMMIT_NO_SERVICE_PASS");
        return 0;
    }

    private static int Main(string[] args)
    {
        if(!OperatingSystem.IsWindows() || !Environment.Is64BitProcess) return 11;
        if(args.Length!=1) return 12;
        if(args[0]=="--selftest") return Selftest();
        if(args[0]!="--service") return 12;
        if(!ServiceActivationAuthorized)
        {
            Console.Error.WriteLine("C9_RC2_SERVICE_ACTIVATION_DENIED");
            return 32;
        }
        try
        {
            if(!StartDispatcher([
                new ServiceEntry {Name=BrokerIdentity.BrokerServiceName, Entry=MainDelegate},
                new ServiceEntry {Name=null,Entry=null}
            ])) throw Native.LastError("StartServiceCtrlDispatcher");
            return 0;
        }
        catch(Exception) { return 13; }
    }
}
