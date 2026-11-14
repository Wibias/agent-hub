using System.Buffers;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using MemoryReviewAuthority.Store;

namespace MemoryReviewAuthority.LabService;

/// <summary>
/// Disposable CI service read lane. NO writes over IPC, NO browser approval,
/// NO user-memory database, NO credentials exposed. Only the exact synthetic
/// fixture scope is served; production enrollment is deliberately absent.
/// A signed envelope does not authenticate a human approval.
/// </summary>
internal sealed class SignedProtectedClaimPipe : IDisposable
{
    internal const string PipeName = "AgentHubMemoryReviewLab-ReadV1";
    internal const string Protocol = "agenthub-protected-lab-read-v1";
    internal const string FixtureProject = "github.com/example/lab-fixture";
    internal const string FixtureBranch = "main";
    private readonly ProtectedPendingReviewLedger _ledger;
    private readonly ECDsa _signer;
    private readonly CancellationTokenSource _stop = new();
    private Task? _loop;

    internal SignedProtectedClaimPipe(ProtectedPendingReviewLedger ledger, string stateRoot)
    {
        _ledger = ledger;
        var privatePath = Path.Combine(stateRoot, "review-service-signing-key.pk8");
        var publicPath = Path.Combine(stateRoot, "review-service-signing-key.pub.pem");
        _signer = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        if (File.Exists(privatePath))
        {
            var bytes = File.ReadAllBytes(privatePath);
            _signer.ImportPkcs8PrivateKey(bytes, out var read);
            if (read != bytes.Length)
                throw new InvalidOperationException("invalid_service_signing_key");
            CryptographicOperations.ZeroMemory(bytes);
            if (!File.Exists(publicPath)
                || File.ReadAllText(publicPath) != _signer.ExportSubjectPublicKeyInfoPem())
                throw new InvalidOperationException("service_public_pin_changed");
        }
        else
        {
            using (var file = new FileStream(privatePath, FileMode.CreateNew,
                FileAccess.Write, FileShare.None))
            {
                var bytes = _signer.ExportPkcs8PrivateKey();
                try
                {
                    file.Write(bytes);
                    file.Flush(flushToDisk: true);
                }
                finally { CryptographicOperations.ZeroMemory(bytes); }
            }
            File.WriteAllText(publicPath, _signer.ExportSubjectPublicKeyInfoPem());
        }
    }

    internal void Start()
    {
        if (_loop is not null) throw new InvalidOperationException("read_pipe_started_twice");
        _loop = Task.Run(() => LoopAsync(_stop.Token));
    }

