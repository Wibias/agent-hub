using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using MemoryReviewAuthority.Core;
using MemoryReviewAuthority.Store;

namespace MemoryReviewAuthority.LabService;

/// <summary>
/// An ADMINISTRATOR-ACL-only bridge from one REAL protected E~ pending source
/// to the existing WebAuthn verification engine and persistent operator key.
/// All replies are signed by the same service-owned key as memory_recall.
/// This bridge has NO approval, Claim or source-registration operation.
/// Disposable GitHub SCM lab host ONLY, not a production-installed API.
/// </summary>
internal sealed class OperatorWebAuthnPipe : IDisposable
{
    internal const string PipeName = "AgentHubMemoryReviewLab-OperatorV1";
    internal const string Protocol = "agenthub-operator-uv-service-v1";
    private readonly ProtectedPendingReviewLedger _ledger;
    private readonly VerifiedReviewCoordinator _coordinator;
    private readonly ECDsa _signer;
    private readonly CancellationTokenSource _stop = new();
    private Task? _loop;
    private ChallengeTicket? _active;

    internal OperatorWebAuthnPipe(ProtectedPendingReviewLedger ledger, string stateDir)
    {
        _ledger = ledger ?? throw new ArgumentNullException(nameof(ledger));
        _coordinator = VerifiedReviewCoordinator.ForOperatorCredentialProbe(ledger);
        var privatePath = Path.Combine(stateDir, "review-service-signing-key.pk8");
        var publicPath = Path.Combine(stateDir, "review-service-signing-key.pub.pem");
        var bytes = File.ReadAllBytes(privatePath);
        _signer = ECDsa.Create();
        try
        {
            _signer.ImportPkcs8PrivateKey(bytes, out var read);
            if (read != bytes.Length
                || _signer.ExportSubjectPublicKeyInfoPem() != File.ReadAllText(publicPath))
                throw new InvalidOperationException("service_operator_signing_key_untrusted");
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    internal void Start()
    {
        if (_loop is not null)
            throw new InvalidOperationException("operator_pipe_started_twice");
        _loop = Task.Run(() => RunAsync(_stop.Token));
    }

    private static PipeSecurity AdminOnlyAcl()
    {
        var rules = new PipeSecurity();
        rules.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        static SecurityIdentifier Sid(WellKnownSidType sid) => new(sid, null);
        rules.AddAccessRule(new PipeAccessRule(Sid(WellKnownSidType.LocalServiceSid),
            PipeAccessRights.FullControl, AccessControlType.Allow));
        rules.AddAccessRule(new PipeAccessRule(Sid(WellKnownSidType.LocalSystemSid),
            PipeAccessRights.FullControl, AccessControlType.Allow));
        rules.AddAccessRule(new PipeAccessRule(Sid(WellKnownSidType.BuiltinAdministratorsSid),
            PipeAccessRights.FullControl, AccessControlType.Allow));
        var serviceSid = (SecurityIdentifier)new NTAccount(
            "NT SERVICE", ReviewHostIdentity.ServiceName)
            .Translate(typeof(SecurityIdentifier));
        rules.AddAccessRule(new PipeAccessRule(serviceSid,
            PipeAccessRights.FullControl, AccessControlType.Allow));
        // Deliberately NO BuiltinUsers, AuthenticatedUsers, World or
        // same-account non-elevated SID. Do NOT reuse the lab READ pipe ACL.
        return rules;
    }

    private async Task RunAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var pipe = NamedPipeServerStreamAcl.Create(
                    PipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous, 16_384, 8_192, AdminOnlyAcl());
                await pipe.WaitForConnectionAsync(stop);
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                await HandleAsync(pipe, timeout.Token);
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested)
            {
                return;
            }
            catch
            {
                // A malformed client cannot grant approval; fail closed on
                // this connection, then start a new admin-only pipe instance.
                try { await Task.Delay(100, stop); }
                catch (OperationCanceledException) { return; }
            }
        }
    }

    private static async Task<byte[]?> ReadOneLineAsync(Stream stream, CancellationToken stop)
    {
        using var memory = new MemoryStream();
        var one = new byte[1];
        while (memory.Length < 8_192)
        {
            if (await stream.ReadAsync(one, stop) == 0) return null;
            if (one[0] == (byte)'\n') return memory.ToArray();
            memory.WriteByte(one[0]);
        }
        return null;
    }

    private static string? Str(JsonElement value, string key)
        => value.TryGetProperty(key, out var entry)
           && entry.ValueKind == JsonValueKind.String ? entry.GetString() : null;

    private static bool ValidNonce(string? text)
    {
        if (text is not { Length: 43 }
            || !Regex.IsMatch(text, @"\A[A-Za-z0-9_-]{43}\z",
                RegexOptions.CultureInvariant))
            return false;
        try
        {
            var padded = text.Replace('-', '+').Replace('_', '/');
            var bytes = Convert.FromBase64String(padded + "=");
            return bytes.Length == 32
                && Convert.ToBase64String(bytes).TrimEnd('=')
                    .Replace('+', '-').Replace('/', '_') == text;
        }
        catch (FormatException) { return false; }
    }

    private async Task HandleAsync(Stream stream, CancellationToken stop)
    {
        var raw = await ReadOneLineAsync(stream, stop);
        if (raw is null) return;
        using var json = JsonDocument.Parse(raw);
        var root = json.RootElement;
        if (root.ValueKind != JsonValueKind.Object
            || Str(root, "protocol") != Protocol
            || !ValidNonce(Str(root, "nonce"))) return;
        var nonce = Str(root, "nonce")!;
        var operation = Str(root, "op");

        object? response = null;
        lock (_ledger)
        {
            if (operation == "begin" && root.EnumerateObject().Count() == 6)
            {
                var project = Str(root, "projectId");
                var branch = Str(root, "branch");
                var proposal = Str(root, "proposalRef");
                if (project is not null && project.Length <= 256
                    && branch is not null && branch.Length <= 128
                    && proposal is not null
                    && Regex.IsMatch(proposal, @"\AE~[0-9a-f]{10}\z"))
                {
                    var offer = _ledger.ReadOperatorReviewOffer(
                        project, branch, proposal);
                    if (offer is not null
                        && (_active is null || _active.ExpiresUtc <= DateTimeOffset.UtcNow))
                    {
                        var ticket = _coordinator.BeginOperatorProof(offer.Meaning);
                        _active = ticket;
                        var credential = _ledger.ReadOperatorCredential()
                            ?? throw new InvalidOperationException("operator_pin_missing");
                        var meaning = ticket.Meaning;
                        response = new
                        {
                            protocol = Protocol, op = "begin", nonce,
                            status = "operator_service_uv_challenge_not_approval",
                            service_signed = true,
                            human_approval_verified = false,
                            claim_written = false,
                            request_id = offer.RequestId,
                            ticket_id = ticket.TicketId,
                            challenge = ticket.ChallengeBase64Url,
                            expires_utc = ticket.ExpiresUtc.ToString("O"),
                            credential_id = credential.Credential.CredentialIdBase64Url,
                            expected_origin = credential.Credential.ExpectedOrigin,
                            kind = offer.Kind,
                            source_origin = offer.SourceOrigin,
                            evidence_sha256 = offer.SourceEvidenceSha256,
                            meaning = new
                            {
                                projectId = meaning.ProjectId,
                                branch = meaning.Branch,
                                revisionSha = meaning.RevisionSha,
                                proposalRef = meaning.ProposalRef,
                                reviewSnapshotSha256 = meaning.ReviewSnapshotSha256,
                                canonicalFactSha256 = meaning.CanonicalFactSha256,
                                decision = meaning.Decision,
                                canonicalFact = meaning.CanonicalFact,
                            },
                        };
                    }
                }
            }
            else if (operation == "complete" && root.EnumerateObject().Count() == 5)
            {
                var ticketId = Str(root, "ticketId");
                // Single-use even on malformed assertion, regardless of the
                // result. No caller-supplied review fact/action is accepted.
                var pending = _active;
                _active = null;
                if (pending is not null && ticketId == pending.TicketId
                    && root.TryGetProperty("assertion", out var assertion)
                    && assertion.ValueKind == JsonValueKind.Object
                    && assertion.EnumerateObject().Count() == 5)
                {
                    var item = new BrowserAssertion(
                        Str(assertion, "credentialId") ?? "",
                        Str(assertion, "type") ?? "",
                        Str(assertion, "clientDataJSON") ?? "",
                        Str(assertion, "authenticatorData") ?? "",
                        Str(assertion, "signature") ?? "");
                    var proof = _coordinator.CompleteOperatorProof(
                        pending.TicketId, pending.Meaning, item);
                    response = new
                    {
                        protocol = Protocol, op = "complete", nonce,
                        status = proof.Status,
                        signature_verified = proof.Verified,
                        service_signed = true,
                        human_approval_verified = false,
                        claim_written = false,
                        request_id = proof.Verified
                            ? _ledger.ReadOperatorReviewOffer(
                                pending.Meaning.ProjectId, pending.Meaning.Branch,
                                pending.Meaning.ProposalRef)?.RequestId : null,
                    };
                }
            }
        }

        if (response is null) return;
        var payload = JsonSerializer.SerializeToUtf8Bytes(response);
        var signature = _signer.SignData(payload, HashAlgorithmName.SHA256,
            DSASignatureFormat.Rfc3279DerSequence);
        var envelope = JsonSerializer.Serialize(new
        {
            protocol = Protocol,
            payload_b64 = Convert.ToBase64String(payload),
            signature_b64 = Convert.ToBase64String(signature),
        }) + "\n";
        await stream.WriteAsync(Encoding.UTF8.GetBytes(envelope), stop);
        await stream.FlushAsync(stop);
    }

    public void Dispose()
    {
        _stop.Cancel();
        try { _loop?.GetAwaiter().GetResult(); }
        catch (OperationCanceledException) {}
        _stop.Dispose();
        _signer.Dispose();
    }
}
