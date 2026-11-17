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
/// Enrollment writes only the service-owned local credential pin after
/// two independent service challenges; it cannot grant Claim consent.
/// Disposable GitHub SCM lab host ONLY, not a production-installed API.
/// </summary>
internal sealed class OperatorWebAuthnPipe : IDisposable
{
    internal const string PipeName = "AgentHubMemoryReviewLab-OperatorV1";
    internal const string Protocol = "agenthub-operator-uv-service-v1";
    private readonly ProtectedPendingReviewLedger _ledger;
    private VerifiedReviewCoordinator? _coordinator;
    private OperatorReaffirmationCoordinator? _reaffirmation;
    private ChallengeTicket? _activeReaffirmation;
    private readonly ReviewChallengeCore _registrationProofCore = new();
    private RegistrationAttempt? _registration;
    private RegistrationPossession? _registrationPossession;

    private sealed record RegistrationAttempt(
        string TicketId, string Challenge, string UserId,
        DateTimeOffset ExpiresUtc, string RequestId, ReviewMeaning Meaning);
    private sealed record RegistrationPossession(
        ChallengeTicket Ticket, PinnedCredential Credential, string RequestId);

    private static string B64(ReadOnlySpan<byte> bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=')
            .Replace('+', '-').Replace('/', '_');
    private readonly ECDsa _signer;
    private readonly CancellationTokenSource _stop = new();
    private Task? _loop;
    private ChallengeTicket? _active;

    internal OperatorWebAuthnPipe(ProtectedPendingReviewLedger ledger, string stateDir)
    {
        _ledger = ledger ?? throw new ArgumentNullException(nameof(ledger));
        var operatorCredential = _ledger.ReadOperatorCredential();
        if (operatorCredential is not null)
            _coordinator = VerifiedReviewCoordinator.ForOperatorCredentialProbe(ledger);
        if (operatorCredential?.EnrollmentState == ProtectedPendingReviewLedger.NativeEnrollmentState)
            _reaffirmation = OperatorReaffirmationCoordinator.ForNativeCredential(ledger);
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
        // No broad LocalService SID: only this particular SCM service SID,
        // SYSTEM and Administrators may access the operator UV control plane.
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

    private static object SignedMeaning(ReviewMeaning meaning) => new
    {
        projectId = meaning.ProjectId,
        branch = meaning.Branch,
        revisionSha = meaning.RevisionSha,
        proposalRef = meaning.ProposalRef,
        reviewSnapshotSha256 = meaning.ReviewSnapshotSha256,
        canonicalFactSha256 = meaning.CanonicalFactSha256,
        decision = meaning.Decision,
        canonicalFact = meaning.CanonicalFact,
    };

    private static bool ExactKeys(JsonElement root, params string[] keys)
    {
        if (root.ValueKind != JsonValueKind.Object) return false;
        var given = root.EnumerateObject().Select(x => x.Name).ToArray();
        return given.Length == keys.Length
            && given.Distinct(StringComparer.Ordinal).Count() == given.Length
            && given.ToHashSet(StringComparer.Ordinal).SetEquals(keys);
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
            if (operation == "begin" && ExactKeys(root,
                "protocol", "op", "nonce", "projectId", "branch", "proposalRef")
                && _coordinator is not null)
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
                            meaning = SignedMeaning(meaning),
                        };
                    }
                }
            }
            else if (operation == "complete" && ExactKeys(root,
                "protocol", "op", "nonce", "ticketId", "assertion")
                && _coordinator is not null)
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
            else if (operation == "reaffirm_begin" && ExactKeys(root,
                "protocol", "op", "nonce", "projectId", "branch", "proposalRef")
                && _reaffirmation is not null)
            {
                // Admin-only surface. Scope/fact are read from protected
                // state, never supplied over IPC. Nothing here grants Claim
                // authority or verifies the ORIGINAL historical evidence.
                var project = Str(root, "projectId");
                var branch = Str(root, "branch");
                var proposal = Str(root, "proposalRef");
                if (project is { Length: > 0 and <= 256 }
                    && branch is { Length: > 0 and <= 128 }
                    && Regex.IsMatch(proposal ?? "", @"\AE~[0-9a-f]{10}\z")
                    && (_activeReaffirmation is null
                        || _activeReaffirmation.ExpiresUtc <= DateTimeOffset.UtcNow))
                {
                    var offer = _ledger.ReadOperatorReviewOffer(project, branch, proposal!);
                    if (offer is not null && offer.Meaning.Decision == "confirm"
                        && offer.Kind is "knowledge" or "preference")
                    {
                        var ticket = _reaffirmation.Begin(offer.Meaning);
                        _activeReaffirmation = ticket;
                        var native = _ledger.ReadOperatorCredential()
                            ?? throw new InvalidOperationException("native_credential_missing");
                        response = new
                        {
                            protocol = Protocol, op = operation, nonce,
                            status = "operator_reaffirmation_challenge_no_claim",
                            service_signed = true, human_approval_verified = false,
                            claim_written = false,
                            reaffirmation_intent_recorded = false,
                            original_evidence_verified = false,
                            confirmation_scope = "new_user_statement_only",
                            request_id = offer.RequestId,
                            ticket_id = ticket.TicketId,
                            challenge = ticket.ChallengeBase64Url,
                            expires_utc = ticket.ExpiresUtc.ToString("O"),
                            credential_id = native.Credential.CredentialIdBase64Url,
                            expected_origin = native.Credential.ExpectedOrigin,
                            kind = offer.Kind,
                            source_origin = offer.SourceOrigin,
                            evidence_sha256 = offer.SourceEvidenceSha256,
                            meaning = SignedMeaning(ticket.Meaning),
                        };
                    }
                }
            }
            else if (operation == "reaffirm_complete" && ExactKeys(root,
                "protocol", "op", "nonce", "ticketId", "assertion")
                && _reaffirmation is not null)
            {
                // Consume on the first attempt, including malformed input.
                var pending = _activeReaffirmation;
                _activeReaffirmation = null;
                if (pending is not null
                    && Str(root, "ticketId") == pending.TicketId
                    && root.TryGetProperty("assertion", out var assertion)
                    && ExactKeys(assertion, "credentialId", "type",
                        "clientDataJSON", "authenticatorData", "signature"))
                {
                    var item = new BrowserAssertion(
                        Str(assertion, "credentialId") ?? "",
                        Str(assertion, "type") ?? "",
                        Str(assertion, "clientDataJSON") ?? "",
                        Str(assertion, "authenticatorData") ?? "",
                        Str(assertion, "signature") ?? "");
                    var result = _reaffirmation.Complete(
                        pending.TicketId, pending.Meaning, item);
                    response = new
                    {
                        protocol = Protocol, op = operation, nonce,
                        status = result.Status,
                        signature_verified = result.Verified,
                        service_signed = true, human_approval_verified = false,
                        claim_written = false,
                        reaffirmation_intent_recorded = result.Verified,
                        original_evidence_verified = false,
                        request_id = result.RequestId,
                    };
                }
            }
            else if (operation == "enroll_begin" && ExactKeys(root,
                "protocol", "op", "nonce", "projectId", "branch", "proposalRef"))
            {
                // Enrollment never trusts a model-provided fact or key. Source
                // and action come exclusively from the service-owned ledger.
                var project = Str(root, "projectId");
                var branch = Str(root, "branch");
                var proposal = Str(root, "proposalRef");
                if (_ledger.ReadOperatorCredential() is null
                    && project is { Length: > 0 and <= 256 }
                    && branch is { Length: > 0 and <= 128 }
                    && Regex.IsMatch(proposal ?? "", @"\AE~[0-9a-f]{10}\z")
                    && (_registration is null
                        || _registration.ExpiresUtc <= DateTimeOffset.UtcNow)
                    && (_registrationPossession is null
                        || _registrationPossession.Ticket.ExpiresUtc <= DateTimeOffset.UtcNow))
                {
                    var offer = _ledger.ReadOperatorReviewOffer(project, branch, proposal!);
                    if (offer is not null)
                    {
                        var started = DateTimeOffset.UtcNow;
                        var request = new RegistrationAttempt(
                            B64(RandomNumberGenerator.GetBytes(24)),
                            B64(RandomNumberGenerator.GetBytes(32)),
                            B64(RandomNumberGenerator.GetBytes(32)),
                            started.AddSeconds(90), offer.RequestId, offer.Meaning);
                        _registration = request;
                        response = new
                        {
                            protocol = Protocol, op = operation, nonce,
                            status = "operator_native_registration_challenge_unapproved",
                            service_signed = true, human_approval_verified = false,
                            claim_written = false, request_id = offer.RequestId,
                            ticket_id = request.TicketId,
                            challenge = request.Challenge,
                            user_id = request.UserId,
                            expected_origin = NativeWebAuthnEnrollment.Origin,
                            expires_utc = request.ExpiresUtc.ToString("O"),
                            kind = offer.Kind,
                            source_origin = offer.SourceOrigin,
                            evidence_sha256 = offer.SourceEvidenceSha256,
                            meaning = SignedMeaning(offer.Meaning),
                        };
                    }
                }
            }
            else if (operation == "enroll_key" && ExactKeys(root,
                "protocol", "op", "nonce", "ticketId", "clientDataJSON",
                "authenticatorData", "credentialId"))
            {
                var attempt = _registration;
                _registration = null; // consume even on malformed attestation
                if (attempt is not null
                    && Str(root, "ticketId") == attempt.TicketId
                    && attempt.ExpiresUtc > DateTimeOffset.UtcNow
                    && _ledger.ReadOperatorCredential() is null)
                {
                    var current = _ledger.ReadOperatorReviewOffer(
                        attempt.Meaning.ProjectId, attempt.Meaning.Branch,
                        attempt.Meaning.ProposalRef);
                    if (current is not null && current.RequestId == attempt.RequestId
                        && current.Meaning == attempt.Meaning)
                    {
                        var candidate = NativeWebAuthnEnrollment.ParseUnverifiedRegistration(
                            Str(root, "clientDataJSON"),
                            Str(root, "authenticatorData"),
                            Str(root, "credentialId"), attempt.Challenge);
                        var ticket = _registrationProofCore.Begin(attempt.Meaning, candidate);
                        _registrationPossession = new RegistrationPossession(
                            ticket, candidate, attempt.RequestId);
                        response = new
                        {
                            protocol = Protocol, op = operation, nonce,
                            status = "operator_native_possession_challenge_unapproved",
                            service_signed = true, human_approval_verified = false,
                            claim_written = false,
                            request_id = current.RequestId,
                            ticket_id = ticket.TicketId,
                            challenge = ticket.ChallengeBase64Url,
                            expires_utc = ticket.ExpiresUtc.ToString("O"),
                            credential_id = candidate.CredentialIdBase64Url,
                            expected_origin = candidate.ExpectedOrigin,
                            kind = current.Kind,
                            source_origin = current.SourceOrigin,
                            evidence_sha256 = current.SourceEvidenceSha256,
                            meaning = SignedMeaning(ticket.Meaning),
                        };
                    }
                }
            }
            else if (operation == "enroll_finish" && ExactKeys(root,
                "protocol", "op", "nonce", "ticketId", "assertion"))
            {
                var candidate = _registrationPossession;
                _registrationPossession = null; // single-use, also on bad proof
                if (candidate is not null
                    && Str(root, "ticketId") == candidate.Ticket.TicketId
                    && root.TryGetProperty("assertion", out var assertion)
                    && ExactKeys(assertion, "credentialId", "type",
                        "clientDataJSON", "authenticatorData", "signature"))
                {
                    var item = new BrowserAssertion(
                        Str(assertion, "credentialId") ?? "",
                        Str(assertion, "type") ?? "",
                        Str(assertion, "clientDataJSON") ?? "",
                        Str(assertion, "authenticatorData") ?? "",
                        Str(assertion, "signature") ?? "");
                    var proof = _registrationProofCore.VerifyAndConsume(
                        candidate.Ticket.TicketId, candidate.Ticket.Meaning, item);
                    var saved = proof.Verified && proof.UserPresent && proof.UserVerified
                        ? _ledger.RecordNativeUvEnrollment(candidate.Ticket.Meaning,
                            candidate.Credential, proof)
                        : null;
                    if (saved is not null)
                    {
                        _coordinator = VerifiedReviewCoordinator.ForOperatorCredentialProbe(
                            _ledger);
                        _reaffirmation = OperatorReaffirmationCoordinator.ForNativeCredential(
                            _ledger);
                    }
                    response = new
                    {
                        protocol = Protocol, op = operation, nonce,
                        status = saved is not null
                            ? "operator_native_uv_enrolled_unapproved"
                            : proof.Status,
                        signature_verified = saved is not null,
                        service_signed = true, human_approval_verified = false,
                        claim_written = false,
                        enrollment_state = saved?.EnrollmentState,
                        request_id = saved is not null ? candidate.RequestId : null,
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
