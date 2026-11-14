using MemoryReviewAuthority.Core;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// Protected-host orchestration, NOT an IPC or user-facing authorization API.
/// The host must independently derive and display every PendingReview and
/// enroll the pinned credential. The current lab uses only synthetic inputs.
/// </summary>
public sealed class VerifiedReviewCoordinator
{
    private readonly ProtectedPendingReviewLedger _ledger;
    private readonly ReviewChallengeCore _challengeCore;
    private readonly PinnedCredential _credential;
    private readonly bool _operatorProbeOnly;

    public VerifiedReviewCoordinator(
        ProtectedPendingReviewLedger ledger,
        PinnedCredential credential,
        ReviewChallengeCore? challengeCore = null)
    {
        _ledger = ledger ?? throw new ArgumentNullException(nameof(ledger));
        _credential = credential ?? throw new ArgumentNullException(nameof(credential));
        _challengeCore = challengeCore ?? new ReviewChallengeCore();
        _operatorProbeOnly = false;
    }

    private VerifiedReviewCoordinator(ProtectedPendingReviewLedger ledger,
        PinnedCredential credential, ReviewChallengeCore core, bool operatorProbeOnly)
    {
        _ledger = ledger;
        _credential = credential;
        _challengeCore = core;
        _operatorProbeOnly = operatorProbeOnly;
    }

    /// <summary>
    /// An operator-probe coordinator can only be constructed using the
    /// service-owned pin, NOT a caller-supplied PinnedCredential. This is
    /// still an UNVERIFIED registration, not a human-approved enrollment.
    /// </summary>
    public static VerifiedReviewCoordinator ForOperatorCredentialProbe(
        ProtectedPendingReviewLedger ledger, ReviewChallengeCore? core = null)
    {
        if (ledger is null) throw new ArgumentNullException(nameof(ledger));
        var credential = ledger.ReadOperatorCredential();
        if (credential is null
            || credential.EnrollmentState !=
                ProtectedPendingReviewLedger.OperatorCredentialState)
            throw new InvalidOperationException("operator_credential_not_enrolled");
        return new VerifiedReviewCoordinator(ledger, credential.Credential,
            core ?? new ReviewChallengeCore(), true);
    }

    /// <summary>
    /// A displayed fact/action may start a challenge only when all exact fields
    /// match a pending row already staged under the protected service identity.
    /// The caller is NOT authenticated here; never expose this method directly
    /// to a model-controlled transport.
    /// </summary>
    public ChallengeTicket Begin(ReviewMeaning meaning)
    {
        if (_operatorProbeOnly)
            throw new InvalidOperationException("operator_probe_has_no_review_authority");
        VerifyPendingMeaning(meaning);
        return _challengeCore.Begin(meaning, _credential);
    }

    /// <summary>
    /// A real E~ is displayed from service-owned pending state, and an exact
    /// WebAuthn challenge is created using the persisted operator credential.
    /// The caller-facing browser transport does not exist yet, deliberately.
    /// </summary>
    public ChallengeTicket BeginOperatorProof(ReviewMeaning meaning)
    {
        if (!_operatorProbeOnly)
            throw new InvalidOperationException("operator_proof_requires_protected_pin");
        VerifyPendingMeaning(meaning);
        var source = _ledger.ReadCurrentServiceOwnedSource(meaning);
        if (source is null)
            throw new InvalidOperationException("operator_source_not_staged");
        return _challengeCore.Begin(meaning, _credential);
    }

    /// <summary>
    /// Verify a real browser WebAuthn assertion using the protected pinned
    /// key. Consume the ticket once, persist a monotonic nonzero sign counter
    /// across restart, but NEVER create an approval intent or protected Claim.
    /// </summary>
    public VerifiedReviewCompletion CompleteOperatorProof(
        string ticketId, ReviewMeaning meaning, BrowserAssertion assertion)
    {
        if (!_operatorProbeOnly)
            return new(false, "operator_proof_requires_protected_pin");
        var proof = _challengeCore.VerifyAndConsume(ticketId, meaning, assertion);
        if (!proof.Verified || !proof.UserPresent || !proof.UserVerified)
            return new(false, proof.Status);
        try
        {
            VerifyPendingMeaning(meaning);
            _ledger.RecordOperatorCredentialProof(meaning, _credential, proof);
            return new(true, "operator_webauthn_uv_verified_not_approved",
                ApprovedClaim: false, ClaimWritten: false);
        }
        catch (Exception e) when (e is InvalidOperationException
            or ArgumentException or SqliteException)
        {
            return new(false, "operator_proof_scope_or_counter_denied");
        }
    }

