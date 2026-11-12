using System.Buffers.Binary;
using System.ComponentModel;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using AgentHub.C9.G3;
using AgentHub.C9.G345;
using AgentHub.C9.G5;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Reflection;
using System.Text.Json;
using AgentHub.C9.G2;
using Microsoft.Win32.SafeHandles;

namespace AgentHub.C9.RC2.AssemblyLab;

// Ephemeral, non-production test service ONLY. It never starts the real C9 broker,
// creates a privileged target or exposes a write-capable operation.
internal static class Program
{
    private const string SetupMarker = "--isolated-rc2-setup";
    private const string ServiceMarker = "--isolated-rc2-lab";
    private const string ScopePrefix = "AgentHub-C9-RC2-Disposable-";
    private const string PipePrefix = "c9-rc2-two-svc-";
    private const string TicketIssuer = "test-issuer";
    private const string TicketKeyId = "test-key";
    private const string TargetName = "target.bin";
    private const string JournalName = "g4.journal";

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

    private static bool IsTestRoot(string path)
    {
        if (!Path.IsPathFullyQualified(path) || !Directory.Exists(path) ||
            !Path.GetFileName(path).StartsWith(ScopePrefix, StringComparison.Ordinal) ||
            Path.GetFileName(path).Length != ScopePrefix.Length + 32 ||
            !string.Equals(Path.GetFullPath(path), path, StringComparison.OrdinalIgnoreCase))
            return false;
        string guid = Path.GetFileName(path)[ScopePrefix.Length..];
        return guid.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f') &&
            string.Equals(Path.GetDirectoryName(path), Environment.GetFolderPath(
                Environment.SpecialFolder.CommonApplicationData), StringComparison.OrdinalIgnoreCase);
    }

    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows() || !Environment.Is64BitProcess) return 76;
        if (args.Length == 2 && args[0] == SetupMarker && IsTestRoot(args[1]) &&
            Environment.GetEnvironmentVariable("GITHUB_ACTIONS") == "true" &&
            Environment.GetEnvironmentVariable("GITHUB_REPOSITORY") == "Wibias/agent-hub" &&
            Environment.GetEnvironmentVariable("GITHUB_REF") == "refs/heads/codex/c9-g3-offline-review" &&
            Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") == "github-hosted")
        {
            Setup(args[1]);
            return 0;
        }
        // A disposable test service only; never the historical C9 broker executable.
        if (args.Length != 4 || args[0] != ServiceMarker ||
            args[1] is not ("broker" or "client") ||
            !args[2].StartsWith(PipePrefix, StringComparison.Ordinal) ||
            args[2].Length != PipePrefix.Length + 32 ||
            args[2][PipePrefix.Length..].Any(c => c is not (>= '0' and <= '9' or >= 'a' and <= 'f')) ||
            !IsTestRoot(args[3])) return 76;
        role = args[1]; pipeName = args[2]; resultDirectory = args[3];

        // Scope markers are only for running the CI-only G2345 review gate.
        // Native process/pipe tokens, not environment variables, decide G2.
        Environment.SetEnvironmentVariable("RUNNER_ENVIRONMENT", "github-hosted");
        Environment.SetEnvironmentVariable("RUNNER_OS", "Windows");
        Environment.SetEnvironmentVariable("AGENTHUB_G2_REVIEW_ONLY", "DISPOSABLE_WINDOWS_TEST");
        Environment.SetEnvironmentVariable("AGENTHUB_G345_REVIEW_ONLY", "DISPOSABLE_WINDOWS_TEST");
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
            try { File.WriteAllText(Path.Combine(resultDirectory, role + "-output", role + ".failure"), e.ToString()); }
            catch { /* Never claim a pass if failure report cannot be written. */ }
        }
        finally
        {
            activePipe = null;
            try { Report(ServiceStopped, code); } catch { }
        }
    }

    private static void WriteResult(string file, EndToEndReceipt value)
    {
        string path = Path.Combine(resultDirectory, role + "-output", file);
        string temporary = path + ".pending";
        using (var fs = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write,
            FileShare.None, 4096, FileOptions.WriteThrough))
        {
            JsonSerializer.Serialize(fs, value);
            fs.Flush(flushToDisk: true);
        }
        File.Move(temporary, path);
    }

    private static string Sha256(byte[] data) =>
        Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
    private static string RandomHex16() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    [DllImport("kernel32.dll", EntryPoint="GetFileInformationByHandleEx", SetLastError=true, ExactSpelling=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFileId(SafeFileHandle handle, int infoClass, IntPtr buffer, uint length);

    // The disposable admin test provisioner is not a service and exports only a
    // test ticket and public SPKI pin. Its short-lived signing key never leaves memory.
    private static void Setup(string dir)
    {
        string target = Path.Combine(dir, TargetName);
        byte[] contents = [0x43,0x39,0x2b,0x47,0x32,0x47,0x33,0x47,0x34,0x47,0x35];
        File.WriteAllBytes(target, contents);
        string hash = Sha256(contents);
        using SafeFileHandle file = File.OpenHandle(target, FileMode.Open, FileAccess.Read, FileShare.Read);
        IntPtr p = Marshal.AllocHGlobal(24);
        ApprovedFilePin pin;
        try
        {
            if (!QueryFileId(file, 18, p, 24))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "E2E_FILE_ID_UNAVAILABLE");
            ulong serial = unchecked((ulong)Marshal.ReadInt64(p));
            byte[] id = new byte[16];
            Marshal.Copy(IntPtr.Add(p, 8), id, 0, 16);
            if (serial == 0 || id.All(b=>b==0)) throw new InvalidOperationException("E2E_UNSUPPORTED_FILE_ID");
            pin = new ApprovedFilePin(serial.ToString("x16",CultureInfo.InvariantCulture),
                Convert.ToHexString(id).ToLowerInvariant(), hash);
        }
        finally { Marshal.FreeHGlobal(p); }
        using ECDsa signer = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        byte[] publicKey = signer.ExportSubjectPublicKeyInfo();
        string release = Sha256(RandomNumberGenerator.GetBytes(32));
        string payload = Sha256(RandomNumberGenerator.GetBytes(32));
        string requestId = RandomHex16();
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        ApprovalTicketV2 ticket = new(2, TicketIssuer, TicketKeyId, release,
            RandomHex16(), requestId, RandomHex16(), "replace", "target-test",
            pin.VolumeId, pin.FileId, payload, pin.PreimageSha256,
            FrozenServiceIdentity.BrokerServiceSid, FrozenServiceIdentity.ClientServiceSid,
            now - 10, now + 280, "");
        ticket = ticket with {SignatureBase64=Convert.ToBase64String(
            signer.SignData(OfflineAuthorization.CanonicalBytes(ticket),
                HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence))};
        File.WriteAllBytes(Path.Combine(dir,"ticket.json"),JsonSerializer.SerializeToUtf8Bytes(ticket));
        File.WriteAllText(Path.Combine(dir,"trust.json"),JsonSerializer.Serialize(
            new TrustedKeySnapshot(TicketKeyId,publicKey,Sha256(publicKey),false)));
        File.WriteAllText(Path.Combine(dir,"intent.json"),JsonSerializer.Serialize(
            new ReviewIntentWithoutTokenClaims(dir,TargetName,release,requestId,
                ticket.Operation,ticket.TargetId,payload)));
        File.WriteAllBytes(Path.Combine(dir,JournalName),G4NonceJournal.EncodeEmptyForOfflineTestProvisioner());
        Console.WriteLine("RC2_EPHEMERAL_TICKET_PROVISIONED no_private_key_persisted=true");
    }

    // Reflection is used ONLY by this disposable test harness to enter the
    // non-public, unchanged RC2 route without adding a production-accessible
    // entrypoint or a friend assembly to the production broker.
    private static (string Reason, bool G2, bool G3, bool G5, bool G4, bool Commit)
        Rc2Evaluate(SafePipeHandle handle, ReviewIntentWithoutTokenClaims intent,
            TrustedKeySnapshot trust)
    {
        Assembly rc2 = Assembly.Load("AgentHub.C9.ReadOnlyBroker.RC2");
        if (rc2.GetName().Name != "AgentHub.C9.ReadOnlyBroker.RC2")
            throw new InvalidOperationException("RC2_DIFFERENT_ASSEMBLY_LOADED");
        var authorityType = rc2.GetType("AgentHub.LaneB.VerifiedReviewAuthority", throwOnError:true)!;
        var routeType = rc2.GetType("AgentHub.LaneB.BrokerRc2Route", throwOnError:true)!;
        var ctor = authorityType.GetConstructors(BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance)
            .Single(c=>c.GetParameters().Length==4);
        object authority = ctor.Invoke([intent,trust,TicketIssuer,Path.Combine(resultDirectory,JournalName)]);
        var method = routeType.GetMethod("EvaluateConnected",BindingFlags.Static|BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("RC2_ROUTE_UNAVAILABLE");
        object verdict = method.Invoke(null,[handle,authority])
            ?? throw new InvalidOperationException("RC2_ROUTE_NO_VERDICT");
        var vt=verdict.GetType();
        T Value<T>(string name) => (T)(vt.GetProperty(name,BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance)
            ?.GetValue(verdict) ?? throw new InvalidOperationException("RC2_VERDICT_FIELD_MISSING:"+name));
        return (Value<string>("Reason"),Value<bool>("G2Verified"),
            Value<bool>("G3Verified"),Value<bool>("G5Bound"),
            Value<bool>("G4Reserved"),Value<bool>("CanExecuteCommit"));
    }

    private static (string Reason, bool G2, bool G3, bool G5, bool G4, bool Commit)
        OneAttempt(ReviewIntentWithoutTokenClaims intent, TrustedKeySnapshot trusted)
    {
        using var server = new NamedPipeServerStream(pipeName,PipeDirection.InOut,1,
            PipeTransmissionMode.Byte,PipeOptions.None);
        activePipe=server;
        Task wait=Task.Run(server.WaitForConnection);
        if(!wait.Wait(TimeSpan.FromSeconds(25)) || !server.IsConnected)
        {
            server.Dispose();
            throw new TimeoutException("RC2_PIPE_CLIENT_DID_NOT_CONNECT");
        }
        // Execute the actual RC2's BrokerRc2Route.EvaluateConnected on the
        // service's thread. That method does the real G2 pipe-token check,
        // then G3/G5 verification and G4 journal reservation.
        var verdict=Rc2Evaluate(server.SafePipeHandle,intent,trusted);
        activePipe=null;
        return verdict;
    }

    private static long JournalCount()
    {
        using var journal = new G4NonceJournal(Path.Combine(resultDirectory,JournalName));
        return journal.Count;
    }

    private static void RunBroker()
    {
        KernelTokenSnapshot process=G2KernelIdentity.SnapshotProcess();
        if(!G2KernelIdentity.BrokerIsExpectedService(process))
            throw new InvalidOperationException("RC2_BROKER_SID_DENIED");
        Assembly rc2=Assembly.Load("AgentHub.C9.ReadOnlyBroker.RC2");
        string rc2Path=rc2.Location;
        if(rc2.GetName().Name!="AgentHub.C9.ReadOnlyBroker.RC2" ||
            !Path.IsPathFullyQualified(rc2Path) || !File.Exists(rc2Path))
            throw new InvalidOperationException("RC2_ASSEMBLY_NOT_LOADED");
        string sha=Sha256(File.ReadAllBytes(rc2Path));
        if(sha!="d990d989191922f2e10c7acdeb0367f47a1c909fe0f1f8220c14e264de3ef147")
            throw new InvalidOperationException("RC2_ASSEMBLY_SHA256_MISMATCH "+sha);
        var routeType=rc2.GetType("AgentHub.LaneB.BrokerRc2Route",throwOnError:true)!;
        var getProduction=routeType.GetMethod("GetProductionAuthority",BindingFlags.Static|BindingFlags.NonPublic)!;
        if(getProduction.Invoke(null,null) is not null)
            throw new InvalidOperationException("RC2_PRODUCTION_AUTHORITY_UNEXPECTEDLY_ENABLED");
        byte[] before=File.ReadAllBytes(Path.Combine(resultDirectory,TargetName));
        var intent=JsonSerializer.Deserialize<ReviewIntentWithoutTokenClaims>(
            File.ReadAllText(Path.Combine(resultDirectory,"intent.json")))
            ?? throw new InvalidOperationException("RC2_INTENT_INVALID");
        var trust=JsonSerializer.Deserialize<TrustedKeySnapshot>(
            File.ReadAllText(Path.Combine(resultDirectory,"trust.json")))
            ?? throw new InvalidOperationException("RC2_TRUST_INVALID");
        var first=OneAttempt(intent,trust);
        bool firstOk=first is {Reason:"G345_LOCAL_REVIEW_RESERVED_ONLY",G2:true,
            G3:true,G5:true,G4:true,Commit:false};
        if(!firstOk || JournalCount()!=1)
            throw new InvalidOperationException("RC2_FIRST_REVIEW_DENIED:"+first.Reason);
        var repeat=OneAttempt(intent,trust);
        bool denied=repeat is {Reason:"G4_REPLAY_DENIED",G2:true,G3:true,G5:true,
            G4:false,Commit:false};
        if(!denied || JournalCount()!=1)
            throw new InvalidOperationException("RC2_REPLAY_NOT_DENIED:"+repeat.Reason);
        bool untouched=before.AsSpan().SequenceEqual(File.ReadAllBytes(
            Path.Combine(resultDirectory,TargetName)));
        if(!untouched)throw new InvalidOperationException("RC2_TARGET_CHANGED");
        WriteResult("broker.json",new EndToEndReceipt("broker",process.UserSid,
            process.EnabledGroupSids.ToArray(),process.TokenType,process.RestrictedSidCount,
            true,first.G2,first.G3,first.G5,first.G4,denied,untouched,
            JournalCount(),first.Reason,repeat.Reason,false,sha));
    }

    private static void RunClient()
    {
        KernelTokenSnapshot own = G2KernelIdentity.SnapshotProcess();
        bool valid = own.UserSid==FrozenServiceIdentity.LocalServiceSid &&
            own.TokenType==1 && own.RestrictedSidCount==0 &&
            own.EnabledGroupSids.Contains(FrozenServiceIdentity.ClientServiceSid,
                StringComparer.OrdinalIgnoreCase) &&
            !own.EnabledGroupSids.Contains(FrozenServiceIdentity.BrokerServiceSid,
                StringComparer.OrdinalIgnoreCase);
        if (!valid) throw new InvalidOperationException("E2E_CLIENT_SID_DENIED");
        byte[] ticket = File.ReadAllBytes(Path.Combine(resultDirectory,"ticket.json"));
        byte[] framed = new byte[ticket.Length+4];
        BinaryPrimitives.WriteUInt32LittleEndian(framed.AsSpan(0,4),(uint)ticket.Length);
        ticket.CopyTo(framed.AsSpan(4));
        for(int i=0;i<2;i++)
        {
            using var client = new NamedPipeClientStream(".",pipeName,PipeDirection.Out,
                PipeOptions.None,TokenImpersonationLevel.Impersonation);
            client.Connect(25000);
            client.Write(framed);
            client.Flush();
        }
        WriteResult("client.json",new EndToEndReceipt("client",own.UserSid,
            own.EnabledGroupSids.ToArray(),own.TokenType,own.RestrictedSidCount,
            true,false,false,false,false,false,true,0,"SENT_TWICE","",false,""));
    }
}

// The receipt is diagnostic evidence, not a transferable signing authority.
internal sealed record EndToEndReceipt(
    string Role, string ProcessUserSid, string[] ProcessEnabledSids,
    int ProcessTokenType,int ProcessRestrictedSidCount,
    bool ServiceTokenMatched,bool G2Verified,bool G3Verified,bool G5Bound,
    bool G4Reserved,bool ReplayDenied,bool TargetUntouched,long JournalCount,
    string PositiveReason,string ReplayReason,bool CanExecuteCommit,string Rc2AssemblySha256);
