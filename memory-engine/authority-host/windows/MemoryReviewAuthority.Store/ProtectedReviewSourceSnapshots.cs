using MemoryReviewAuthority.Core;
using Microsoft.Data.Sqlite;
using System.Security.Cryptography;
using System.Text;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// Immutable service-owned source corresponding to exactly one protected
/// pending E~ review. A canonical user SQLite row is never accepted as a
/// source of truth merely by presenting matching hashes.
/// </summary>
public sealed record ServiceOwnedReviewSource(
    string RequestId,
    TrustedReviewSource Source,
    string SourceOrigin,
    string CapturedAtUtc);

public sealed partial class ProtectedPendingReviewLedger
{
    public const string ProtectedSourcePolicyVersion = "agenthub-protected-source-v1";
    public const string SyntheticSourceOrigin = "synthetic_disposable_lab";

    private static void InitializeProtectedSourceSchema(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS protected_review_sources (
                request_id TEXT PRIMARY KEY NOT NULL
                    REFERENCES review_requests(request_id) ON DELETE RESTRICT,
                project_id TEXT NOT NULL,
                branch TEXT NOT NULL,
                revision_sha TEXT NOT NULL CHECK (length(revision_sha)=40),
                proposal_ref TEXT NOT NULL,
                snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256)=64),
                fact_sha256 TEXT NOT NULL CHECK (length(fact_sha256)=64),
                evidence_sha256 TEXT NOT NULL CHECK (length(evidence_sha256)=64),
                kind TEXT NOT NULL CHECK (kind IN ('knowledge','preference')),
                relation TEXT NOT NULL CHECK (
                    relation IN ('unrelated','same','update','contradict')
                ),
                related_claim_id TEXT,
                canonical_fact TEXT NOT NULL CHECK (
                    length(canonical_fact)>0 AND length(canonical_fact)<=4000
                ),
                source_origin TEXT NOT NULL CHECK (
                    source_origin='synthetic_disposable_lab'
                ),
                captured_at_utc TEXT NOT NULL,
                policy_version TEXT NOT NULL CHECK (
                    policy_version='agenthub-protected-source-v1'
                ),
                UNIQUE(project_id, branch, proposal_ref),
                CHECK ((relation='unrelated' AND related_claim_id IS NULL)
                    OR (relation<>'unrelated' AND related_claim_id IS NOT NULL))
            ) STRICT;
            CREATE TRIGGER IF NOT EXISTS deny_protected_source_mutation
              BEFORE UPDATE ON protected_review_sources
              BEGIN SELECT RAISE(ABORT, 'protected_source_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_protected_source_delete
              BEFORE DELETE ON protected_review_sources
              BEGIN SELECT RAISE(ABORT, 'protected_source_immutable'); END;
            """;
        cmd.ExecuteNonQuery();
    }

    private static void ValidateSource(PendingReview review, TrustedReviewSource source)
    {
        if (review is null || source is null
            || review.ProjectId != source.ProjectId
            || review.Branch != source.Branch
            || review.RevisionSha != source.RevisionSha
            || review.ProposalRef != source.ProposalRef
            || review.ReviewSnapshotSha256 != source.ReviewSnapshotSha256
            || review.CanonicalFactSha256 != Hash(source.CanonicalFact ?? "")
            || review.SourceEvidenceSha256 != source.SourceEvidenceSha256
            || source.CanonicalFact is not { Length: > 0 and <= 4000 }
            || source.Kind is not ("knowledge" or "preference")
            || source.Relation is not ("unrelated" or "same" or "update" or "contradict")
            || ((source.Relation == "unrelated") != (source.RelatedClaimId is null))
            || source.RelatedClaimId is { Length: > 256 })
            throw new InvalidOperationException("protected_source_not_equal_to_pending");
    }

    /// <summary>
    /// Internal lab-fixture path ONLY. No IPC operation exposes it and no real
    /// E~ source can be enrolled this way. When the host gains an independently
    /// authenticated live source reader, add an explicit origin policy with
    /// real credential enrollment. Never repurpose this method for production.
    /// </summary>
    public void StageSyntheticLabSource(PendingReview review, TrustedReviewSource source)
    {
        EnsureOpen();
        ValidateSource(review, source);
        using var tx = _connection.BeginTransaction(deferred: false);
        var pending = Lookup(review.ProjectId, review.Branch, review.ProposalRef, tx);
        if (pending is null || pending.Review != review
            || pending.Status != PendingState
            || FindVerifiedIntent(pending.RequestId, tx) is not null)
            throw new InvalidOperationException("protected_source_pending_missing_or_finalized");

        var existing = FindServiceOwnedSource(pending.RequestId, tx);
        if (existing is not null)
        {
            if (existing.Source != source
                || existing.SourceOrigin != SyntheticSourceOrigin)
                throw new InvalidOperationException("protected_source_conflict");
            tx.Commit();
            return;
        }

        using var cmd = _connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO protected_review_sources (
                request_id, project_id, branch, revision_sha, proposal_ref,
                snapshot_sha256, fact_sha256, evidence_sha256, kind, relation,
                related_claim_id, canonical_fact, source_origin, captured_at_utc,
                policy_version
            ) VALUES (
                $request, $project, $branch, $revision, $proposal,
                $snapshot, $fact, $evidence, $kind, $relation,
                $target, $text, $origin, $when, $policy
            );
            """;
        cmd.Parameters.AddWithValue("$request", pending.RequestId);
        cmd.Parameters.AddWithValue("$project", source.ProjectId);
        cmd.Parameters.AddWithValue("$branch", source.Branch);
        cmd.Parameters.AddWithValue("$revision", source.RevisionSha);
        cmd.Parameters.AddWithValue("$proposal", source.ProposalRef);
        cmd.Parameters.AddWithValue("$snapshot", source.ReviewSnapshotSha256);
        cmd.Parameters.AddWithValue("$fact", review.CanonicalFactSha256);
        cmd.Parameters.AddWithValue("$evidence", source.SourceEvidenceSha256);
        cmd.Parameters.AddWithValue("$kind", source.Kind);
        cmd.Parameters.AddWithValue("$relation", source.Relation);
        cmd.Parameters.AddWithValue("$target", (object?)source.RelatedClaimId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$text", source.CanonicalFact);
        cmd.Parameters.AddWithValue("$origin", SyntheticSourceOrigin);
        cmd.Parameters.AddWithValue("$when", DateTimeOffset.UtcNow.ToString("O"));
        cmd.Parameters.AddWithValue("$policy", ProtectedSourcePolicyVersion);
        if (cmd.ExecuteNonQuery() != 1)
            throw new InvalidOperationException("protected_source_insert_failed");
        tx.Commit();
    }

    private ServiceOwnedReviewSource? FindServiceOwnedSource(
        string requestId, SqliteTransaction? tx)
    {
        using var cmd = _connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            SELECT project_id, branch, revision_sha, proposal_ref,
                snapshot_sha256, fact_sha256, evidence_sha256, kind, relation,
                related_claim_id, canonical_fact, source_origin, captured_at_utc,
                policy_version
            FROM protected_review_sources WHERE request_id=$request;
            """;
        cmd.Parameters.AddWithValue("$request", requestId);
        using var reader = cmd.ExecuteReader();
        if (!reader.Read()) return null;
        if (reader.GetString(13) != ProtectedSourcePolicyVersion
            || reader.GetString(11) != SyntheticSourceOrigin)
            throw new InvalidOperationException("unrecognized_protected_source_policy");
        var source = new TrustedReviewSource(
            reader.GetString(0), reader.GetString(1), reader.GetString(2),
            reader.GetString(3), reader.GetString(4), reader.GetString(10),
            reader.GetString(6), reader.GetString(7), reader.GetString(8),
            reader.IsDBNull(9) ? null : reader.GetString(9));
        var expectedFactHash = reader.GetString(5);
        if (Hash(source.CanonicalFact) != expectedFactHash)
            throw new InvalidOperationException("protected_source_fact_integrity");
        var record = new ServiceOwnedReviewSource(
            requestId, source, reader.GetString(11), reader.GetString(12));
        if (reader.Read())
            throw new InvalidOperationException("duplicate_protected_source");
        return record;
    }

    /// <summary>
    /// Only the protected coordinator can use this. It resolves the source
    /// under the service-owned DB by original request ID, not an input callback.
    /// </summary>
    internal TrustedReviewSource? ReadCurrentServiceOwnedSource(
        ReviewMeaning meaning)
    {
        EnsureOpen();
        var pending = Lookup(meaning.ProjectId, meaning.Branch, meaning.ProposalRef, null);
        if (pending is null || pending.Status != PendingState
            || FindVerifiedIntent(pending.RequestId, null) is not null)
            return null;
        var stored = FindServiceOwnedSource(pending.RequestId, null);
        if (stored is null) return null;
        ValidateSource(pending.Review, stored.Source);
        if (stored.Source.CanonicalFact != meaning.CanonicalFact
            || stored.Source.RevisionSha != meaning.RevisionSha
            || stored.Source.ReviewSnapshotSha256 != meaning.ReviewSnapshotSha256
            || pending.Review.RequestedAction != meaning.Decision)
            throw new InvalidOperationException("protected_source_no_longer_matches_review");
        return stored.Source;
    }
}
