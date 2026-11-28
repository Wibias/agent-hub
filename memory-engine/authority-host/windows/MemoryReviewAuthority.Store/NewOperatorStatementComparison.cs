using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

public sealed record NewStatementComparisonClaim(
    string Origin, string ClaimId, string RequestId, string RevisionSha,
    string ProposalRef, string SnapshotSha256, string FactSha256, string EvidenceSha256,
    string Kind, string Value, string CreatedAtUtc);

public sealed record NewStatementComparison(
    string Sha256, IReadOnlyList<NewStatementComparisonClaim> Claims);

public sealed partial class ProtectedPendingReviewLedger
{
    private const int NewStatementMaxComparisonClaims = 200;
    private const int NewStatementMaxComparisonBytes = 1024 * 1024;

    internal NewStatementComparison ReadNewStatementComparison(NewStatementPreviewScope scope, SqliteTransaction? tx = null)
    {
        EnsureOpen();
        using var cmd = _connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            SELECT 'review',claim_id,request_id,revision_sha,proposal_ref,snapshot_sha256,
                   fact_sha256,evidence_sha256,kind,value_text,created_at_utc
            FROM protected_review_claims WHERE project_id=$project AND branch=$branch
            UNION ALL
            SELECT 'operator_direct',claim_id,request_id,revision_sha,proposal_ref,snapshot_sha256,
                   fact_sha256,historical_evidence_sha256,kind,value_text,created_at_utc
            FROM protected_operator_direct_claims WHERE project_id=$project AND branch=$branch
            UNION ALL
            SELECT 'new_statement_preview',c.claim_id,s.statement_ref,s.revision_sha,s.statement_ref,
                   c.publication_sha256,s.fact_sha256,s.statement_sha256,s.kind,s.value_text,c.recorded_at_utc
            FROM protected_new_statement_preview_claims c
            JOIN protected_new_operator_statements s ON s.statement_ref=c.statement_ref
            WHERE s.project_id=$project AND s.branch=$branch
            ORDER BY 1,2 LIMIT $limit;
            """;
        cmd.Parameters.AddWithValue("$project", scope.ProjectId);
        cmd.Parameters.AddWithValue("$branch", scope.Branch);
        cmd.Parameters.AddWithValue("$limit", NewStatementMaxComparisonClaims + 1);
        var claims = new List<NewStatementComparisonClaim>();
        int bytes = 0;
        using var rows = cmd.ExecuteReader();
        while (rows.Read())
        {
            if (claims.Count == NewStatementMaxComparisonClaims)
                throw new InvalidOperationException("new_statement_comparison_too_large");
            var claim = new NewStatementComparisonClaim(rows.GetString(0), rows.GetString(1),
                rows.GetString(2), rows.GetString(3), rows.GetString(4), rows.GetString(5),
                rows.GetString(6), rows.GetString(7), rows.GetString(8), rows.GetString(9), rows.GetString(10));
            if (claim.Value is not { Length: > 0 and <= 4000 } || Hash(claim.Value) != claim.FactSha256
                || claim.Kind is not ("knowledge" or "preference"))
                throw new InvalidOperationException("new_statement_comparison_integrity_invalid");
            bytes = checked(bytes + Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(claim)));
            if (bytes > NewStatementMaxComparisonBytes)
                throw new InvalidOperationException("new_statement_comparison_too_large");
            claims.Add(claim);
        }
        return new(ComputeNewStatementComparisonDigest(scope, claims), claims.AsReadOnly());
    }

    internal static string ComputeNewStatementComparisonDigest(
        NewStatementPreviewScope scope, IReadOnlyList<NewStatementComparisonClaim> claims)
        => Hash(JsonSerializer.Serialize(new { protocol = "agenthub-new-statement-comparison-v1",
            scope.PinSha256, claims }));

    internal static void RequireNewStatementNotDuplicate(NewStatementComparison comparison, string fact)
    {
        var normalized = NormalizeComparisonFact(fact);
        if (comparison.Claims.Any(c => NormalizeComparisonFact(c.Value) == normalized))
            throw new InvalidOperationException("new_statement_protected_duplicate");
    }
}
