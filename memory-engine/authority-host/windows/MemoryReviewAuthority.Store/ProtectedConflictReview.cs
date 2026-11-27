using MemoryReviewAuthority.Core;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

// A decision about one pinned comparison, never historical evidence
// authentication, canonical freshness, a publication grant or a Claim.
public sealed record ConflictReviewReceipt(
    string ProjectId, string Branch, string ProposalRef, string SnapshotSha256,
    string ComparisonSha256, string Decision, uint SignCount,
    bool ClaimWritten = false, bool CanonicalFreshnessVerified = false);

public sealed record ConflictReviewCompletion(bool Verified, string Status,
    ConflictReviewReceipt? Receipt = null);

public sealed partial class ProtectedPendingReviewLedger
{
    private static void InitializeConflictReviewSchema(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS protected_conflict_review_intents (
                project_id TEXT NOT NULL, branch TEXT NOT NULL, proposal_ref TEXT NOT NULL,
                revision_sha TEXT NOT NULL CHECK(length(revision_sha)=40),
                snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64),
                comparison_sha256 TEXT NOT NULL CHECK(length(comparison_sha256)=64),
                fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64),
                evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
                decision TEXT NOT NULL CHECK(decision IN ('confirm','reject')),
                credential_sha256 TEXT NOT NULL CHECK(length(credential_sha256)=64),
                sign_count INTEGER NOT NULL CHECK(sign_count BETWEEN 0 AND 4294967295),
                recorded_at_utc TEXT NOT NULL,
                PRIMARY KEY(project_id,branch,proposal_ref)
            ) STRICT;
            CREATE TRIGGER IF NOT EXISTS deny_conflict_review_update
              BEFORE UPDATE ON protected_conflict_review_intents
              BEGIN SELECT RAISE(ABORT,'conflict_review_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_conflict_review_delete
              BEFORE DELETE ON protected_conflict_review_intents
              BEGIN SELECT RAISE(ABORT,'conflict_review_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_conflict_review_replace
              BEFORE INSERT ON protected_conflict_review_intents
              WHEN EXISTS(SELECT 1 FROM protected_conflict_review_intents
                WHERE project_id=NEW.project_id AND branch=NEW.branch AND proposal_ref=NEW.proposal_ref)
              BEGIN SELECT RAISE(ABORT,'conflict_review_immutable'); END;
            """;
        cmd.ExecuteNonQuery();
    }

    // Read-only recovery for an uncertain completion outcome. A receipt
    // from another snapshot is NOT authority for the current comparison.
    public string ReadConflictIntentStatus(OperatorEvidenceInspection inspection)
    {
        EnsureOpen();
        var review = inspection.Review;
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = """
            SELECT revision_sha,snapshot_sha256,comparison_sha256,fact_sha256,
                   evidence_sha256,decision
            FROM protected_conflict_review_intents
            WHERE project_id=$project AND branch=$branch AND proposal_ref=$proposal;
            """;
        cmd.Parameters.AddWithValue("$project", review.ProjectId);
        cmd.Parameters.AddWithValue("$branch", review.Branch);
        cmd.Parameters.AddWithValue("$proposal", review.ProposalRef);
        using var row = cmd.ExecuteReader();
        if (!row.Read()) return "not_recorded";
        return row.GetString(0) == review.RevisionSha
            && row.GetString(1) == review.ReviewSnapshotSha256
            && row.GetString(2) == inspection.ComparisonSha256
            && row.GetString(3) == review.CanonicalFactSha256
            && row.GetString(4) == review.SourceEvidenceSha256
            && row.GetString(5) == review.RequestedAction
            ? "recorded_exact_snapshot" : "recorded_different_snapshot";
    }

    internal static ReviewMeaning ConflictMeaning(OperatorEvidenceInspection inspection)
    {
        var r = inspection.Review;
        if (inspection.Status != "requires_independent_review" || inspection.ActiveClaims.Count == 0
            || inspection.CanonicalFact is null || inspection.Kind is not ("knowledge" or "preference" or "procedure")
            || (r.RequestedAction == "confirm" && inspection.ActiveClaims.Any(c => c.ExactDuplicate)))
            throw new InvalidOperationException("conflict_review_not_supported");
        return new ReviewMeaning(r.ProjectId,r.Branch,r.RevisionSha,r.ProposalRef,
            r.ReviewSnapshotSha256,r.CanonicalFactSha256,r.RequestedAction,inspection.CanonicalFact);
    }

    internal ConflictReviewReceipt RecordConflictReviewIntent(ReviewMeaning meaning,
        string comparisonSha, PinnedCredential key, VerificationResult proof)
    {
        EnsureOpen();
        if (!proof.Verified || !proof.UserPresent || !proof.UserVerified
            || proof.Status != "verified_conflict_review_intent_only"
            || proof.ApprovedReviewDecision || proof.ClaimWritten)
            throw new InvalidOperationException("conflict_review_proof_required");
        using var tx = _connection.BeginTransaction(deferred: false);
        var credential = FindOperatorCredential(tx);
        if (credential is null || credential.EnrollmentState != NativeEnrollmentState
            || credential.Credential != key
            || (proof.SignCount > 0 && credential.LastSignCount > 0 && proof.SignCount <= credential.LastSignCount))
            throw new InvalidOperationException("conflict_review_credential_or_counter_denied");
        // Re-resolve the fixed pinned copy while the receipt transaction is
        // open. This is NOT an atomic check of the separate canonical DB.
        var current = InspectOperatorPinnedEvidence(includeLocalContent: true);
        if (ConflictMeaning(current) != meaning || current.ComparisonSha256 != comparisonSha)
            throw new InvalidOperationException("conflict_review_snapshot_changed");
        var r = current.Review;
        using (var insert = _connection.CreateCommand())
        {
            insert.Transaction = tx;
            insert.CommandText = """
                INSERT INTO protected_conflict_review_intents
                VALUES($p,$b,$ref,$rev,$snapshot,$comparison,$fact,$evidence,$decision,$key,$count,$utc);
                """;
            insert.Parameters.AddWithValue("$p",r.ProjectId);
            insert.Parameters.AddWithValue("$b",r.Branch);
            insert.Parameters.AddWithValue("$ref",r.ProposalRef);
            insert.Parameters.AddWithValue("$rev",r.RevisionSha);
            insert.Parameters.AddWithValue("$snapshot",r.ReviewSnapshotSha256);
            insert.Parameters.AddWithValue("$comparison",comparisonSha);
            insert.Parameters.AddWithValue("$fact",r.CanonicalFactSha256);
            insert.Parameters.AddWithValue("$evidence",r.SourceEvidenceSha256);
            insert.Parameters.AddWithValue("$decision",r.RequestedAction);
            insert.Parameters.AddWithValue("$key",Hash(key.CredentialIdBase64Url));
            insert.Parameters.AddWithValue("$count",(long)proof.SignCount);
            insert.Parameters.AddWithValue("$utc",DateTimeOffset.UtcNow.ToString("O"));
            if (insert.ExecuteNonQuery()!=1) throw new InvalidOperationException("conflict_review_insert_failed");
        }
        if (proof.SignCount > credential.LastSignCount)
        {
            using var update = _connection.CreateCommand();
            update.Transaction = tx;
            update.CommandText = "UPDATE protected_operator_credentials SET last_sign_count=$next WHERE singleton=1 AND last_sign_count=$prev;";
            update.Parameters.AddWithValue("$next",(long)proof.SignCount);
            update.Parameters.AddWithValue("$prev",credential.LastSignCount);
            if (update.ExecuteNonQuery()!=1) throw new InvalidOperationException("conflict_review_counter_conflict");
        }
        tx.Commit();
        return new(r.ProjectId,r.Branch,r.ProposalRef,r.ReviewSnapshotSha256,comparisonSha,r.RequestedAction,proof.SignCount);
    }
}

// Host-only coordinator. The comparison lane exposes intent-only operations.
// Callers cannot supply Claim rows, a new key, or an arbitrary decision.
public sealed class ConflictReviewCoordinator
{
    private readonly ProtectedPendingReviewLedger _ledger;
    private readonly PinnedCredential _key;
    private readonly ReviewChallengeCore _core = new();
    private readonly object _gate = new();
    private (ChallengeTicket Ticket, string ComparisonSha)? _active;

    public ConflictReviewCoordinator(ProtectedPendingReviewLedger ledger)
    {
        _ledger=ledger;
        var key=ledger.ReadOperatorCredential();
        if (key is null || key.EnrollmentState != ProtectedPendingReviewLedger.NativeEnrollmentState)
            throw new InvalidOperationException("conflict_review_native_enrollment_required");
        _key=key.Credential;
    }

    public bool CanBegin(OperatorEvidenceInspection inspection)
    {
        lock (_gate)
        {
            if (_active is { } active && active.Ticket.ExpiresUtc > DateTimeOffset.UtcNow)
                return false;
            var credential = _ledger.ReadOperatorCredential();
            return credential?.EnrollmentState == ProtectedPendingReviewLedger.NativeEnrollmentState
                && credential.Credential == _key
                && inspection.Status == "requires_independent_review"
                && inspection.ActiveClaims.Count > 0
                && inspection.Kind is ("knowledge" or "preference" or "procedure")
                && (inspection.Review.RequestedAction == "reject" || !inspection.ActiveClaims.Any(c => c.ExactDuplicate))
                && _ledger.ReadConflictIntentStatus(inspection) == "not_recorded";
        }
    }

    public ChallengeTicket Begin(string expectedSnapshotSha256, string expectedComparisonSha256)
    {
        lock(_gate)
        {
            if (_active is { } pending && pending.Ticket.ExpiresUtc > DateTimeOffset.UtcNow)
                throw new InvalidOperationException("conflict_review_already_pending");
            var current=_ledger.InspectOperatorPinnedEvidence(includeLocalContent:true);
            if (current.Review.ReviewSnapshotSha256!=expectedSnapshotSha256
                || current.ComparisonSha256!=expectedComparisonSha256)
                throw new InvalidOperationException("conflict_review_offer_changed");
            if (!CanBegin(current))
                throw new InvalidOperationException("conflict_review_not_available");
            var meaning=ProtectedPendingReviewLedger.ConflictMeaning(current);
            var ticket=_core.BeginConflictReview(meaning,_key);
            _active=(ticket,current.ComparisonSha256);
            return ticket;
        }
    }

    public ConflictReviewCompletion Complete(string ticketId, BrowserAssertion assertion)
    {
        lock(_gate)
        {
            var active=_active;
            _active=null;
            if (active is null) return new(false,"conflict_review_no_ticket");
            var item=active.Value;
            // Even a wrong ticket consumes the actual outstanding ticket.
            var proof=_core.VerifyConflictReviewAndConsume(item.Ticket.TicketId,item.Ticket.Meaning,
                ticketId==item.Ticket.TicketId && assertion is not null ? assertion : new BrowserAssertion("","","","",""));
            if (!proof.Verified) return new(false,proof.Status);
            try
            {
                var receipt=_ledger.RecordConflictReviewIntent(item.Ticket.Meaning,item.ComparisonSha,_key,proof);
                return new(true,"conflict_review_intent_recorded_no_claim",receipt);
            }
            catch(Exception e) when(e is InvalidOperationException or ArgumentException or SqliteException or IOException or System.Text.Json.JsonException)
            { return new(false,"conflict_review_commit_denied"); }
        }
    }
}
