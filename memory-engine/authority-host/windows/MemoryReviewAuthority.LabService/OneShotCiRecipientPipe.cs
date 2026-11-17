using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace MemoryReviewAuthority.LabService;

/// <summary>
/// DISPOSABLE WINDOWS CI FIXTURE ONLY. It holds an already-connected recipient
/// pipe and releases at most one EXACT protected synthetic Claim, and only
/// after a separate native read-purpose UV assertion. A client PID/SID does
/// not authenticate a Codex session and is not a production release policy.
/// </summary>
internal sealed class OneShotCiRecipientPipe : IDisposable
{
    internal const string PipeName = "AgentHubMemoryReviewLab-ReadOnceCiV1";
    internal const string Protocol = "agenthub-memory-read-once-ci-v1";
    internal const string Marker = "agenthub-read-once-ci-only.enable";
    internal const string MarkerText = "AGENTHUB_READ_ONCE_CI_ONLY_NO_PRODUCTION_V1";
    internal const string Project = "github.com/example/operator-evidence";
    internal const string Branch = "main";
    private readonly object _gate = new();
    private readonly CancellationTokenSource _stop = new();
    private Task? _loop;
    private Pending? _active;

    internal sealed record Snapshot(
        string ProjectId, string Branch, string ProposalRef,
        string PrincipalSid, uint KernelProcessId, string SessionSha256,
        DateTimeOffset ExpiresUtc);

    private sealed class Pending : IDisposable
    {
        internal NamedPipeServerStream Stream { get; }
        internal Snapshot Metadata { get; }
        internal TaskCompletionSource<bool> Finished { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal bool Consumed { get; set; }

        internal Pending(NamedPipeServerStream stream, Snapshot metadata)
        {
            Stream = stream;
            Metadata = metadata;
        }
        public void Dispose()
        {
            Finished.TrySetResult(true);
            Stream.Dispose();
        }
    }

    internal static bool Enabled(string stateDir)
    {
        try
        {
            var file = new FileInfo(Path.Combine(stateDir, Marker));
            return file.Exists && file.Length == MarkerText.Length
                && (file.Attributes & FileAttributes.ReparsePoint) == 0
                && File.ReadAllText(file.FullName, Encoding.ASCII) == MarkerText;
        }
        catch { return false; }
    }

    internal void Start()
    {
        if (_loop is not null) throw new InvalidOperationException("read_once_ci_started_twice");
        _loop = Task.Run(() => RunAsync(_stop.Token));
    }

    private static PipeSecurity RestrictedAcl()
    {
        var acl = new PipeSecurity();
        acl.SetAccessRuleProtection(true, false);
        static SecurityIdentifier Sid(WellKnownSidType sid) => new(sid, null);
        acl.AddAccessRule(new PipeAccessRule(Sid(WellKnownSidType.LocalSystemSid),
            PipeAccessRights.FullControl, AccessControlType.Allow));
        acl.AddAccessRule(new PipeAccessRule(Sid(WellKnownSidType.BuiltinAdministratorsSid),
            PipeAccessRights.FullControl, AccessControlType.Allow));
        var serviceSid = (SecurityIdentifier)new NTAccount(
            "NT SERVICE", ReviewHostIdentity.ServiceName).Translate(
                typeof(SecurityIdentifier));
        acl.AddAccessRule(new PipeAccessRule(serviceSid,
            PipeAccessRights.FullControl, AccessControlType.Allow));
        return acl;
    }

    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(
        SafePipeHandle pipe, out uint pid);

    private static string? PrincipalSid(NamedPipeServerStream pipe)
    {
        string? sid = null;
        pipe.RunAsClient(() =>
        {
            using var identity = WindowsIdentity.GetCurrent(ifImpersonating:true);
            sid = identity?.User?.Value;
        });
        return sid is not null && Regex.IsMatch(sid,
            @"\AS-1-5-21-(?:[0-9]+-){2,}[0-9]+\z",
            RegexOptions.CultureInvariant) ? sid : null;
    }

    private static async Task<byte[]?> ReadLineAsync(Stream stream, CancellationToken token)
    {
        using var bytes = new MemoryStream();
        var one = new byte[1];
        while (bytes.Length < 1024)
        {
            if (await stream.ReadAsync(one, token) == 0) return null;
            if (one[0] == (byte)'\n') return bytes.ToArray();
            bytes.WriteByte(one[0]);
        }
        return null;
    }

