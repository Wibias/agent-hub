using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using MemoryReviewAuthority.Store;

namespace MemoryReviewAuthority.LabService;

/// <summary>
/// INDEPENDENT ADMIN-ONLY CI READ LANE. This does not reuse the synthetic
/// public read pipe, and is not registered for normal No-Write previews.
/// A protected policy fixes scope + actual pipe-client Windows SID. Neither
/// an MCP/model-supplied project nor a signed envelope alone grants access.
/// </summary>
internal sealed class SignedOperatorDirectReadCiPipe : IDisposable
{
    internal const string PipeName = "AgentHubMemoryReviewLab-DirectReadCiV1";
    internal const string Protocol = "agenthub-protected-direct-read-ci-v1";
    internal const string PolicyFile = "agenthub-direct-read-ci-only.json";
    internal const string PolicyVersion = "agenthub-direct-read-ci-sid-scope-v1";
    internal const string UserPipeName = "AgentHubMemoryReviewLab-UserReadCiV1";
    internal const string UserProtocol = "agenthub-protected-user-read-ci-v1";
    internal const string UserPolicyFile = "agenthub-user-direct-read-ci-only.json";
    internal const string UserPolicyVersion = "agenthub-user-direct-read-ci-sid-scope-v1";
    private const string FixtureProject = "github.com/example/operator-evidence";
    private const string FixtureBranch = "main";
    private static readonly Regex RevisionPattern = new(
        @"\A[0-9a-f]{40}\z", RegexOptions.CultureInvariant);

    private sealed record Policy(
        string PrincipalSid, string ProjectId, string Branch, string RevisionSha);

    private readonly Policy _policy;
    private readonly ProtectedPendingReviewLedger _ledger;
    private readonly ECDsa _signer;
    private readonly bool _userMode;
    private readonly string _pipeName;
    private readonly string _protocol;
    private readonly CancellationTokenSource _stop = new();
    private Task? _loop;

    internal static bool IsAuthorized(
        string? callerSid, string? pinnedSid,
        string? project, string? pinnedProject,
        string? branch, string? pinnedBranch,
        string? revision, string? pinnedRevision)
        => callerSid is { Length: > 10 }
            && callerSid.StartsWith("S-1-5-21-", StringComparison.Ordinal)
            && callerSid == pinnedSid
            && project == pinnedProject && branch == pinnedBranch
            && revision == pinnedRevision;

    internal static bool PolicyPresent(string stateDir, bool userMode = false)
    {
        var file = new FileInfo(Path.Combine(stateDir,
            userMode ? UserPolicyFile : PolicyFile));
        return file.Exists && file.Length is >= 100 and <= 1024
            && (file.Attributes & FileAttributes.ReparsePoint) == 0;
    }

    internal SignedOperatorDirectReadCiPipe(
        ProtectedPendingReviewLedger ledger, string stateDir, bool userMode = false)
    {
        _userMode = userMode;
        _pipeName = userMode ? UserPipeName : PipeName;
        _protocol = userMode ? UserProtocol : Protocol;
        if (!PolicyPresent(stateDir, userMode))
            throw new InvalidOperationException("direct_ci_read_not_enrolled");
        var path = Path.Combine(stateDir, userMode ? UserPolicyFile : PolicyFile);
        using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object
            || root.EnumerateObject().Count() != 5)
            throw new InvalidOperationException("direct_ci_policy_bad_fields");
        static string? Str(JsonElement obj, string name)
            => obj.TryGetProperty(name, out var field)
                && field.ValueKind == JsonValueKind.String
                ? field.GetString() : null;
        var sid = Str(root, "principalSid");
        var project = Str(root, "projectId");
        var branch = Str(root, "branch");
        var revision = Str(root, "revisionSha");
        if (Str(root, "policy") != (userMode ? UserPolicyVersion : PolicyVersion)
            || !RevisionPattern.IsMatch(revision ?? "")
            || !IsAuthorized(sid, sid, project, FixtureProject,
                branch, FixtureBranch, revision, revision))
            throw new InvalidOperationException("direct_ci_policy_wrong_scope");
        _policy = new Policy(sid!, project!, branch!, revision!);
        _ledger = ledger ?? throw new ArgumentNullException(nameof(ledger));

