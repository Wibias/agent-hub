using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using MemoryReviewAuthority.Core;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

public sealed record NewOperatorStatementOffer(ChallengeTicket Ticket, string Kind, NewStatementComparison Comparison);

public sealed record NewOperatorStatementReceipt(
    string StatementRef, string ProjectId, string Branch, string RevisionSha,
    string Kind, string FactSha256, string StatementSha256, string ScopePinSha256, string ComparisonSha256,
    string CredentialIdSha256, uint SignCount, string RecordedAtUtc);

public sealed record NewOperatorStatementCompletion(
    bool Verified, string Status, NewOperatorStatementReceipt? Receipt = null,
    bool HistoricalEvidenceVerified = false, bool CanonicalScopeVerified = false,
    bool ClaimWritten = false);

/// <summary>
/// Host-only statement intake. A verified new statement is neither historical
/// Codex evidence nor a published Claim. No UI or IPC endpoint uses this yet.
/// </summary>
public sealed class NewOperatorStatementCoordinator
{
    private readonly ProtectedPendingReviewLedger _ledger;
    private readonly PinnedCredential _credential;
    private readonly ReviewChallengeCore _core = new();

    public NewOperatorStatementCoordinator(ProtectedPendingReviewLedger ledger)
    {
        _ledger = ledger ?? throw new ArgumentNullException(nameof(ledger));
        var credential = ledger.ReadOperatorCredential();
        if (credential is null || credential.EnrollmentState != ProtectedPendingReviewLedger.NativeEnrollmentState)
            throw new InvalidOperationException("new_statement_native_enrollment_required");
        _credential = credential.Credential;
    }

    public NewOperatorStatementOffer Begin(string project, string branch, string revision, string kind, string fact)
    {
        var id = "N~" + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(24));
        var scope = _ledger.RequireNewStatementScope(project, branch, revision);
        var comparison = _ledger.ReadNewStatementComparison(scope);
        var meaning = ProtectedPendingReviewLedger.NewStatementMeaning(id, scope, kind, fact, comparison.Sha256);
        ProtectedPendingReviewLedger.RequireNewStatementNotDuplicate(comparison, fact);
        return new(_core.BeginNewOperatorStatement(meaning, _credential), kind, comparison);
    }

    public NewOperatorStatementCompletion Complete(NewOperatorStatementOffer offer, BrowserAssertion assertion)
    {
        ArgumentNullException.ThrowIfNull(offer);
        var meaning = offer.Ticket.Meaning;
        var proof = _core.VerifyNewOperatorStatementAndConsume(offer.Ticket.TicketId, meaning, assertion);
        if (!proof.Verified || proof.Status != "verified_new_operator_statement_intent_only")
            return new(false, proof.Status);
        try
        {
            var receipt = _ledger.RecordNewOperatorStatement(meaning, offer.Kind, offer.Comparison, _credential, proof);
            return new(true, "new_operator_statement_recorded_no_claim", receipt);
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or SqliteException)
        {
            return new(false, "new_statement_transaction_denied");
        }
    }
}

public sealed partial class ProtectedPendingReviewLedger
{
    private const string NewStatementOrigin = "operator_new_statement_uv_v1";
    private static readonly UTF8Encoding StrictStatementEncoding = new(false, true);