    private async Task RunAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var pipe = NamedPipeServerStreamAcl.Create(
                    PipeName,PipeDirection.InOut,1,PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous,16384,2048,RestrictedAcl());
                await pipe.WaitForConnectionAsync(stop);
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stop);
                deadline.CancelAfter(TimeSpan.FromSeconds(8));
                var raw = await ReadLineAsync(pipe,deadline.Token);
                if (raw is null || !GetNamedPipeClientProcessId(
                    pipe.SafePipeHandle,out var kernelPid) || kernelPid == 0)
                    continue;
                var actualSid = PrincipalSid(pipe);
                if (actualSid is null) continue;
                using var json = JsonDocument.Parse(raw);
                var root = json.RootElement;
                var names = root.ValueKind == JsonValueKind.Object
                    ? root.EnumerateObject().Select(x=>x.Name).ToArray() : [];
                if (names.Length!=4 || names.Distinct(StringComparer.Ordinal).Count()!=4
                    || !names.ToHashSet(StringComparer.Ordinal).SetEquals(
                        ["protocol","projectId","branch","proposalRef"])
                    || root.GetProperty("protocol").GetString()!=Protocol
                    || root.GetProperty("projectId").GetString()!=Project
                    || root.GetProperty("branch").GetString()!=Branch
                    || !Regex.IsMatch(root.GetProperty("proposalRef").GetString() ?? "",
                        @"\AE~[a-f0-9]{10}\z"))
                    continue;
                var proposal = root.GetProperty("proposalRef").GetString()!;
                var challenge = RandomNumberGenerator.GetBytes(32);
                var binding = JsonSerializer.SerializeToUtf8Bytes(new[]
                {
                    Protocol,Project,Branch,proposal,actualSid,
                    kernelPid.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    Convert.ToHexString(challenge).ToLowerInvariant(),
                });
                var snapshot = new Snapshot(Project,Branch,proposal,
                    actualSid,kernelPid,
                    Convert.ToHexString(SHA256.HashData(binding)).ToLowerInvariant(),
                    DateTimeOffset.UtcNow.AddSeconds(90));
                using var pending = new Pending(pipe,snapshot);
                lock(_gate)
                {
                    if(_active is not null)continue;
                    _active=pending;
                }
                try
                {
                    // A non-secret ACK lets the CI parent know that the
                    // kernel-observed recipient is connected. It contains
                    // NO private Claim, authorization or bearer token.
                    var ack=Encoding.ASCII.GetBytes(
                        "{\"protocol\":\"agenthub-memory-read-once-ci-v1\",\"status\":\"pending_no_claim\"}\n");
                    await pipe.WriteAsync(ack,stop);
                    await pipe.FlushAsync(stop);
                    await pending.Finished.Task.WaitAsync(
                        TimeSpan.FromSeconds(90),stop);
                }
                catch (TimeoutException) { }
                finally
                {
                    lock(_gate)
                    {
                        if(ReferenceEquals(_active,pending))_active=null;
                    }
                }
            }
            catch (OperationCanceledException) when(stop.IsCancellationRequested)
            {
                return;
            }
            catch
            {
                try { await Task.Delay(100,stop); }
                catch(OperationCanceledException){return;}
            }
        }
    }

    internal Snapshot? Peek(string project,string branch,string proposal)
    {
        lock(_gate)
        {
            var p=_active;
            if(p is null || p.Consumed || !p.Stream.IsConnected
                || p.Metadata.ExpiresUtc <= DateTimeOffset.UtcNow
                || p.Metadata.ProjectId!=project || p.Metadata.Branch!=branch
                || p.Metadata.ProposalRef!=proposal)
                return null;
            return p.Metadata;
        }
    }

    /// <summary>
    /// One-shot synchronous write to the already-connected kernel pipe.
    /// There is NO recipient-supplied bearer token or late rebind; the server
    /// consumes the state BEFORE attempting to send, including I/O failure.
    /// This is intentionally not an authenticated Codex session.
    /// </summary>
    internal bool TryDeliver(Snapshot original,byte[] signedEnvelope)
    {
        if(signedEnvelope.Length is < 80 or > 16384)return false;
        lock(_gate)
        {
            var p=_active;
            if(p is null || p.Consumed || p.Metadata!=original)
                return false;
            p.Consumed=true;
            try
            {
                if(!p.Stream.IsConnected
                    || original.ExpiresUtc<=DateTimeOffset.UtcNow
                    || !GetNamedPipeClientProcessId(
                        p.Stream.SafePipeHandle,out var currentPid)
                    || currentPid!=original.KernelProcessId
                    || PrincipalSid(p.Stream)!=original.PrincipalSid)
                    return false;
                p.Stream.Write(signedEnvelope);
                p.Stream.Flush();
                return true;
            }
            catch(Exception error) when(error is IOException
                or InvalidOperationException or ObjectDisposedException)
            {
                return false;
            }
            finally
            {
                p.Finished.TrySetResult(true);
            }
        }
    }

    internal void Deny(Snapshot? original)
    {
        if(original is null)return;
        lock(_gate)
        {
            var p=_active;
            if(p is null || p.Metadata!=original)return;
            p.Consumed=true;
            p.Finished.TrySetResult(true);
        }
    }

    public void Dispose()
    {
        _stop.Cancel();
        lock(_gate){_active?.Dispose();_active=null;}
        try{_loop?.GetAwaiter().GetResult();}
        catch(OperationCanceledException){}
        _stop.Dispose();
    }
}
