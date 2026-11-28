using MemoryReviewAuthority.Core;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// Host-internal, DEFAULT-OFF consent-to-publish coordinator.
/// Reaffirmation is NOT publication; a distinct fresh native WebAuthn
/// gesture is required. No service IPC, UI action or Codex hook calls this.
/// </summary>
public sealed class OperatorDirectClaimCoordinator
{
    private readonly ProtectedPendingReviewLedger _ledger;
    private readonly PinnedCredential _nativeCredential;
    private readonly ReviewChallengeCore _core;

    private OperatorDirectClaimCoordinator(
        ProtectedPendingReviewLedger ledger,
        PinnedCredential credential, ReviewChallengeCore core)
    {
        _ledger = ledger;
        _nativeCredential = credential;
        _core = core;
    }

    public static OperatorDirectClaimCoordinator ForNativeCredential(
        ProtectedPendingReviewLedger ledger, ReviewChallengeCore? core = null)
    {
        ArgumentNullException.ThrowIfNull(ledger);
        var native = ledger.ReadOperatorCredential();
        if (native?.EnrollmentState != ProtectedPendingReviewLedger.NativeEnrollmentState)
            throw new InvalidOperationException("direct_claim_native_enrollment_required");
        return new OperatorDirectClaimCoordinator(
            ledger, native.Credential, core ?? new ReviewChallengeCore());
    }

    /// <summary>
    /// Can start only after a protected reaffirmation intent for the exact
    /// E~ statement exists. Never trusts caller-supplied fact/source values.
    /// A ticket contains no transferable authorization and writes nothing.
    /// </summary>
    public ChallengeTicket Begin(ReviewMeaning meaning)
    {
        if (meaning is null || meaning.Decision != "confirm")
            throw new InvalidOperationException("direct_claim_not_a_confirmation");
        var current = _ledger.ReadOperatorReviewOffer(
            meaning.ProjectId, meaning.Branch, meaning.ProposalRef);
        if (current is null || current.Meaning != meaning
            || current.SourceOrigin != ProtectedPendingReviewLedger.OperatorSourceOrigin
            || current.Kind is not ("knowledge" or "preference"))
            throw new InvalidOperationException("direct_claim_invalid_source_offer");
        var reaffirmed = _ledger.ReadOperatorReaffirmationIntent(
            meaning.ProjectId, meaning.Branch, meaning.ProposalRef);
        if (reaffirmed is null || reaffirmed.RequestId != current.RequestId
            || reaffirmed.CanonicalFactSha256 != meaning.CanonicalFactSha256
            || reaffirmed.HistoricalEvidenceVerified
            || reaffirmed.ClaimWritten)
            throw new InvalidOperationException("direct_claim_reaffirmation_missing");
        if (!ProtectedPendingReviewLedger.IsFreshOperatorReaffirmation(
                reaffirmed.RecordedAtUtc, DateTimeOffset.UtcNow))
            throw new InvalidOperationException("direct_claim_reaffirmation_missing_or_stale");
        if (reaffirmed.Generation <= 0)
            throw new InvalidOperationException("direct_claim_legacy_reaffirmation_requires_renewal");
        if (_ledger.ReadOperatorDirectClaims(meaning.ProjectId, meaning.Branch)
            .Any(c => c.RequestId == current.RequestId
                || c.FactSha256 == meaning.CanonicalFactSha256))
            throw new InvalidOperationException("direct_claim_already_recorded");
        return _core.BeginBoundOperatorClaimCommit(meaning, _nativeCredential, reaffirmed.BindingSha256);
    }

    /// <summary>
    /// The one-use ticket is consumed even when a transaction is denied.
    /// The atomic protected WAL commit remains independently guarded.
    /// </summary>
    public OperatorDirectClaimCompletion Complete(
        string ticketId, ReviewMeaning meaning, BrowserAssertion assertion)
    {
        var proof = _core.VerifyBoundOperatorClaimCommitAndConsume(ticketId, meaning, assertion);
        if (!proof.Verified || !proof.UserPresent || !proof.UserVerified
            || proof.Status != "verified_bound_operator_claim_commit_intent_only")
            return new(false, proof.Status);
        try
        {
            var claim = _ledger.CommitOperatorDirectClaim(meaning, _nativeCredential, proof);
            return new(true, "protected_user_direct_claim_committed_not_published_to_codex",
                claim.ClaimId, claim.Provenance);
        }
        catch (Exception error) when (error is InvalidOperationException
            or SqliteException or ArgumentException)
        {
            return new(false, "direct_claim_transaction_denied");
        }
    }
}

public sealed record OperatorDirectClaimCompletion(
    bool ClaimWritten,
    string Status,
    string? ClaimId = null,
    string? Provenance = null,
    bool HistoricalEvidenceVerified = false,
    bool PublishedToCodex = false);