    private static readonly Regex StatementSecretPattern = new(
        """(?:\bsk-[A-Za-z0-9_-]{12,}\b|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b|\bBearer\s+[^\s]+|\b(?:api[_-]?key|access[_-]?token|secret|password|passwort|token)\s*["']?\s*[:=]\s*["']?[^\s"',;]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\[REDACTED_SECRET\])""",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));

    internal static ReviewMeaning NewStatementMeaning(string id, NewStatementPreviewScope scope, string kind, string fact, string comparisonSha256)
    {
        if (id is null || !Regex.IsMatch(id, @"\AN~[0-9a-f]{48}\z")
            || scope != MakeNewStatementScope(scope.ProjectId, scope.Branch, scope.RevisionSha)
            || comparisonSha256 is null || !Regex.IsMatch(comparisonSha256, @"\A[0-9a-f]{64}\z")
            || kind is not ("knowledge" or "preference")
            || fact is not { Length: > 0 and <= 4000 } || string.IsNullOrWhiteSpace(fact)
            || fact != fact.Trim() || fact.Any(char.IsControl)
            || fact.Any(c => char.GetUnicodeCategory(c) == System.Globalization.UnicodeCategory.Format))
            throw new ArgumentException("new_statement_invalid");
        var factSha = Convert.ToHexStringLower(SHA256.HashData(StrictStatementEncoding.GetBytes(fact)));
        try
        {
            if (StatementSecretPattern.IsMatch(fact.Normalize(NormalizationForm.FormKC)))
                throw new ArgumentException("new_statement_sensitive_content_refused");
        }
        catch (RegexMatchTimeoutException)
        {
            throw new ArgumentException("new_statement_sensitivity_check_failed");
        }
        var snapshot = Hash(JsonSerializer.Serialize(new[] { NewStatementOrigin, id, scope.PinSha256, kind, factSha, comparisonSha256 }));
        return new(scope.ProjectId, scope.Branch, scope.RevisionSha, id, snapshot, factSha, "confirm", fact);
    }

    private static void InitializeNewOperatorStatementSchema(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS protected_new_operator_statements (
                statement_ref TEXT PRIMARY KEY NOT NULL CHECK(length(statement_ref)=50),
                project_id TEXT NOT NULL,
                branch TEXT NOT NULL,
                revision_sha TEXT NOT NULL CHECK(length(revision_sha)=40),
                kind TEXT NOT NULL CHECK(kind IN ('knowledge','preference')),
                value_text TEXT NOT NULL CHECK(length(value_text)>0 AND length(value_text)<=4000),
                fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64),
                statement_sha256 TEXT NOT NULL UNIQUE CHECK(length(statement_sha256)=64),
                scope_pin_sha256 TEXT NOT NULL REFERENCES protected_new_statement_preview_scope(pin_sha256),
                comparison_sha256 TEXT NOT NULL CHECK(length(comparison_sha256)=64),
                credential_id_sha256 TEXT NOT NULL CHECK(length(credential_id_sha256)=64),
                sign_count INTEGER NOT NULL CHECK(sign_count BETWEEN 0 AND 4294967295),
                recorded_at_utc TEXT NOT NULL,
                source_origin TEXT NOT NULL CHECK(source_origin='operator_new_statement_uv_v1')
            ) STRICT;
            CREATE TRIGGER IF NOT EXISTS deny_new_statement_update
              BEFORE UPDATE ON protected_new_operator_statements
              BEGIN SELECT RAISE(ABORT, 'new_statement_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_new_statement_delete
              BEFORE DELETE ON protected_new_operator_statements
              BEGIN SELECT RAISE(ABORT, 'new_statement_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_new_statement_replace
              BEFORE INSERT ON protected_new_operator_statements
              WHEN EXISTS (SELECT 1 FROM protected_new_operator_statements
                WHERE statement_ref=NEW.statement_ref OR statement_sha256=NEW.statement_sha256)
              BEGIN SELECT RAISE(ABORT, 'new_statement_immutable'); END;
            """;
        cmd.ExecuteNonQuery();
    }

    internal NewOperatorStatementReceipt RecordNewOperatorStatement(
        ReviewMeaning meaning, string kind, NewStatementComparison offeredComparison, PinnedCredential pinned, VerificationResult proof)
    {
        EnsureOpen();
        if (!proof.Verified || !proof.UserPresent || !proof.UserVerified
            || proof.Status != "verified_new_operator_statement_intent_only"
            || proof.ClaimWritten || proof.ApprovedReviewDecision || proof.ReaffirmationBindingSha256 is not null)
            throw new InvalidOperationException("new_statement_proof_required");

        using var tx = _connection.BeginTransaction(deferred: false);
        var scope = RequireNewStatementScope(meaning.ProjectId, meaning.Branch, meaning.RevisionSha, tx);
        var comparison = ReadNewStatementComparison(scope, tx);
        if (offeredComparison is null || offeredComparison.Sha256 != comparison.Sha256
            || ComputeNewStatementComparisonDigest(scope, offeredComparison.Claims) != comparison.Sha256
            || meaning != NewStatementMeaning(meaning.ProposalRef, scope, kind, meaning.CanonicalFact, comparison.Sha256))
            throw new InvalidOperationException("new_statement_context_changed");
        RequireNewStatementNotDuplicate(comparison, meaning.CanonicalFact);
        var credential = FindOperatorCredential(tx);
        if (credential is null || credential.EnrollmentState != NativeEnrollmentState || credential.Credential != pinned
            || (proof.SignCount > 0 && credential.LastSignCount > 0 && proof.SignCount <= credential.LastSignCount))
            throw new InvalidOperationException("new_statement_credential_or_counter_denied");

        var receipt = new NewOperatorStatementReceipt(meaning.ProposalRef, meaning.ProjectId, meaning.Branch,
            meaning.RevisionSha, kind, meaning.CanonicalFactSha256, meaning.ReviewSnapshotSha256, scope.PinSha256, comparison.Sha256,
            Hash(pinned.CredentialIdBase64Url), proof.SignCount, DateTimeOffset.UtcNow.ToString("O"));
        using (var insert = _connection.CreateCommand())
        {
            insert.Transaction = tx;
            insert.CommandText = """
                INSERT INTO protected_new_operator_statements
                (statement_ref,project_id,branch,revision_sha,kind,value_text,fact_sha256,
                 statement_sha256,scope_pin_sha256,comparison_sha256,credential_id_sha256,sign_count,recorded_at_utc,source_origin)
                VALUES ($id,$project,$branch,$revision,$kind,$value,$fact,$statement,$scope,$comparison,$credential,$counter,$when,$origin);
                """;
            insert.Parameters.AddWithValue("$id", receipt.StatementRef);
            insert.Parameters.AddWithValue("$project", receipt.ProjectId);
            insert.Parameters.AddWithValue("$branch", receipt.Branch);
            insert.Parameters.AddWithValue("$revision", receipt.RevisionSha);
            insert.Parameters.AddWithValue("$kind", kind);
            insert.Parameters.AddWithValue("$value", meaning.CanonicalFact);
            insert.Parameters.AddWithValue("$fact", receipt.FactSha256);
            insert.Parameters.AddWithValue("$statement", receipt.StatementSha256);
            insert.Parameters.AddWithValue("$scope", receipt.ScopePinSha256);
            insert.Parameters.AddWithValue("$comparison", receipt.ComparisonSha256);
            insert.Parameters.AddWithValue("$credential", receipt.CredentialIdSha256);
            insert.Parameters.AddWithValue("$counter", (long)receipt.SignCount);
            insert.Parameters.AddWithValue("$when", receipt.RecordedAtUtc);
            insert.Parameters.AddWithValue("$origin", NewStatementOrigin);
            if (insert.ExecuteNonQuery() != 1)
                throw new InvalidOperationException("new_statement_insert_failed");
        }
        if (proof.SignCount > credential.LastSignCount)
        {
            using var update = _connection.CreateCommand();
            update.Transaction = tx;
            update.CommandText = """
                UPDATE protected_operator_credentials SET last_sign_count=$counter
                WHERE singleton=1 AND last_sign_count=$previous;
                """;
            update.Parameters.AddWithValue("$counter", (long)proof.SignCount);
            update.Parameters.AddWithValue("$previous", credential.LastSignCount);
            if (update.ExecuteNonQuery() != 1)
                throw new InvalidOperationException("new_statement_counter_conflict");
        }
        tx.Commit();
        return receipt;
    }
}
