using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// Pending ONLY. These fields are not human authorization or canonical Claims.
/// The protected service must independently derive them from trusted sources
/// before a future real review endpoint can accept them.
/// </summary>
public sealed record PendingReview(
    string ProjectId,
    string Branch,
    string RevisionSha,
    string ProposalRef,
    string ReviewSnapshotSha256,
    string CanonicalFactSha256,
    string SourceEvidenceSha256,
    string RequestedAction);

public sealed record PendingReviewRecord(
    string RequestId,
    PendingReview Review,
    string Status,
    string CreatedAtUtc);

/// <summary>
/// Service-owned, separate SQLite WAL ledger. Never opens the user's
/// LOCALAPPDATA Memory database and exposes NO approval, rejection, credential
/// registration, claim insertion or promotion operation.
///
/// File-system permissions are enforced by the hosting Windows service SID
/// and must be checked by the host before opening this class. This library
/// does not authenticate its caller or make a caller-supplied review trusted.
/// </summary>
public sealed class ProtectedPendingReviewLedger : IDisposable
{
    public const string PendingState = "awaiting_independent_host_authorization";
    public const string PolicyVersion = "agenthub-authority-store-pending-v1";

    private readonly SqliteConnection _connection;
    private bool _disposed;

    private ProtectedPendingReviewLedger(SqliteConnection connection)
    {
        _connection = connection;
    }

