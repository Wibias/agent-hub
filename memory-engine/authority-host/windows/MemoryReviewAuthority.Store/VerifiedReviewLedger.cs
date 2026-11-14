using MemoryReviewAuthority.Core;
using Microsoft.Data.Sqlite;
using System.Security.Cryptography;
using System.Text;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// A protected, immutable UV-backed intent record, NOT a canonical Claim.
/// Never trust this without a verified protected host/source/credential flow.
/// </summary>
public sealed record VerifiedReviewIntentRecord(
    string RequestId,
    string Disposition,
    string CredentialIdSha256,
    uint SignCount,
    string VerifiedAtUtc,
    bool ApprovedClaim = false,
    bool ClaimWritten = false);

public sealed partial class ProtectedPendingReviewLedger
{
    public const string VerifiedIntentPolicyVersion = "agenthub-uv-review-intent-v1";
    public const string ConfirmDisposition = "uv_confirm_intent_no_claim";
    public const string RejectDisposition = "uv_reject_intent_no_claim";

    private static void InitializeVerifiedReviewSchema(SqliteConnection connection)
    {
        using var schema = connection.CreateCommand();
        schema.CommandText = """
            CREATE TABLE IF NOT EXISTS verified_review_intents (
                request_id TEXT PRIMARY KEY NOT NULL
                    REFERENCES review_requests(request_id) ON DELETE RESTRICT,
                disposition TEXT NOT NULL
                    CHECK (disposition IN ('uv_confirm_intent_no_claim',
                                          'uv_reject_intent_no_claim')),
                credential_id_sha256 TEXT NOT NULL
                    CHECK (length(credential_id_sha256) = 64),
                sign_count INTEGER NOT NULL CHECK (sign_count >= 0),
                verified_at_utc TEXT NOT NULL,
                policy_version TEXT NOT NULL
                    CHECK (policy_version = 'agenthub-uv-review-intent-v1')
            ) STRICT;
            """;
        schema.ExecuteNonQuery();
    }

    /// <summary>Minimal read projection. Do not interpret a row as a Claim.</summary>
    public VerifiedReviewIntentRecord? ReadVerifiedIntent(
        string projectId, string branch, string proposalRef)
    {
        EnsureOpen();
        var pending = Lookup(projectId, branch, proposalRef, null);
        return pending is null ? null : FindVerifiedIntent(pending.RequestId, null);
    }

    private VerifiedReviewIntentRecord? FindVerifiedIntent(
        string requestId, SqliteTransaction? transaction)
    {
        using var command = _connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT disposition, credential_id_sha256, sign_count,
                   verified_at_utc, policy_version
            FROM verified_review_intents WHERE request_id=$request;
            """;
        command.Parameters.AddWithValue("$request", requestId);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        if (reader.GetString(4) != VerifiedIntentPolicyVersion)
            throw new InvalidOperationException("unknown_verified_intent_policy");
        var result = new VerifiedReviewIntentRecord(
            requestId, reader.GetString(0), reader.GetString(1),
            checked((uint)reader.GetInt64(2)), reader.GetString(3));
        if (reader.Read())
            throw new InvalidOperationException("ambiguous_verified_intent");
        return result;
    }

    /// <summary>
    /// Only the in-process VerifiedReviewCoordinator may invoke this.
    /// It consumes a verified one-time challenge and inserts one immutable
    /// intent in the same SQLite transaction as the scope/replay check.
    /// The service itself must authenticate its source and review UI before
    /// it can treat this as real human consent. No Claim is written here.
    /// </summary>
    internal VerifiedReviewIntentRecord RecordVerifiedIntent(
        ReviewMeaning meaning, PinnedCredential pinned, VerificationResult proof)
    {
        EnsureOpen();
        if (meaning is null || pinned is null || proof is null
            || !proof.Verified || !proof.UserPresent || !proof.UserVerified
            || proof.ApprovedReviewDecision || proof.ClaimWritten)
            throw new InvalidOperationException("not_a_verified_uv_proof");

        if (string.IsNullOrWhiteSpace(meaning.CanonicalFact)
            || !string.Equals(
                Convert.ToHexString(SHA256.HashData(
                    Encoding.UTF8.GetBytes(meaning.CanonicalFact))).ToLowerInvariant(),
                meaning.CanonicalFactSha256, StringComparison.Ordinal))
            throw new InvalidOperationException("fact_digest_mismatch");

        using var tx = _connection.BeginTransaction(deferred: false);
        var pending = Lookup(meaning.ProjectId, meaning.Branch, meaning.ProposalRef, tx);
        if (pending is null
            || pending.Review.RevisionSha != meaning.RevisionSha
            || pending.Review.ReviewSnapshotSha256 != meaning.ReviewSnapshotSha256
            || pending.Review.CanonicalFactSha256 != meaning.CanonicalFactSha256
            || pending.Review.RequestedAction != meaning.Decision)
            throw new InvalidOperationException("pending_review_changed");
        if (FindVerifiedIntent(pending.RequestId, tx) is not null)
            throw new InvalidOperationException("verified_intent_replay");

        var disposition = meaning.Decision switch
        {
            "confirm" => ConfirmDisposition,
            "reject" => RejectDisposition,
            _ => throw new InvalidOperationException("invalid_review_action"),
        };
        var credentialHash = Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes(pinned.CredentialIdBase64Url))).ToLowerInvariant();
        var record = new VerifiedReviewIntentRecord(
            pending.RequestId, disposition, credentialHash,
            proof.SignCount, DateTimeOffset.UtcNow.ToString("O"));
        using var insert = _connection.CreateCommand();
        insert.Transaction = tx;
        insert.CommandText = """
            INSERT INTO verified_review_intents
            (request_id, disposition, credential_id_sha256, sign_count,
             verified_at_utc, policy_version)
            VALUES ($request, $disposition, $credential, $counter, $when, $policy);
            """;
        insert.Parameters.AddWithValue("$request", record.RequestId);
        insert.Parameters.AddWithValue("$disposition", record.Disposition);
        insert.Parameters.AddWithValue("$credential", record.CredentialIdSha256);
        insert.Parameters.AddWithValue("$counter", checked((long)record.SignCount));
        insert.Parameters.AddWithValue("$when", record.VerifiedAtUtc);
        insert.Parameters.AddWithValue("$policy", VerifiedIntentPolicyVersion);
        if (insert.ExecuteNonQuery() != 1)
            throw new InvalidOperationException("verified_intent_write_failed");
        tx.Commit();
        return record;
    }
}