    /// <summary>
    /// Consumes each ticket before cryptographic verification. Verification
    /// alone is NOT a Claim: this only records a once-only UV-backed intent
    /// in the service-owned database. There is no Claim promotion API here.
    /// </summary>
    public VerifiedReviewCompletion Complete(
        string ticketId, ReviewMeaning meaning, BrowserAssertion assertion)
    {
        if (_operatorProbeOnly)
            return new(false, "operator_probe_has_no_review_authority");
        // The core owns its bounded, one-use ticket map. It checks exact
        // equality with the meaning used at Begin; no second unbounded map.
        var proof = _challengeCore.VerifyAndConsume(ticketId, meaning, assertion);
        if (!proof.Verified || !proof.UserVerified || !proof.UserPresent)
            return new(false, proof.Status);

        try
        {
            VerifyPendingMeaning(meaning);
            var recorded = _ledger.RecordVerifiedIntent(meaning, _credential, proof);
            return new(true, "verified_intent_recorded_no_claim",
                recorded.Disposition, recorded.RequestId);
        }
        catch (InvalidOperationException)
        {
            return new(false, "pending_scope_or_commit_denied");
        }
    }

    /// <summary>
    /// The opt-in host-only protected Claim path. Every real confirmation
    /// requires the exact UV assertion plus a previously staged immutable
    /// protected source row bound to the same request ID. No caller-provided
    /// callback can supply or replace the current trusted source at decision
    /// time. The only source writer currently exposed is synthetic CI, not
    /// a source-verifying production import. Real E~ authorization remains OFF.
    /// Rejection records an immutable decision but no Claim.
    /// </summary>
    public VerifiedReviewCompletion CompleteProtected(
        string ticketId, ReviewMeaning meaning, BrowserAssertion assertion)
    {
        if (_operatorProbeOnly)
            return new(false, "operator_probe_has_no_review_authority");
        // Consume on first attempt, even when no host source is installed or
        // the assertion is invalid. No reusable "approved" token is returned.
        var proof = _challengeCore.VerifyAndConsume(ticketId, meaning, assertion);
        if (!proof.Verified || !proof.UserVerified || !proof.UserPresent)
            return new(false, proof.Status);
        try
        {
            VerifyPendingMeaning(meaning);
            var trusted = _ledger.ReadCurrentServiceOwnedSource(meaning);
            if (trusted is null)
                return new(false, "protected_review_source_not_staged");
            // The ledger will resolve the same immutable source AGAIN inside
            // BEGIN IMMEDIATE, then commit the decision + Claim atomically.
            var saved = _ledger.CommitReviewedDecision(
                meaning, _credential, proof);
            return new(true,
                saved.ClaimWritten
                    ? "protected_claim_written"
                    : "verified_rejection_no_claim",
                saved.Disposition, saved.RequestId,
                // The only supported source origin is a synthetic lab
                // fixture. Writing that fixture is NOT human approval.
                ApprovedClaim: false,
                ClaimWritten: saved.ClaimWritten);
        }
        catch (Exception error) when (error is InvalidOperationException
            or SqliteException or ArgumentException)
        {
            return new(false, "protected_review_scope_or_commit_denied");
        }
    }

    private void VerifyPendingMeaning(ReviewMeaning meaning)
    {
        if (meaning is null || meaning.CanonicalFact is null)
            throw new ArgumentException("review_meaning_required");

        var hash = Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes(meaning.CanonicalFact))).ToLowerInvariant();
        if (hash != meaning.CanonicalFactSha256)
            throw new InvalidOperationException("canonical_fact_hash_mismatch");

        var pending = _ledger.ReadPending(
            meaning.ProjectId, meaning.Branch, meaning.ProposalRef);
        if (pending is null
            || pending.Review.RevisionSha != meaning.RevisionSha
            || pending.Review.ReviewSnapshotSha256 != meaning.ReviewSnapshotSha256
            || pending.Review.CanonicalFactSha256 != meaning.CanonicalFactSha256
            || pending.Review.RequestedAction != meaning.Decision)
            throw new InvalidOperationException("pending_review_scope_mismatch");
    }
}

/// <summary>Process-local result, never a transferable approval token. ClaimWritten\n/// applies only to the opt-in protected ledger, not canonical user SQLite.</summary>
public sealed record VerifiedReviewCompletion(
    bool Verified,
    string Status,
    string? Disposition = null,
    string? RequestId = null,
    bool ApprovedClaim = false,
    bool ClaimWritten = false);
