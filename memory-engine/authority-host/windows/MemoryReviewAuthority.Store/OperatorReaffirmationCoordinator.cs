using MemoryReviewAuthority.Core;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// Host-only, not wired to any UI or IPC. A synthetic test key cannot pass
/// the native credential gate, and this flow NEVER writes a memory Claim.
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
    /// An approval-purpose challenge is distinct from an enrollment or
    /// possession ticket; neither is itself user consent.
    /// </summary>
    public ChallengeTicket Begin(ReviewMeaning meaning)
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
        if (_ledger.ReadOperatorReaffirmationIntent(
                meaning.ProjectId, meaning.Branch, meaning.ProposalRef) is not null)
            throw new InvalidOperationException("reaffirmation_intent_already_recorded");
        return _core.BeginProtectedApproval(meaning, _nativeCredential);
    }

    /// <summary>
    /// Consumes and verifies the approval-purpose ticket before the protected
    /// SQLite BEGIN IMMEDIATE transaction. No bearer authorization is returned,
    /// and no Claim / verified-review-intent row is ever created.
    /// </summary>
    public OperatorReaffirmationCompletion Complete(
        string ticketId, ReviewMeaning meaning, BrowserAssertion assertion)
    {
        var proof = _core.VerifyProtectedApprovalAndConsume(
            ticketId, meaning, assertion);
        if (!proof.Verified || !proof.UserPresent || !proof.UserVerified
            || proof.Status != "verified_protected_approval_intent_only")
            return new(false, proof.Status);
        try
        {
            var intent = _ledger.RecordOperatorReaffirmationIntent(
                meaning, _nativeCredential, proof);
            return new(true, "operator_reaffirmation_intent_recorded_no_claim",
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