    public static ProtectedPendingReviewLedger OpenInProtectedDirectory(string directory)
    {
        if (string.IsNullOrWhiteSpace(directory)
            || !Path.IsPathFullyQualified(directory)
            || !Directory.Exists(directory))
            throw new ArgumentException("existing absolute protected directory required");
        // Caller MUST have already validated this directory's effective DACL,
        // exact service SID, reparse-point policy, and process token. No user
        // supplied paths may flow into this method from Codex or an IPC client.
        var path = Path.Combine(directory, "review-authority.sqlite3");
        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
            ForeignKeys = true,
        };
        var connection = new SqliteConnection(builder.ToString());
        try
        {
            connection.Open();
            using (var pragma = connection.CreateCommand())
            {
                pragma.CommandText = "PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA journal_mode=WAL;";
                pragma.ExecuteNonQuery();
            }
            using (var mode = connection.CreateCommand())
            {
                mode.CommandText = "PRAGMA journal_mode;";
                if (!string.Equals(mode.ExecuteScalar()?.ToString(), "wal", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("sqlite_wal_not_enabled");
            }
            using (var schema = connection.CreateCommand())
            {
                schema.CommandText = """
                    CREATE TABLE IF NOT EXISTS review_requests (
                        request_id TEXT PRIMARY KEY NOT NULL,
                        project_id TEXT NOT NULL,
                        branch TEXT NOT NULL,
                        revision_sha TEXT NOT NULL CHECK (length(revision_sha)=40),
                        proposal_ref TEXT NOT NULL,
                        snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256)=64),
                        fact_sha256 TEXT NOT NULL CHECK (length(fact_sha256)=64),
                        evidence_sha256 TEXT NOT NULL CHECK (length(evidence_sha256)=64),
                        requested_action TEXT NOT NULL CHECK (requested_action IN ('confirm','reject')),
                        status TEXT NOT NULL CHECK (status='awaiting_independent_host_authorization'),
                        policy_version TEXT NOT NULL,
                        created_at_utc TEXT NOT NULL,
                        UNIQUE(project_id, branch, proposal_ref)
                    ) STRICT;
                    """;
                schema.ExecuteNonQuery();
            }
            return new ProtectedPendingReviewLedger(connection);
        }
        catch
        {
            connection.Dispose();
            throw;
        }
    }

    /// <summary>
    /// Idempotently stages a non-authorizing request. Once a proposal has a
    /// pending row, a different snapshot/action/evidence is a hard conflict.
    /// No method in this class can turn a request into a valid approval.
    /// </summary>
    public PendingReviewRecord RecordPending(PendingReview review)
    {
        EnsureOpen();
        Validate(review);
        using var tx = _connection.BeginTransaction(deferred: false);
        var existing = Lookup(review.ProjectId, review.Branch, review.ProposalRef, tx);
        if (existing is not null)
        {
            if (existing.Review != review
                || existing.Status != PendingState)
                throw new InvalidOperationException("pending_review_conflict");
            tx.Commit();
            return existing;
        }

        var record = new PendingReviewRecord(
            Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant(),
            review,
            PendingState,
            DateTimeOffset.UtcNow.ToString("O"));
        using var write = _connection.CreateCommand();
        write.Transaction = tx;
        write.CommandText = """
            INSERT INTO review_requests (
                request_id, project_id, branch, revision_sha, proposal_ref,
                snapshot_sha256, fact_sha256, evidence_sha256, requested_action,
                status, policy_version, created_at_utc
            ) VALUES (
                $id, $project, $branch, $revision, $proposal,
                $snapshot, $fact, $evidence, $action,
                $status, $policy, $created
            );
            """;
        write.Parameters.AddWithValue("$id", record.RequestId);
        write.Parameters.AddWithValue("$project", review.ProjectId);
        write.Parameters.AddWithValue("$branch", review.Branch);
        write.Parameters.AddWithValue("$revision", review.RevisionSha);
        write.Parameters.AddWithValue("$proposal", review.ProposalRef);
        write.Parameters.AddWithValue("$snapshot", review.ReviewSnapshotSha256);
        write.Parameters.AddWithValue("$fact", review.CanonicalFactSha256);
        write.Parameters.AddWithValue("$evidence", review.SourceEvidenceSha256);
        write.Parameters.AddWithValue("$action", review.RequestedAction);
        write.Parameters.AddWithValue("$status", PendingState);
        write.Parameters.AddWithValue("$policy", PolicyVersion);
        write.Parameters.AddWithValue("$created", record.CreatedAtUtc);
        if (write.ExecuteNonQuery() != 1)
            throw new InvalidOperationException("pending_review_insert_failed");
        tx.Commit();
        return record;
    }

    /// <summary>
    /// Private, non-authoritative projection: no original fact, credential,
    /// challenge or valid approval token. Do not use this as a Claims source.
    /// </summary>
    public PendingReviewRecord? ReadPending(
        string projectId, string branch, string proposalRef)
    {
        EnsureOpen();
        return Lookup(projectId, branch, proposalRef, null);
    }

    public int CountPending()
    {
        EnsureOpen();
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM review_requests;";
        return Convert.ToInt32(command.ExecuteScalar());
    }

    private PendingReviewRecord? Lookup(
        string projectId, string branch, string proposalRef, SqliteTransaction? tx)
    {
        using var command = _connection.CreateCommand();
        command.Transaction = tx;
        command.CommandText = """
            SELECT request_id, project_id, branch, revision_sha, proposal_ref,
                snapshot_sha256, fact_sha256, evidence_sha256,
                requested_action, status, policy_version, created_at_utc
            FROM review_requests
            WHERE project_id=$project AND branch=$branch AND proposal_ref=$proposal;
            """;
        command.Parameters.AddWithValue("$project", projectId);
        command.Parameters.AddWithValue("$branch", branch);
        command.Parameters.AddWithValue("$proposal", proposalRef);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        if (reader.GetString(10) != PolicyVersion)
            throw new InvalidOperationException("unknown_authority_ledger_policy");
        var review = new PendingReview(
            reader.GetString(1), reader.GetString(2), reader.GetString(3),
            reader.GetString(4), reader.GetString(5), reader.GetString(6),
            reader.GetString(7), reader.GetString(8));
        var result = new PendingReviewRecord(
            reader.GetString(0), review, reader.GetString(9), reader.GetString(11));
        if (reader.Read())
            throw new InvalidOperationException("ambiguous_review_record");
        return result;
    }

    private static void Validate(PendingReview? value)
    {
        if (value is null
            || !AsciiScope(value.ProjectId, 256)
            || !AsciiScope(value.Branch, 128)
            || !Matches(value.RevisionSha, "^[0-9a-f]{40}$")
            || !Matches(value.ProposalRef, "^E~[0-9a-f]{10}$")
            || !Matches(value.ReviewSnapshotSha256, "^[0-9a-f]{64}$")
            || !Matches(value.CanonicalFactSha256, "^[0-9a-f]{64}$")
            || !Matches(value.SourceEvidenceSha256, "^[0-9a-f]{64}$")
            || value.RequestedAction is not ("confirm" or "reject"))
            throw new ArgumentException("invalid_protected_pending_review");
    }

    private static bool AsciiScope(string? value, int max)
        => !string.IsNullOrWhiteSpace(value)
           && value.Length <= max
           && Matches(value, "^[A-Za-z0-9._:/~-]+$");

    private static bool Matches(string? value, string pattern)
        => value is not null && Regex.IsMatch(value, pattern, RegexOptions.CultureInvariant);

    private void EnsureOpen()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(ProtectedPendingReviewLedger));
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _connection.Dispose();
    }
}
