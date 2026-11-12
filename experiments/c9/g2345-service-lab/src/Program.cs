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
using System.Text.Json;
using AgentHub.C9.G2;
using Microsoft.Win32.SafeHandles;

namespace AgentHub.C9.G2345.ServiceLab;

// Ephemeral, non-production test service ONLY. It never starts the real C9 broker,
// creates a privileged target or exposes a write-capable operation.
internal static class Program
{
    private const string SetupMarker = "--isolated-g2345-setup";
    private const string ServiceMarker = "--isolated-g2345-lab";
    private const string ScopePrefix = "AgentHub-C9-G2345-Disposable-";
    private const string PipePrefix = "c9-g2345-two-svc-";
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
        Console.WriteLine("G2345_EPHEMERAL_TICKET_PROVISIONED no_private_key_persisted=true");
    }

    private static G2345PipeVerdict OneAttempt(G2345PipeReview gate,
        ReviewIntentWithoutTokenClaims intent,TrustedKeySnapshot trusted)
    {
        using var server = new NamedPipeServerStream(pipeName,PipeDirection.InOut,1,
            PipeTransmissionMode.Byte,PipeOptions.None);
        activePipe = server;
        Task wait = Task.Run(server.WaitForConnection);
        if (!wait.Wait(TimeSpan.FromSeconds(25)) || !server.IsConnected)
        {
            server.Dispose();
            throw new TimeoutException("G2345_PIPE_CLIENT_DID_NOT_CONNECT");
        }
        // EvaluateOneRead performs real G2 kernel checks, then the original G345
        // ticket/file/nonce gate on the same service thread. Never reopen target.
        G2345PipeVerdict verdict = gate.EvaluateOneRead(server.SafePipeHandle,
            intent,trusted,TicketIssuer,DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        activePipe = null;
        return verdict;
    }

    private static void RunBroker()
    {
        KernelTokenSnapshot process = G2KernelIdentity.SnapshotProcess();
        if (!G2KernelIdentity.BrokerIsExpectedService(process))
            throw new InvalidOperationException("E2E_BROKER_SID_DENIED");
        string targetPath = Path.Combine(resultDirectory,TargetName);
        byte[] before = File.ReadAllBytes(targetPath);
        var intent = JsonSerializer.Deserialize<ReviewIntentWithoutTokenClaims>(
            File.ReadAllText(Path.Combine(resultDirectory,"intent.json")))
            ?? throw new InvalidOperationException("E2E_INTENT_INVALID");
        var trust = JsonSerializer.Deserialize<TrustedKeySnapshot>(
            File.ReadAllText(Path.Combine(resultDirectory,"trust.json")))
            ?? throw new InvalidOperationException("E2E_TEST_TRUST_INVALID");
        using var ledger = new G4NonceJournal(Path.Combine(resultDirectory,JournalName));
        var gate = new G2345PipeReview(ledger);
        G2345PipeVerdict first = OneAttempt(gate,intent,trust);
        bool firstOk = first is {Reason:"G345_LOCAL_REVIEW_RESERVED_ONLY",G2KernelVerified:true,
            G3Verified:true,G5Bound:true,G4Reserved:true,CanExecuteCommit:false};
        if (!firstOk || ledger.Count!=1)
            throw new InvalidOperationException("E2E_FIRST_G2345_REVIEW_DENIED reason="+first.Reason);
        G2345PipeVerdict repeat = OneAttempt(gate,intent,trust);
        bool replayDenied = repeat is {G2KernelVerified:true,G3Verified:true,G5Bound:true,
            G4Reserved:false,CanExecuteCommit:false} && repeat.Reason=="G4_REPLAY_DENIED";
        if (!replayDenied || ledger.Count!=1)
            throw new InvalidOperationException("E2E_REPLAY_NOT_DENIED reason="+repeat.Reason);
        bool untouched = before.AsSpan().SequenceEqual(File.ReadAllBytes(targetPath));
        if (!untouched) throw new InvalidOperationException("E2E_TARGET_MUTATED");
        WriteResult("broker.json",new EndToEndReceipt("broker",process.UserSid,
            process.EnabledGroupSids.ToArray(),process.TokenType,process.RestrictedSidCount,
            true,first.G2KernelVerified,first.G3Verified,first.G5Bound,first.G4Reserved,
            replayDenied,untouched,ledger.Count,first.Reason,repeat.Reason,false));
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
            true,false,false,false,false,false,true,0,"SENT_TWICE","",false));
    }
}

// The receipt is diagnostic evidence, not a transferable signing authority.
internal sealed record EndToEndReceipt(
    string Role, string ProcessUserSid, string[] ProcessEnabledSids,
    int ProcessTokenType,int ProcessRestrictedSidCount,
    bool ServiceTokenMatched,bool G2Verified,bool G3Verified,bool G5Bound,
    bool G4Reserved,bool ReplayDenied,bool TargetUntouched,long JournalCount,
    string PositiveReason,string ReplayReason,bool CanExecuteCommit);
