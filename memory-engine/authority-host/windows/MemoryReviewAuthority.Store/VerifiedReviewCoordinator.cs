using MemoryReviewAuthority.Core;
using System.Security.Cryptography;
using System.Text;

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

    public VerifiedReviewCoordinator(
        ProtectedPendingReviewLedger ledger,
        PinnedCredential credential,
        ReviewChallengeCore? challengeCore = null)
    {
        _ledger = ledger ?? throw new ArgumentNullException(nameof(ledger));
        _credential = credential ?? throw new ArgumentNullException(nameof(credential));
        _challengeCore = challengeCore ?? new ReviewChallengeCore();
    }

    /// <summary>
    /// A displayed fact/action may start a challenge only when all exact fields
    /// match a pending row already staged under the protected service identity.
    /// The caller is NOT authenticated here; never expose this method directly
    /// to a model-controlled transport.
    /// </summary>
    public ChallengeTicket Begin(ReviewMeaning meaning)
    {
        VerifyPendingMeaning(meaning);
        return _challengeCore.Begin(meaning, _credential);
    }

    /// <summary>
    /// Consumes each ticket before cryptographic verification. Verification
    /// alone is NOT a Claim: this only records a once-only UV-backed intent
    /// in the service-owned database. There is no Claim promotion API here.
    /// </summary>
    public VerifiedReviewCompletion Complete(
        string ticketId, ReviewMeaning meaning, BrowserAssertion assertion)
    {
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

/// <summary>Never a signed portable approval or canonical Claim.</summary>
public sealed record VerifiedReviewCompletion(
    bool Verified,
    string Status,
    string? Disposition = null,
    string? RequestId = null,
    bool ApprovedClaim = false,
    bool ClaimWritten = false);