        var privatePath = Path.Combine(stateDir, "review-service-signing-key.pk8");
        var publicPath = Path.Combine(stateDir, "review-service-signing-key.pub.pem");
        var privateBytes = File.ReadAllBytes(privatePath);
        _signer = ECDsa.Create();
        try
        {
            _signer.ImportPkcs8PrivateKey(privateBytes, out var used);
            if (used != privateBytes.Length
                || _signer.ExportParameters(false).Curve.Oid.Value !=
                    "1.2.840.10045.3.1.7"
                || _signer.ExportSubjectPublicKeyInfoPem() != File.ReadAllText(publicPath))
                throw new InvalidOperationException("direct_ci_service_pin_changed");
        }
        finally { CryptographicOperations.ZeroMemory(privateBytes); }
    }

    internal void Start()
    {
        if (_loop is not null)
            throw new InvalidOperationException("direct_ci_read_pipe_started_twice");
        _loop = Task.Run(() => LoopAsync(_stop.Token));
    }

    private PipeSecurity AccessRules()
    {
        var acl = new PipeSecurity();
        acl.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        static SecurityIdentifier Sid(WellKnownSidType sid) => new(sid, null);
        acl.AddAccessRule(new PipeAccessRule(Sid(WellKnownSidType.LocalSystemSid),
            PipeAccessRights.FullControl, AccessControlType.Allow));
        if (_userMode)
        {
            // Exact enrolled account SID only. In the CI runner we later
            // disable the Administrators group on the SAME user token.
            // No BuiltinUsers / authenticated users / world grant.
            acl.AddAccessRule(new PipeAccessRule(
                new SecurityIdentifier(_policy.PrincipalSid),
                PipeAccessRights.ReadWrite, AccessControlType.Allow));
        }
        else
        {
            acl.AddAccessRule(new PipeAccessRule(
                Sid(WellKnownSidType.BuiltinAdministratorsSid),
                PipeAccessRights.FullControl, AccessControlType.Allow));
        }
        var serviceSid = (SecurityIdentifier)new NTAccount(
            "NT SERVICE", ReviewHostIdentity.ServiceName)
            .Translate(typeof(SecurityIdentifier));
        acl.AddAccessRule(new PipeAccessRule(serviceSid,
            PipeAccessRights.FullControl, AccessControlType.Allow));
        // Strict split: admin-only CI read or exact *enrolled* user SID.
        // Neither endpoint exists in the normal No-Write Preview.
        return acl;
    }

    private async Task LoopAsync(CancellationToken stopping)
    {
        while (!stopping.IsCancellationRequested)
        {
            try
            {
                using var pipe = NamedPipeServerStreamAcl.Create(
                    _pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous, 4096, 16384, AccessRules());
                await pipe.WaitForConnectionAsync(stopping);
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stopping);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                await HandleAsync(pipe, timeout.Token);
            }
            catch (OperationCanceledException) when (stopping.IsCancellationRequested)
            {
                return;
            }
            catch (Exception)
            {
                // A malformed read cannot escape its protected scope.
                try { await Task.Delay(100, stopping).ConfigureAwait(false); }
                catch (OperationCanceledException) { return; }
            }
        }
    }

    private static async Task<byte[]?> ReadOneLineAsync(Stream stream, CancellationToken stop)
    {
        using var buffer = new MemoryStream();
        var one = new byte[1];
        while (buffer.Length < 4096)
        {
            if (await stream.ReadAsync(one, stop) == 0) return null;
            if (one[0] == (byte)'\n') return buffer.ToArray();
            buffer.WriteByte(one[0]);
        }
        return null;
    }

    private async Task HandleAsync(NamedPipeServerStream pipe, CancellationToken stop)
    {
        // Windows named-pipe impersonation happens on the CURRENT thread.
        // Reject anonymous/nonimpersonating clients rather than accept any
        // SID claimed by the JSON request or by user-writable files.
        var data = await ReadOneLineAsync(pipe, stop);
        if (data is null) return;
        string? actualSid = null;
        try
        {
            // ImpersonateNamedPipeClient uses the most recent message READ
            // by the server. Never resolve identity before receiving input.
            pipe.RunAsClient(() =>
            {
                using var caller = WindowsIdentity.GetCurrent(ifImpersonating: true);
                actualSid = caller?.User?.Value;
            });
        }
        catch { return; }
        using var json = JsonDocument.Parse(data);
        var root = json.RootElement;
        if (root.ValueKind != JsonValueKind.Object
            || root.EnumerateObject().Count() != 8
            || root.EnumerateObject().Select(p => p.Name)
                .Distinct(StringComparer.Ordinal).Count() != 8)
            return;
        static string? Str(JsonElement obj, string name)
            => obj.TryGetProperty(name, out var value)
                && value.ValueKind == JsonValueKind.String
                ? value.GetString() : null;
        var nonce = Str(root, "nonce");
        var project = Str(root, "projectId");
        var branch = Str(root, "branch");
        var revision = Str(root, "revisionSha");
        var query = Str(root, "query");
        if (Str(root, "protocol") != _protocol
            || Str(root, "op") != (_userMode ? "read_user_ci" : "read_direct_ci")
            || nonce is null || !Regex.IsMatch(nonce, @"\A[A-Za-z0-9_-]{43}\z")
            || query is not { Length: >= 1 and <= 500 }
            || !root.TryGetProperty("maxItems", out var max)
            || !max.TryGetInt32(out var limit) || limit is < 1 or > 3
            || !IsAuthorized(actualSid, _policy.PrincipalSid, project,
                _policy.ProjectId, branch, _policy.Branch,
                revision, _policy.RevisionSha))
            return;

        IReadOnlyList<ProtectedOperatorDirectClaim> all;
        lock (_ledger)
        {
            all = _ledger.ReadOperatorDirectClaims(
                _policy.ProjectId, _policy.Branch, 100);
        }
        var items = all.Where(c => c.RevisionSha == _policy.RevisionSha
            && c.Value.Contains(query, StringComparison.OrdinalIgnoreCase))
            .Take(limit).Select(c => new
            {
                claim_id = c.ClaimId,
                project_id = c.ProjectId,
                branch = c.Branch,
                revision_sha = c.RevisionSha,
                fact_sha256 = c.FactSha256,
                historical_evidence_sha256 = c.HistoricalEvidenceSha256,
                kind = c.Kind,
                value = c.Value,
                created_at = c.CreatedAtUtc,
                provenance = c.Provenance,
                historical_source_origin = c.HistoricalSourceOrigin,
                historical_evidence_verified = false,
                physical_human_approval_verified = false,
                published_to_codex = false,
            }).ToArray();
        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            protocol = _protocol,
            nonce,
            project_id = _policy.ProjectId,
            branch = _policy.Branch,
            revision_sha = _policy.RevisionSha,
            principal_sid = _policy.PrincipalSid,
            query,
            max_items = limit,
            status = items.Length == 0 ? "no_match_direct_ci_only" : "found_direct_ci_only",
            service_signed = true,
            read_only = true,
            ci_simulation_only = true,
            trusted_for_production_recall = false,
            physical_human_approval_verified = false,
            published_to_codex = false,
            items,
        });
        if (payload.Length > 32768) return; // bounded signed CI envelope
        var signature = _signer.SignData(payload, HashAlgorithmName.SHA256,
            DSASignatureFormat.Rfc3279DerSequence);
        var envelope = JsonSerializer.Serialize(new
        {
            protocol = _protocol,
            payload_b64 = Convert.ToBase64String(payload),
            signature_b64 = Convert.ToBase64String(signature),
        }) + "\n";
        await pipe.WriteAsync(Encoding.UTF8.GetBytes(envelope), stop);
        await pipe.FlushAsync(stop);
    }

    public void Dispose()
    {
        _stop.Cancel();
        try { _loop?.GetAwaiter().GetResult(); }
        catch (OperationCanceledException) { }
        _stop.Dispose();
        _signer.Dispose();
    }
}