    private static PipeSecurity CreateSecurity()
    {
        var security = new PipeSecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        static SecurityIdentifier Sid(WellKnownSidType type) => new(type, null);
        security.AddAccessRule(new PipeAccessRule(Sid(WellKnownSidType.LocalServiceSid),
            PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(Sid(WellKnownSidType.LocalSystemSid),
            PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(Sid(WellKnownSidType.BuiltinAdministratorsSid),
            PipeAccessRights.FullControl, AccessControlType.Allow));
        // Disposable lab only: the response is authenticated using an
        // Administrator-protected pinned public key. Production must pin
        // individual enrolled account SIDs, not the BuiltinUsers group.
        security.AddAccessRule(new PipeAccessRule(Sid(WellKnownSidType.BuiltinUsersSid),
            PipeAccessRights.ReadWrite, AccessControlType.Allow));
        // Restricted SCM token additionally requires its *service* SID.
        var serviceSid = (SecurityIdentifier)new NTAccount(
            "NT SERVICE", ReviewHostIdentity.ServiceName)
            .Translate(typeof(SecurityIdentifier));
        security.AddAccessRule(new PipeAccessRule(serviceSid,
            PipeAccessRights.FullControl, AccessControlType.Allow));
        return security;
    }

    private async Task LoopAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var pipe = NamedPipeServerStreamAcl.Create(
                    PipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous, 4096, 16384, CreateSecurity());
                await pipe.WaitForConnectionAsync(stop);
                using var singleRequest = CancellationTokenSource.CreateLinkedTokenSource(stop);
                singleRequest.CancelAfter(TimeSpan.FromSeconds(3));
                await HandleAsync(pipe, singleRequest.Token);
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested)
            {
                return;
            }
            catch (Exception)
            {
                // The host cannot become a write authority from a malformed
                // client request. Close this pipe instance, then listen again.
                await Task.Delay(100, stop).ConfigureAwait(false);
            }
        }
    }

    private static async Task<byte[]?> ReadOneLineAsync(Stream stream, CancellationToken token)
    {
        using var bytes = new MemoryStream();
        var one = new byte[1];
        while (bytes.Length < 4096)
        {
            var received = await stream.ReadAsync(one, token);
            if (received == 0) return null;
            if (one[0] == (byte)'\n') return bytes.ToArray();
            bytes.WriteByte(one[0]);
        }
        return null;
    }

    private async Task HandleAsync(Stream pipe, CancellationToken stop)
    {
        var bytes = await ReadOneLineAsync(pipe, stop);
        if (bytes is null) return;
        using var input = JsonDocument.Parse(bytes);
        if (input.RootElement.ValueKind != JsonValueKind.Object) return;
        var root = input.RootElement;
        static string? Str(JsonElement root, string property)
            => root.TryGetProperty(property, out var item)
                && item.ValueKind == JsonValueKind.String ? item.GetString() : null;
        static int? Int(JsonElement root, string property)
            => root.TryGetProperty(property, out var item)
                && item.ValueKind == JsonValueKind.Number && item.TryGetInt32(out var n)
                ? n : null;
        var nonce = Str(root, "nonce");
        var project = Str(root, "projectId");
        var branch = Str(root, "branch");
        var query = Str(root, "query");
        var limit = Int(root, "maxItems");
        if (Str(root, "protocol") != Protocol
            || Str(root, "op") != "recall"
            || root.EnumerateObject().Count() != 7
            || nonce is null || nonce.Length != 43
            || nonce.Any(c => !((c is >= 'A' and <= 'Z') ||
                (c is >= 'a' and <= 'z') || (c is >= '0' and <= '9')
                || c is '-' or '_'))
            || project != FixtureProject || branch != FixtureBranch
            || string.IsNullOrWhiteSpace(query) || query.Length > 500
            || limit is null or < 1 or > 10)
            return;

        // Always read from the *service-owned* SQLite handle, never an input
        // path. The fixture was originated inside this disposable host.
        IReadOnlyList<ProtectedReviewClaim> rows;
        lock (_ledger)
        {
            // The Admin-only operator proof pipe may atomically update the
            // same protected SQLite connection. Serialize read and UV state.
            rows = _ledger.ReadProtectedClaims(FixtureProject, FixtureBranch, 100);
        }
        var matches = rows.Where(c => c.Value.Contains(query,
            StringComparison.OrdinalIgnoreCase)).Take(limit.Value)
            .Select(c => new
            {
                claim_id = c.ClaimId,
                project_id = c.ProjectId,
                branch = c.Branch,
                revision_sha = c.RevisionSha,
                fact_sha256 = c.CanonicalFactSha256,
                evidence_sha256 = c.SourceEvidenceSha256,
                kind = c.Kind,
                value = c.Value,
                created_at = c.CreatedAtUtc,
                provenance = "synthetic_disposable_lab",
                human_approval_verified = false,
            }).ToArray();
        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            protocol = Protocol,
            nonce,
            project_id = FixtureProject,
            branch = FixtureBranch,
            status = matches.Length > 0 ? "found_lab_only" : "no_match_lab_only",
            read_only = true,
            service_signed = true,
            human_approval_verified = false,
            items = matches,
        });
        var signature = _signer.SignData(
            payload, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
        var envelope = JsonSerializer.Serialize(new
        {
            protocol = Protocol,
            payload_b64 = Convert.ToBase64String(payload),
            signature_b64 = Convert.ToBase64String(signature),
        }) + "\n";
        await pipe.WriteAsync(Encoding.UTF8.GetBytes(envelope), stop);
        await pipe.FlushAsync(stop);
    }

    public void Dispose()
    {
        _stop.Cancel();
        try { _loop?.GetAwaiter().GetResult(); } catch (OperationCanceledException) {}
        _stop.Dispose();
        _signer.Dispose();
    }
}
