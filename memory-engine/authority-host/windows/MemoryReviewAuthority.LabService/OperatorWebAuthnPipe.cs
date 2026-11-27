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
internal sealed partial class OperatorWebAuthnPipe : IDisposable
{
    internal const string PipeName = "AgentHubMemoryReviewLab-OperatorV1";
    internal const string Protocol = "agenthub-operator-uv-service-v1";
    private readonly ProtectedPendingReviewLedger _ledger;
    private readonly string _stateDir;
    private readonly PendingReview? _comparisonOnlySnapshot;
    private ConflictReviewCoordinator? _conflictReview;
    private readonly bool _comparisonEnrollmentEnabled;
    private string? _offeredComparisonSha;
    private VerifiedReviewCoordinator? _coordinator;
    private OperatorReaffirmationCoordinator? _reaffirmation;
    private ChallengeTicket? _activeReaffirmation;
    private OperatorDirectClaimCoordinator? _publisher;
    private ChallengeTicket? _activePublish;
    private const string SyntheticPublishCiMarker =
        "agenthub-synthetic-direct-claim-ci-only.enable";
    private const string SyntheticPublishCiPolicy =
        "AGENTHUB_SYNTHETIC_DIRECT_CLAIM_CI_ONLY_V1";

    // Fail-closed: preview installers NEVER create this protected marker.
    // Only the disposable Windows GitHub runner's SCM fixture can opt in
    // to synthetic private Claim writes. Not a production feature flag.
    private static bool IsExplicitSyntheticCiPublishFixture(string stateDir)
    {
        var path = Path.Combine(stateDir, SyntheticPublishCiMarker);
        var item = new FileInfo(path);
        if (!item.Exists || item.Length is < 10 or > 128
            || (item.Attributes & FileAttributes.ReparsePoint) != 0)
            return false;
        return File.ReadAllText(path, Encoding.UTF8) == SyntheticPublishCiPolicy;
    }
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

