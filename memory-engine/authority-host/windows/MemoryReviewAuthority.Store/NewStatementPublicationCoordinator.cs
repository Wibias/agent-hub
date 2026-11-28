using System.Text.Json;
using MemoryReviewAuthority.Core;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

public sealed record NewStatementPublicationOffer(
    ChallengeTicket Ticket, NewOperatorStatementReceipt Receipt,
    NewStatementComparison Comparison, string Relation);

public sealed record NewStatementPreviewClaim(
    string ClaimId, string StatementRef, string StatementSha256,
    string ReceiptSha256, string ComparisonSha256, string PublicationSha256,
    string CredentialIdSha256, uint SignCount, string RecordedAtUtc);

public sealed record NewStatementPublicationCompletion(
    bool Verified, string Status, NewStatementPreviewClaim? PreviewClaim = null,
    bool ClaimWritten = false, bool ProductionClaimWritten = false);

public sealed class NewStatementPublicationCoordinator
{
    private readonly ProtectedPendingReviewLedger _ledger;
    private readonly PinnedCredential _credential;
    private readonly ReviewChallengeCore _core = new();

    public NewStatementPublicationCoordinator(ProtectedPendingReviewLedger ledger)
    {
        _ledger = ledger ?? throw new ArgumentNullException(nameof(ledger));
        var pin = ledger.ReadOperatorCredential();
        if (pin is null || pin.EnrollmentState != ProtectedPendingReviewLedger.NativeEnrollmentState)
            throw new InvalidOperationException("new_statement_publication_native_enrollment_required");
        _credential = pin.Credential;
    }

    public NewStatementPublicationOffer Begin(string statementRef, string relation)
    {
        var (meaning, receipt, comparison) = _ledger.PrepareNewStatementPublication(statementRef, relation, _credential);
        return new(_core.BeginNewStatementPublication(meaning, _credential), receipt, comparison, relation);
    }

    public NewStatementPublicationCompletion Complete(NewStatementPublicationOffer offer, BrowserAssertion assertion)
    {
        ArgumentNullException.ThrowIfNull(offer);
        var proof = _core.VerifyNewStatementPublicationAndConsume(offer.Ticket.TicketId, offer.Ticket.Meaning, assertion);
        if (!proof.Verified || proof.Status != "verified_new_statement_preview_publication_only")
            return new(false, proof.Status);
        try
        {
            var claim = _ledger.CommitNewStatementPreviewClaim(offer, _credential, proof);
            return new(true, "new_statement_synthetic_preview_claim_written", claim, ClaimWritten: true);
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or SqliteException)
        {
            return new(false, "new_statement_publication_transaction_denied");
        }
    }
}

public sealed partial class ProtectedPendingReviewLedger
{
    public const string NewStatementPublicationFixtureProject = "github.com/example/operator-evidence";
    private const string NewStatementPreviewClaimPolicy = "agenthub-new-statement-synthetic-preview-claim-v1";

