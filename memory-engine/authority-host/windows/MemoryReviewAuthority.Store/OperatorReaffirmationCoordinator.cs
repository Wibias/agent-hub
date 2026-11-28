using MemoryReviewAuthority.Core;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// Protected host coordinator. Renewal is not exposed through UI or IPC.
/// This flow NEVER writes a memory Claim.
/// The operator's protected statement reaffirmation is a new intent, not
/// independent authentication of the original user-writable evidence.
/// </summary>
public sealed class OperatorReaffirmationCoordinator
{
    private readonly ProtectedPendingReviewLedger _ledger;
    private readonly ReviewChallengeCore _core;
    private readonly PinnedCredential _nativeCredential;

    private OperatorReaffirmationCoordinator(
        ProtectedPendingReviewLedger ledger, ReviewChallengeCore core,
        PinnedCredential nativeCredential)
    {
        _ledger = ledger;
        _core = core;
        _nativeCredential = nativeCredential;
    }

    public static OperatorReaffirmationCoordinator ForNativeCredential(
        ProtectedPendingReviewLedger ledger, ReviewChallengeCore? core = null)
    {
        ArgumentNullException.ThrowIfNull(ledger);
        var credential = ledger.ReadOperatorCredential();
        if (credential is null
            || credential.EnrollmentState != ProtectedPendingReviewLedger.NativeEnrollmentState)
            throw new InvalidOperationException("reaffirmation_native_enrollment_required");
        return new OperatorReaffirmationCoordinator(
            ledger, core ?? new ReviewChallengeCore(), credential.Credential);
    }

    /// <summary>
    /// Exact protected E~ lookup. No caller-injected source or trust-bit.
    /// A reaffirmation-purpose challenge is distinct from an enrollment or
    /// possession ticket; neither is itself user consent.
    /// </summary>
    private void ValidateOffer(ReviewMeaning meaning)
    {
        if (meaning is null)
            throw new ArgumentException("reaffirmation_meaning_required");
        var offer = _ledger.ReadOperatorReviewOffer(
            meaning.ProjectId, meaning.Branch, meaning.ProposalRef);
        if (offer is null || offer.Meaning != meaning
            || offer.Meaning.Decision != "confirm"
            || offer.SourceOrigin != ProtectedPendingReviewLedger.OperatorSourceOrigin
            || offer.Kind is not ("knowledge" or "preference"))
            throw new InvalidOperationException("reaffirmation_offer_not_supported");
        var source = _ledger.ReadCurrentServiceOwnedSource(meaning);
        if (source is null || source.Relation != "unrelated"
            || source.RelatedClaimId is not null)
            throw new InvalidOperationException("reaffirmation_relation_not_supported");
    }

    public ChallengeTicket Begin(ReviewMeaning meaning)
    {
        ValidateOffer(meaning);
        if (_ledger.ReadOperatorReaffirmationIntent(
                meaning.ProjectId, meaning.Branch, meaning.ProposalRef) is not null)
            throw new InvalidOperationException("reaffirmation_intent_already_recorded");
        return _core.BeginOperatorReaffirmation(meaning, _nativeCredential);
    }

    public ChallengeTicket BeginRenewal(ReviewMeaning meaning)
    {
        ValidateOffer(meaning);
        var previous = _ledger.ReadOperatorReaffirmationIntent(meaning.ProjectId, meaning.Branch, meaning.ProposalRef);
        if (previous is null || !ProtectedPendingReviewLedger.IsExpiredOperatorReaffirmation(previous.RecordedAtUtc, DateTimeOffset.UtcNow))
            throw new InvalidOperationException("reaffirmation_renewal_requires_expired_receipt");
        if (_ledger.HasOperatorDirectClaim(previous.RequestId))
            throw new InvalidOperationException("reaffirmation_already_published");
        return _core.BeginOperatorReaffirmationRenewal(meaning, _nativeCredential, previous.BindingSha256);
    }

    /// <summary>
    /// Consumes and verifies the reaffirmation-purpose ticket before the protected
    /// SQLite BEGIN IMMEDIATE transaction. No bearer authorization is returned,
    /// and no Claim / verified-review-intent row is ever created.
    /// </summary>
    public OperatorReaffirmationCompletion Complete(
        string ticketId, ReviewMeaning meaning, BrowserAssertion assertion)
    {
        return Record(meaning, _core.VerifyOperatorReaffirmationAndConsume(ticketId, meaning, assertion),
            "verified_operator_reaffirmation_intent_only");
    }

    public OperatorReaffirmationCompletion CompleteRenewal(
        string ticketId, ReviewMeaning meaning, BrowserAssertion assertion)
        => Record(meaning, _core.VerifyOperatorReaffirmationRenewalAndConsume(ticketId, meaning, assertion),
            "verified_operator_reaffirmation_renewal_intent_only");

    private OperatorReaffirmationCompletion Record(ReviewMeaning meaning, VerificationResult proof, string requiredStatus)
    {
        if (!proof.Verified || !proof.UserPresent || !proof.UserVerified
            || proof.Status != requiredStatus)
            return new(false, proof.Status);
        try
        {
            var intent = _ledger.RecordOperatorReaffirmationIntent(
                meaning, _nativeCredential, proof);
            return new(true, requiredStatus == "verified_operator_reaffirmation_renewal_intent_only"
                ? "operator_reaffirmation_renewal_recorded_no_claim"
                : "operator_reaffirmation_intent_recorded_no_claim",
                intent.RequestId);
        }
        catch (Exception e) when (e is InvalidOperationException
            or ArgumentException or SqliteException)
        {
            return new(false, "operator_reaffirmation_scope_or_commit_denied");
        }
    }
}

public sealed record OperatorReaffirmationCompletion(
    bool Verified,
    string Status,
    string? RequestId = null,
    bool HistoricalEvidenceVerified = false,
    bool ClaimWritten = false);