    internal OperatorWebAuthnPipe(ProtectedPendingReviewLedger ledger, string stateDir,
        OneShotCiRecipientPipe? ciRecipient = null,
        OneShotCiRegistryFence? ciRegistryFence = null,
        PendingReview? comparisonOnlySnapshot = null, bool comparisonEnrollmentEnabled = false)
    {
        _ledger = ledger ?? throw new ArgumentNullException(nameof(ledger));
        _stateDir = stateDir;
        _comparisonOnlySnapshot = comparisonOnlySnapshot;
        _comparisonEnrollmentEnabled = comparisonEnrollmentEnabled;
        if (comparisonEnrollmentEnabled && comparisonOnlySnapshot is null)
            throw new InvalidOperationException("comparison_enrollment_scope_required");
        if (comparisonOnlySnapshot is not null && (ciRecipient is not null || ciRegistryFence is not null))
            throw new InvalidOperationException("comparison_only_conflicts_with_ci_read");
        if ((ciRecipient is null) != (ciRegistryFence is null))
            throw new InvalidOperationException("ci_one_shot_registry_fence_required");
        _ciRecipient = ciRecipient;
        _ciRegistryFence = ciRegistryFence;
        var operatorCredential = comparisonOnlySnapshot is null ? _ledger.ReadOperatorCredential() : null;
        if (operatorCredential is not null)
            _coordinator = VerifiedReviewCoordinator.ForOperatorCredentialProbe(ledger);
        if (operatorCredential?.EnrollmentState == ProtectedPendingReviewLedger.NativeEnrollmentState)
        {
            _reaffirmation = OperatorReaffirmationCoordinator.ForNativeCredential(ledger);
            if (IsExplicitSyntheticCiPublishFixture(stateDir))
                _publisher = OperatorDirectClaimCoordinator.ForNativeCredential(ledger);
        }
        if (comparisonOnlySnapshot is not null &&
            _ledger.ReadOperatorCredential()?.EnrollmentState == ProtectedPendingReviewLedger.NativeEnrollmentState)
            _conflictReview = new ConflictReviewCoordinator(_ledger);
        _signer = ServiceSigningIdentity.OpenOrCreate(stateDir);
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

    internal static bool IsComparisonInspectionRequest(JsonElement root, PendingReview snapshot)
        => ExactKeys(root, "protocol", "op", "nonce", "projectId", "branch", "proposalRef")
            && Str(root, "protocol") == Protocol
            && ValidNonce(Str(root, "nonce"))
            && Str(root, "op") == "comparison_inspect"
            && Str(root, "projectId") == snapshot.ProjectId
            && Str(root, "branch") == snapshot.Branch
            && Str(root, "proposalRef") == snapshot.ProposalRef;

    private ProtectedOperatorReviewOffer? ReadEnrollmentOffer(string project,string branch,string proposal)
    {
        if (_comparisonOnlySnapshot is null)
            return _ledger.ReadOperatorReviewOffer(project,branch,proposal);
        if (!_comparisonEnrollmentEnabled) return null;
        var p=_comparisonOnlySnapshot;
        if (project!=p.ProjectId || branch!=p.Branch || proposal!=p.ProposalRef) return null;
        var offer=_ledger.ReadComparisonEnrollmentOffer();
        return offer?.Meaning.ReviewSnapshotSha256==p.ReviewSnapshotSha256 ? offer : null;
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
            var comparisonEnrollment = _comparisonOnlySnapshot is not null && _comparisonEnrollmentEnabled
                && operation is ("enroll_begin" or "enroll_key" or "enroll_finish");
            if (_comparisonOnlySnapshot is not null && !comparisonEnrollment)
            {
                // Exclusive comparison lane: no enrollment, disclosure or
                // Claim publication. Existing native credential can record an intent only.
                if (IsComparisonInspectionRequest(root, _comparisonOnlySnapshot))
                {
                    var preview = _ledger.InspectOperatorPinnedEvidence(includeLocalContent: true);
                    if (preview.Review != _comparisonOnlySnapshot || preview.ActiveClaims.Count == 0)
                        return;
                    var review = preview.Review;
                    _offeredComparisonSha = null;
                    response = new
                    {
                        protocol = Protocol, op = operation, nonce,
                        status = "operator_comparison_preview_no_approval",
                        service_signed = true, human_approval_verified = false,
                        claim_written = false,
                        meaning = SignedMeaning(new ReviewMeaning(review.ProjectId, review.Branch,
                            review.RevisionSha, review.ProposalRef, review.ReviewSnapshotSha256,
                            review.CanonicalFactSha256, review.RequestedAction, preview.CanonicalFact!)),
                        kind = preview.Kind, evidence_sha256 = review.SourceEvidenceSha256,
                        comparison_sha256 = preview.ComparisonSha256,
                        conflict_intent_available = _conflictReview?.CanBegin(preview) == true,
                        conflict_intent_status = _ledger.ReadConflictIntentStatus(preview),
                        total = preview.ActiveClaims.Count,
                        claims = preview.ActiveClaims.Select(c => new
                        {
                            claim_ref = c.ClaimRef, value_sha256 = c.ValueSha256,
                            exact_duplicate = c.ExactDuplicate, value = c.LocalValue,
                        }).ToArray(),
                    };
                    // Preserve the existing signed-response budget. Never
                    // return a partial comparison as if it were complete.
                    if (JsonSerializer.SerializeToUtf8Bytes(response).Length > 11_500)
                        response = new
                        {
                            protocol = Protocol, op = operation, nonce,
                            status = "operator_comparison_preview_too_large",
                            service_signed = true, human_approval_verified = false,
                            claim_written = false,
                        };
                    else
                        _offeredComparisonSha = preview.ComparisonSha256;
                }
                else if (operation == "conflict_begin" && _conflictReview is not null
                    && ExactKeys(root, "protocol", "op", "nonce", "projectId", "branch",
                        "proposalRef", "snapshotSha256", "comparisonSha256")
                    && Str(root,"projectId") == _comparisonOnlySnapshot.ProjectId
                    && Str(root,"branch") == _comparisonOnlySnapshot.Branch
                    && Str(root,"proposalRef") == _comparisonOnlySnapshot.ProposalRef
                    && Str(root,"snapshotSha256") == _comparisonOnlySnapshot.ReviewSnapshotSha256
                    && _offeredComparisonSha is not null
                    && Str(root,"comparisonSha256") == _offeredComparisonSha)
                {
                    var comparison = _offeredComparisonSha;
                    _offeredComparisonSha = null;
                    var ticket = _conflictReview.Begin(_comparisonOnlySnapshot.ReviewSnapshotSha256, comparison);
                    var key = _ledger.ReadOperatorCredential()
                        ?? throw new InvalidOperationException("conflict_review_native_key_missing");
                    response = new
                    {
                        protocol = Protocol, op = operation, nonce,
                        status = "conflict_review_challenge_no_claim",
                        service_signed = true, human_approval_verified = false, claim_written = false,
                        canonical_freshness_verified = false,
                        comparison_sha256 = comparison,
                        meaning = SignedMeaning(ticket.Meaning),
                        ticket_id = ticket.TicketId, challenge = ticket.ChallengeBase64Url,
                        expires_utc = ticket.ExpiresUtc.ToString("O"),
                        credential_id = key.Credential.CredentialIdBase64Url,
                        expected_origin = key.Credential.ExpectedOrigin,
                    };
                }
                else if (operation == "conflict_complete" && _conflictReview is not null)
                {
                    // Any recognizable completion consumes the outstanding
                    // ticket, even if the submitted envelope is malformed.
                    var item = new BrowserAssertion("","","","","");
                    string ticketId = "";
                    if (ExactKeys(root,"protocol","op","nonce","ticketId","assertion")
                        && root.TryGetProperty("assertion",out var assertion)
                        && ExactKeys(assertion,"credentialId","type","clientDataJSON","authenticatorData","signature"))
                    {
                        ticketId = Str(root,"ticketId") ?? "";
                        item = new BrowserAssertion(Str(assertion,"credentialId") ?? "",
                            Str(assertion,"type") ?? "", Str(assertion,"clientDataJSON") ?? "",
                            Str(assertion,"authenticatorData") ?? "", Str(assertion,"signature") ?? "");
                    }
                    var result = _conflictReview.Complete(ticketId,item);
                    response = new
                    {
                        protocol = Protocol, op = operation, nonce, status = result.Status,
                        service_signed = true, human_approval_verified = false, claim_written = false,
                        canonical_freshness_verified = false, signature_verified = result.Verified,
                        receipt = result.Receipt is { } receipt ? new
                        {
                            projectId = receipt.ProjectId, branch = receipt.Branch, proposalRef = receipt.ProposalRef,
                            snapshot_sha256 = receipt.SnapshotSha256, comparison_sha256 = receipt.ComparisonSha256,
                            decision = receipt.Decision,
                        } : null,
                    };
                }
            }
            else if (operation == "ci_read_revoke")
            {
                response = RevokeCiOneShot(root,nonce);
            }
            else if (operation == "ci_read_begin")
            {
                response = BeginCiOneShotRead(root, nonce,
                    stream as NamedPipeServerStream);
            }
            else if (operation == "ci_read_complete")
            {
                response = CompleteCiOneShotRead(root, nonce);
            }
            else if (operation == "read_begin")
            {
                response = BeginReadDisclosure(root, nonce,
                    stream as NamedPipeServerStream);
            }
            else if (operation == "read_complete")
            {
                response = CompleteReadDisclosure(root, nonce);
            }
            else if (operation == "begin" && ExactKeys(root,
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
            else if (operation == "publish_begin" && ExactKeys(root,
                "protocol", "op", "nonce", "projectId", "branch", "proposalRef")
                && _publisher is not null)
            {
                // Separate explicit Memory publication consent. The first
                // reaffirmation is required but can NEVER be reused as the
                // signed publication gesture.
                var project = Str(root, "projectId");
                var branch = Str(root, "branch");
                var proposal = Str(root, "proposalRef");
                if (project is { Length: > 0 and <= 256 }
                    && branch is { Length: > 0 and <= 128 }
                    && Regex.IsMatch(proposal ?? "", @"\AE~[0-9a-f]{10}\z")
                    && (_activePublish is null
                        || _activePublish.ExpiresUtc <= DateTimeOffset.UtcNow))
                {
                    var offer = _ledger.ReadOperatorReviewOffer(project, branch, proposal!);
                    if (offer is not null && offer.Meaning.Decision == "confirm"
                        && offer.Kind is "knowledge" or "preference")
                    {
                        var ticket = _publisher.Begin(offer.Meaning);
                        _activePublish = ticket;
                        var native = _ledger.ReadOperatorCredential()
                            ?? throw new InvalidOperationException("native_credential_missing");
                        response = new
                        {
                            protocol = Protocol, op = operation, nonce,
                            status = "operator_direct_claim_publication_challenge",
                            service_signed = true, human_approval_verified = false,
                            claim_written = false,
                            published_to_codex = false,
                            original_evidence_verified = false,
                            confirmation_scope = "publish_new_user_direct_memory_claim",
                            provenance = ProtectedPendingReviewLedger.OperatorDirectClaimOrigin,
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
            else if (operation == "publish_complete" && ExactKeys(root,
                "protocol", "op", "nonce", "ticketId", "assertion")
                && _publisher is not null)
            {
                var pending = _activePublish;
                _activePublish = null; // consume at first attempt
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
                    var result = _publisher.Complete(
                        pending.TicketId, pending.Meaning, item);
                    response = new
                    {
                        protocol = Protocol, op = operation, nonce,
                        status = result.Status,
                        signature_verified = result.ClaimWritten,
                        service_signed = true,
                        human_approval_verified = false,
                        claim_written = result.ClaimWritten,
                        published_to_codex = false,
                        original_evidence_verified = false,
                        provenance = result.Provenance,
                        claim_id = result.ClaimId,
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
                    var offer = ReadEnrollmentOffer(project, branch, proposal!);
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
                    var current = ReadEnrollmentOffer(
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
                        ? (comparisonEnrollment
                            ? _ledger.RecordNativeComparisonUvEnrollment(candidate.Ticket.Meaning,candidate.Credential,proof)
                            : _ledger.RecordNativeUvEnrollment(candidate.Ticket.Meaning,candidate.Credential,proof))
                        : null;
                    if (saved is not null && comparisonEnrollment)
                        _conflictReview = new ConflictReviewCoordinator(_ledger);
                    else if (saved is not null)
                    {
                        _coordinator = VerifiedReviewCoordinator.ForOperatorCredentialProbe(
                            _ledger);
                        _reaffirmation = OperatorReaffirmationCoordinator.ForNativeCredential(
                            _ledger);
                        if (IsExplicitSyntheticCiPublishFixture(_stateDir))
                            _publisher = OperatorDirectClaimCoordinator.ForNativeCredential(
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