    private static void InitializeNewStatementPublicationSchema(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS protected_new_statement_preview_claims (
                claim_id TEXT PRIMARY KEY NOT NULL,
                statement_ref TEXT NOT NULL UNIQUE REFERENCES protected_new_operator_statements(statement_ref),
                statement_sha256 TEXT NOT NULL CHECK(length(statement_sha256)=64),
                receipt_sha256 TEXT NOT NULL CHECK(length(receipt_sha256)=64),
                comparison_sha256 TEXT NOT NULL CHECK(length(comparison_sha256)=64),
                publication_sha256 TEXT NOT NULL UNIQUE CHECK(length(publication_sha256)=64),
                credential_id_sha256 TEXT NOT NULL CHECK(length(credential_id_sha256)=64),
                sign_count INTEGER NOT NULL CHECK(sign_count BETWEEN 0 AND 4294967295),
                recorded_at_utc TEXT NOT NULL,
                policy_version TEXT NOT NULL CHECK(policy_version='agenthub-new-statement-synthetic-preview-claim-v1')
            ) STRICT;
            CREATE TRIGGER IF NOT EXISTS deny_new_statement_preview_claim_update
              BEFORE UPDATE ON protected_new_statement_preview_claims
              BEGIN SELECT RAISE(ABORT, 'new_statement_preview_claim_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_new_statement_preview_claim_delete
              BEFORE DELETE ON protected_new_statement_preview_claims
              BEGIN SELECT RAISE(ABORT, 'new_statement_preview_claim_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_new_statement_preview_claim_replace
              BEFORE INSERT ON protected_new_statement_preview_claims
              WHEN EXISTS (SELECT 1 FROM protected_new_statement_preview_claims
                 WHERE claim_id=NEW.claim_id OR statement_ref=NEW.statement_ref OR publication_sha256=NEW.publication_sha256)
              BEGIN SELECT RAISE(ABORT, 'new_statement_preview_claim_immutable'); END;
            """;
        cmd.ExecuteNonQuery();
    }

    internal (ReviewMeaning Meaning, NewOperatorStatementReceipt Receipt, NewStatementComparison Comparison)
        PrepareNewStatementPublication(string statementRef, string relation, PinnedCredential pinned)
    {
        EnsureOpen();
        using var tx = _connection.BeginTransaction(deferred: true);
        var result = ResolveNewStatementPublication(statementRef, relation, pinned, tx);
        tx.Commit();
        return result;
    }

    private (ReviewMeaning Meaning, NewOperatorStatementReceipt Receipt, NewStatementComparison Comparison)
        ResolveNewStatementPublication(string statementRef, string relation, PinnedCredential pinned, SqliteTransaction tx)
    {
        if (relation != "unrelated")
            throw new InvalidOperationException("new_statement_publication_relation_not_supported");
        NewOperatorStatementReceipt receipt;
        string fact;
        using (var cmd = _connection.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = """
                SELECT statement_ref,project_id,branch,revision_sha,kind,fact_sha256,statement_sha256,
                    scope_pin_sha256,comparison_sha256,credential_id_sha256,sign_count,recorded_at_utc,value_text
                FROM protected_new_operator_statements s
                WHERE statement_ref=$id AND source_origin='operator_new_statement_uv_v1'
                  AND NOT EXISTS(SELECT 1 FROM protected_new_statement_preview_claims c WHERE c.statement_ref=s.statement_ref);
                """;
            cmd.Parameters.AddWithValue("$id", statementRef);
            using var row = cmd.ExecuteReader();
            if (!row.Read()) throw new InvalidOperationException("new_statement_missing_or_already_published");
            receipt = new(row.GetString(0),row.GetString(1),row.GetString(2),row.GetString(3),
                row.GetString(4),row.GetString(5),row.GetString(6),row.GetString(7),row.GetString(8),
                row.GetString(9),checked((uint)row.GetInt64(10)),row.GetString(11));
            fact = row.GetString(12);
        }
        if (receipt.ProjectId != NewStatementPublicationFixtureProject)
            throw new InvalidOperationException("new_statement_publication_synthetic_scope_only");
        var credential = FindOperatorCredential(tx);
        if (credential is null || credential.EnrollmentState != NativeEnrollmentState || credential.Credential != pinned
            || receipt.CredentialIdSha256 != Hash(pinned.CredentialIdBase64Url)
            || receipt.SignCount > credential.LastSignCount
            || !IsFreshOperatorReaffirmation(receipt.RecordedAtUtc, DateTimeOffset.UtcNow))
            throw new InvalidOperationException("new_statement_publication_receipt_stale_or_untrusted");
        var scope = RequireNewStatementScope(receipt.ProjectId, receipt.Branch, receipt.RevisionSha, tx);
        var original = NewStatementMeaning(receipt.StatementRef, scope, receipt.Kind, fact, receipt.ComparisonSha256);
        if (scope.PinSha256 != receipt.ScopePinSha256 || original.CanonicalFactSha256 != receipt.FactSha256
            || original.ReviewSnapshotSha256 != receipt.StatementSha256)
            throw new InvalidOperationException("new_statement_publication_receipt_integrity_invalid");
        var comparison = ReadNewStatementComparison(scope, tx);
        if (comparison.Sha256 != receipt.ComparisonSha256)
            throw new InvalidOperationException("new_statement_publication_comparison_changed");
        RequireNewStatementNotDuplicate(comparison, fact);
        var receiptHash = Hash(JsonSerializer.Serialize(receipt));
        var snapshot = Hash(JsonSerializer.Serialize(new[] {
            NewStatementPreviewClaimPolicy, receiptHash, scope.PinSha256, comparison.Sha256, relation }));
        return (original with { ReviewSnapshotSha256 = snapshot }, receipt, comparison);
    }

    internal NewStatementPreviewClaim CommitNewStatementPreviewClaim(
        NewStatementPublicationOffer offer, PinnedCredential pinned, VerificationResult proof)
    {
        EnsureOpen();
        if (!proof.Verified || !proof.UserPresent || !proof.UserVerified
            || proof.Status != "verified_new_statement_preview_publication_only"
            || proof.ApprovedReviewDecision || proof.ClaimWritten || proof.ReaffirmationBindingSha256 is not null)
            throw new InvalidOperationException("new_statement_publication_proof_required");
        using var tx = _connection.BeginTransaction(deferred: false);
        var (meaning, receipt, comparison) = ResolveNewStatementPublication(
            offer.Ticket.Meaning.ProposalRef, offer.Relation, pinned, tx);
        var scope = RequireNewStatementScope(receipt.ProjectId, receipt.Branch, receipt.RevisionSha, tx);
        if (meaning != offer.Ticket.Meaning || receipt != offer.Receipt || offer.Comparison is null
            || comparison.Sha256 != offer.Comparison.Sha256
            || ComputeNewStatementComparisonDigest(scope, offer.Comparison.Claims) != comparison.Sha256)
            throw new InvalidOperationException("new_statement_publication_offer_changed");
        var credential = FindOperatorCredential(tx)!;
        if (proof.SignCount > 0 && credential.LastSignCount > 0 && proof.SignCount <= credential.LastSignCount)
            throw new InvalidOperationException("new_statement_publication_counter_replay");
        var now = DateTimeOffset.UtcNow;
        if (!IsFreshOperatorReaffirmation(receipt.RecordedAtUtc, now))
            throw new InvalidOperationException("new_statement_publication_receipt_expired");

        var claim = new NewStatementPreviewClaim("C~" + Hash(receipt.StatementRef)[..24],
            receipt.StatementRef,receipt.StatementSha256,Hash(JsonSerializer.Serialize(receipt)),
            comparison.Sha256,meaning.ReviewSnapshotSha256,receipt.CredentialIdSha256,proof.SignCount,now.ToString("O"));
        using (var cmd = _connection.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = """
                INSERT INTO protected_new_statement_preview_claims
                (claim_id,statement_ref,statement_sha256,receipt_sha256,comparison_sha256,
                publication_sha256,credential_id_sha256,sign_count,recorded_at_utc,policy_version)
                VALUES($id,$statement,$sha,$receipt,$comparison,$publication,$credential,$counter,$when,$policy);
                """;
            cmd.Parameters.AddWithValue("$id",claim.ClaimId);
            cmd.Parameters.AddWithValue("$statement",claim.StatementRef);
            cmd.Parameters.AddWithValue("$sha",claim.StatementSha256);
            cmd.Parameters.AddWithValue("$receipt",claim.ReceiptSha256);
            cmd.Parameters.AddWithValue("$comparison",claim.ComparisonSha256);
            cmd.Parameters.AddWithValue("$publication",claim.PublicationSha256);
            cmd.Parameters.AddWithValue("$credential",claim.CredentialIdSha256);
            cmd.Parameters.AddWithValue("$counter",(long)claim.SignCount);
            cmd.Parameters.AddWithValue("$when",claim.RecordedAtUtc);
            cmd.Parameters.AddWithValue("$policy",NewStatementPreviewClaimPolicy);
            if (cmd.ExecuteNonQuery() != 1) throw new InvalidOperationException("new_statement_publication_insert_failed");
        }
        if (proof.SignCount > credential.LastSignCount)
        {
            using var cmd = _connection.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = """
                UPDATE protected_operator_credentials SET last_sign_count=$counter
                WHERE singleton=1 AND last_sign_count=$previous;
                """;
            cmd.Parameters.AddWithValue("$counter",(long)proof.SignCount);
            cmd.Parameters.AddWithValue("$previous",credential.LastSignCount);
            if (cmd.ExecuteNonQuery() != 1) throw new InvalidOperationException("new_statement_publication_counter_conflict");
        }
        tx.Commit();
        return claim;
    }
}
