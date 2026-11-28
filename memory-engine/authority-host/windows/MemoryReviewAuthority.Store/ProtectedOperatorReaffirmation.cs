using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MemoryReviewAuthority.Core;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// A durable, strictly non-authorizing review-intent receipt. The operator
/// reaffirmed the EXACT displayed statement, but this does not authenticate
/// the user-writable historical source from which the candidate originated.
/// It is NOT a Claim, not a canonical-memory row, and not a production read.
/// </summary>
public sealed record ProtectedOperatorReaffirmationIntent(
    string RequestId,
    string ProjectId,
    string Branch,
    string RevisionSha,
    string ProposalRef,
    string ReviewSnapshotSha256,
    string CanonicalFactSha256,
    string HistoricalEvidenceSha256,
    string OriginalSourceOrigin,
    string Kind,
    string CredentialIdSha256,
    uint SignCount,
    string RecordedAtUtc,
    bool HistoricalEvidenceVerified = false,
    bool ClaimWritten = false,
    long Generation = 0,
    string? PreviousBindingSha256 = null)
{
    public string BindingSha256 => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(
        JsonSerializer.Serialize(new[] { "agenthub-reaffirmation-receipt-binding-v2", RequestId, ProjectId, Branch,
            RevisionSha, ProposalRef, ReviewSnapshotSha256, CanonicalFactSha256, HistoricalEvidenceSha256,
            OriginalSourceOrigin, Kind, CredentialIdSha256, SignCount.ToString(CultureInfo.InvariantCulture), RecordedAtUtc,
            Generation.ToString(CultureInfo.InvariantCulture), PreviousBindingSha256 ?? "" }))));
}

public sealed partial class ProtectedPendingReviewLedger
{
    public const string OperatorReaffirmationPolicy =
        "agenthub-operator-reaffirmation-intent-v1";

    private static void InitializeOperatorReaffirmationSchema(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS protected_operator_reaffirmation_intents (
                request_id TEXT PRIMARY KEY NOT NULL
                    REFERENCES review_requests(request_id) ON DELETE RESTRICT,
                project_id TEXT NOT NULL,
                branch TEXT NOT NULL,
                revision_sha TEXT NOT NULL CHECK(length(revision_sha)=40),
                proposal_ref TEXT NOT NULL,
                snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64),
                fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64),
                evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
                source_origin TEXT NOT NULL CHECK(
                    source_origin='operator_pinned_unverified_evidence_v1'),
                kind TEXT NOT NULL CHECK(kind IN ('knowledge','preference')),
                credential_id_sha256 TEXT NOT NULL
                    CHECK(length(credential_id_sha256)=64),
                sign_count INTEGER NOT NULL CHECK(
                    sign_count BETWEEN 0 AND 4294967295),
                recorded_at_utc TEXT NOT NULL,
                policy_version TEXT NOT NULL CHECK(
                    policy_version='agenthub-operator-reaffirmation-intent-v1'),
                UNIQUE(project_id, branch, proposal_ref)
            ) STRICT;
            CREATE TRIGGER IF NOT EXISTS deny_operator_reaffirmation_update
              BEFORE UPDATE ON protected_operator_reaffirmation_intents
              BEGIN SELECT RAISE(ABORT, 'operator_reaffirmation_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_operator_reaffirmation_delete
              BEFORE DELETE ON protected_operator_reaffirmation_intents
              BEGIN SELECT RAISE(ABORT, 'operator_reaffirmation_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_operator_reaffirmation_replace
              BEFORE INSERT ON protected_operator_reaffirmation_intents
              WHEN EXISTS (SELECT 1 FROM protected_operator_reaffirmation_intents
                WHERE request_id=NEW.request_id OR
                (project_id=NEW.project_id AND branch=NEW.branch AND proposal_ref=NEW.proposal_ref))
              BEGIN SELECT RAISE(ABORT, 'operator_reaffirmation_immutable'); END;
            CREATE TABLE IF NOT EXISTS protected_operator_reaffirmation_generations (
                request_id TEXT NOT NULL REFERENCES protected_operator_reaffirmation_intents(request_id) ON DELETE RESTRICT,
                generation INTEGER NOT NULL CHECK(generation>0),
                binding_sha256 TEXT NOT NULL UNIQUE CHECK(length(binding_sha256)=64),
                previous_binding_sha256 TEXT CHECK(previous_binding_sha256 IS NULL OR length(previous_binding_sha256)=64),
                sign_count INTEGER NOT NULL CHECK(sign_count BETWEEN 0 AND 4294967295),
                recorded_at_utc TEXT NOT NULL,
                PRIMARY KEY(request_id,generation),
                UNIQUE(request_id,generation,binding_sha256)
            ) STRICT;
            CREATE TRIGGER IF NOT EXISTS deny_reaffirmation_generation_update
              BEFORE UPDATE ON protected_operator_reaffirmation_generations
              BEGIN SELECT RAISE(ABORT, 'reaffirmation_generation_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_reaffirmation_generation_delete
              BEFORE DELETE ON protected_operator_reaffirmation_generations
              BEGIN SELECT RAISE(ABORT, 'reaffirmation_generation_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_reaffirmation_generation_replace
              BEFORE INSERT ON protected_operator_reaffirmation_generations
              WHEN EXISTS (SELECT 1 FROM protected_operator_reaffirmation_generations
                WHERE binding_sha256=NEW.binding_sha256 OR
                (request_id=NEW.request_id AND generation=NEW.generation))
              BEGIN SELECT RAISE(ABORT, 'reaffirmation_generation_immutable'); END;
            """;
        cmd.ExecuteNonQuery();
    }

    /// <summary>
    /// Host-internal commit of an explicit future operator review INTENT.
    /// Must be called only after a single-use reaffirmation-purpose UV assertion,
    /// with the protected service reading the native-enrolled key itself.
    /// Never converts the original evidence into authenticated provenance.
    /// The native host does not expose this operation over IPC yet.
    /// </summary>
    internal ProtectedOperatorReaffirmationIntent RecordOperatorReaffirmationIntent(
        ReviewMeaning meaning, PinnedCredential enrolledKey, VerificationResult proof)
    {
        EnsureOpen();
        var renewal = proof?.Status == "verified_operator_reaffirmation_renewal_intent_only";
        if (meaning is null || enrolledKey is null || proof is null
            || meaning.Decision != "confirm"
            || !proof.Verified || !proof.UserPresent || !proof.UserVerified
            || (!renewal && proof.Status != "verified_operator_reaffirmation_intent_only")
            || (renewal != (proof.ReaffirmationBindingSha256 is not null))
            || proof.ApprovedReviewDecision || proof.ClaimWritten
            || meaning.CanonicalFact is not { Length: > 0 and <= 4000 }
            || Hash(meaning.CanonicalFact) != meaning.CanonicalFactSha256)
            throw new InvalidOperationException("operator_reaffirmation_approval_proof_required");

        using var tx = _connection.BeginTransaction(deferred: false);
        var credential = FindOperatorCredential(tx);
        if (credential is null
            || credential.EnrollmentState != NativeEnrollmentState
            || credential.Credential != enrolledKey)
            throw new InvalidOperationException("operator_reaffirmation_native_key_required");

        var pending = Lookup(meaning.ProjectId, meaning.Branch, meaning.ProposalRef, tx);
        if (pending is null || pending.Status != PendingState
            || pending.Review.RevisionSha != meaning.RevisionSha
            || pending.Review.ReviewSnapshotSha256 != meaning.ReviewSnapshotSha256
            || pending.Review.CanonicalFactSha256 != meaning.CanonicalFactSha256
            || pending.Review.RequestedAction != meaning.Decision
            || FindVerifiedIntent(pending.RequestId, tx) is not null)
            throw new InvalidOperationException("operator_reaffirmation_context_changed");

        var source = FindServiceOwnedSource(pending.RequestId, tx);
        if (source is null || source.SourceOrigin != OperatorSourceOrigin)
            throw new InvalidOperationException("operator_reaffirmation_unverified_source_required");
        ValidateSource(pending.Review, source.Source);
        if (source.Source.CanonicalFact != meaning.CanonicalFact
            || source.Source.Kind is not ("knowledge" or "preference")
            || source.Source.Relation != "unrelated"
            || source.Source.RelatedClaimId is not null)
            throw new InvalidOperationException("operator_reaffirmation_unsafe_fact_or_relation");

        // Zero is valid for Windows authenticators but does NOT demonstrate clone resistance.
        if (proof.SignCount > 0 && credential.LastSignCount > 0
            && proof.SignCount <= credential.LastSignCount)
            throw new InvalidOperationException("operator_reaffirmation_counter_replay");

        var previous = ReadOperatorReaffirmationIntent(meaning.ProjectId, meaning.Branch, meaning.ProposalRef, tx);
        var now = DateTimeOffset.UtcNow;
        if (renewal)
        {
            if (previous is null || previous.BindingSha256 != proof.ReaffirmationBindingSha256
                || previous.RequestId != pending.RequestId
                || previous.CredentialIdSha256 != Hash(enrolledKey.CredentialIdBase64Url)
                || !IsExpiredOperatorReaffirmation(previous.RecordedAtUtc, now))
                throw new InvalidOperationException("operator_reaffirmation_renewal_context_changed");
            if (HasOperatorDirectClaim(pending.RequestId, tx))
                throw new InvalidOperationException("operator_reaffirmation_already_published");
        }
        else if (previous is not null)
            throw new InvalidOperationException("operator_reaffirmation_intent_already_recorded");

        var receipt = new ProtectedOperatorReaffirmationIntent(
            pending.RequestId, meaning.ProjectId, meaning.Branch,
            meaning.RevisionSha, meaning.ProposalRef, meaning.ReviewSnapshotSha256,
            meaning.CanonicalFactSha256, source.Source.SourceEvidenceSha256,
            source.SourceOrigin, source.Source.Kind,
            Hash(enrolledKey.CredentialIdBase64Url),
            proof.SignCount, now.ToString("O"),
            Generation: checked((previous?.Generation ?? 0) + 1), PreviousBindingSha256: previous?.BindingSha256);

        if (!renewal)
        using (var insert = _connection.CreateCommand())
        {
            insert.Transaction = tx;
            insert.CommandText = """
                INSERT INTO protected_operator_reaffirmation_intents
                (request_id, project_id, branch, revision_sha, proposal_ref,
                 snapshot_sha256, fact_sha256, evidence_sha256, source_origin,
                 kind, credential_id_sha256, sign_count, recorded_at_utc,
                 policy_version)
                VALUES
                ($request, $project, $branch, $revision, $proposal,
                 $snapshot, $fact, $evidence, $origin, $kind, $credential,
                 $counter, $when, $policy);
                """;
            insert.Parameters.AddWithValue("$request", receipt.RequestId);
            insert.Parameters.AddWithValue("$project", receipt.ProjectId);
            insert.Parameters.AddWithValue("$branch", receipt.Branch);
            insert.Parameters.AddWithValue("$revision", receipt.RevisionSha);
            insert.Parameters.AddWithValue("$proposal", receipt.ProposalRef);
            insert.Parameters.AddWithValue("$snapshot", receipt.ReviewSnapshotSha256);
            insert.Parameters.AddWithValue("$fact", receipt.CanonicalFactSha256);
            insert.Parameters.AddWithValue("$evidence", receipt.HistoricalEvidenceSha256);
            insert.Parameters.AddWithValue("$origin", receipt.OriginalSourceOrigin);
            insert.Parameters.AddWithValue("$kind", receipt.Kind);
            insert.Parameters.AddWithValue("$credential", receipt.CredentialIdSha256);
            insert.Parameters.AddWithValue("$counter", (long)receipt.SignCount);
            insert.Parameters.AddWithValue("$when", receipt.RecordedAtUtc);
            insert.Parameters.AddWithValue("$policy", OperatorReaffirmationPolicy);
            if (insert.ExecuteNonQuery() != 1)
                throw new InvalidOperationException("operator_reaffirmation_insert_failed");
        }

        using (var generation = _connection.CreateCommand())
        {
            generation.Transaction = tx;
            generation.CommandText = """
                INSERT INTO protected_operator_reaffirmation_generations
                    (request_id,generation,binding_sha256,previous_binding_sha256,sign_count,recorded_at_utc)
                VALUES ($request,$generation,$binding,$previous,$counter,$when);
                """;
            generation.Parameters.AddWithValue("$request", receipt.RequestId);
            generation.Parameters.AddWithValue("$generation", receipt.Generation);
            generation.Parameters.AddWithValue("$binding", receipt.BindingSha256);
            generation.Parameters.AddWithValue("$previous", (object?)receipt.PreviousBindingSha256 ?? DBNull.Value);
            generation.Parameters.AddWithValue("$counter", (long)receipt.SignCount);
            generation.Parameters.AddWithValue("$when", receipt.RecordedAtUtc);
            if (generation.ExecuteNonQuery() != 1)
                throw new InvalidOperationException("operator_reaffirmation_generation_insert_failed");
        }
        if (proof.SignCount > credential.LastSignCount)
        {
            using var update = _connection.CreateCommand();
            update.Transaction = tx;
            update.CommandText = """
                UPDATE protected_operator_credentials
                SET last_sign_count=$counter
                WHERE singleton=1 AND last_sign_count=$previous;
                """;
            update.Parameters.AddWithValue("$counter", (long)proof.SignCount);
            update.Parameters.AddWithValue("$previous", credential.LastSignCount);
            if (update.ExecuteNonQuery() != 1)
                throw new InvalidOperationException("operator_reaffirmation_counter_conflict");
        }
        tx.Commit();
        return receipt;
    }

    /// <summary>
    /// Host-only intent projection; intentionally omits canonical text and
    /// never advertises verified historical evidence or a written Claim.
    /// </summary>
    public ProtectedOperatorReaffirmationIntent? ReadOperatorReaffirmationIntent(
        string projectId, string branch, string proposalRef)
        => ReadOperatorReaffirmationIntent(projectId, branch, proposalRef, null);

    private ProtectedOperatorReaffirmationIntent? ReadOperatorReaffirmationIntent(
        string projectId, string branch, string proposalRef, SqliteTransaction? tx)
    {
        EnsureOpen();
        if (!ValidReadScope(projectId, branch)
            || proposalRef is null || proposalRef.Length > 32)
            throw new ArgumentException("invalid_operator_reaffirmation_read_scope");

        using var cmd = _connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            SELECT a.request_id, a.project_id, a.branch, a.revision_sha,
                a.proposal_ref, a.snapshot_sha256, a.fact_sha256,
                a.evidence_sha256, a.source_origin, a.kind,
                a.credential_id_sha256, a.sign_count, a.recorded_at_utc,
                a.policy_version, s.canonical_fact, s.source_origin,
                s.relation, s.related_claim_id, r.requested_action,
                g.generation, g.binding_sha256, g.previous_binding_sha256, g.sign_count, g.recorded_at_utc,
                (SELECT COUNT(*) FROM protected_operator_reaffirmation_generations WHERE request_id=a.request_id),
                (SELECT binding_sha256 FROM protected_operator_reaffirmation_generations WHERE request_id=a.request_id AND generation=g.generation-1)
            FROM protected_operator_reaffirmation_intents a
            JOIN review_requests r ON r.request_id=a.request_id
              AND r.project_id=a.project_id AND r.branch=a.branch
              AND r.revision_sha=a.revision_sha
              AND r.proposal_ref=a.proposal_ref
              AND r.snapshot_sha256=a.snapshot_sha256
              AND r.fact_sha256=a.fact_sha256
              AND r.evidence_sha256=a.evidence_sha256
            JOIN protected_review_sources s ON s.request_id=a.request_id
              AND s.project_id=a.project_id AND s.branch=a.branch
              AND s.revision_sha=a.revision_sha
              AND s.proposal_ref=a.proposal_ref
              AND s.snapshot_sha256=a.snapshot_sha256
              AND s.fact_sha256=a.fact_sha256
              AND s.evidence_sha256=a.evidence_sha256 AND s.kind=a.kind
            LEFT JOIN protected_operator_reaffirmation_generations g ON g.request_id=a.request_id
              AND g.generation=(SELECT MAX(generation) FROM protected_operator_reaffirmation_generations WHERE request_id=a.request_id)
            WHERE a.project_id=$project AND a.branch=$branch
              AND a.proposal_ref=$proposal;
            """;
        cmd.Parameters.AddWithValue("$project", projectId);
        cmd.Parameters.AddWithValue("$branch", branch);
        cmd.Parameters.AddWithValue("$proposal", proposalRef);
        using var row = cmd.ExecuteReader();
        if (!row.Read()) return null;
        if (row.GetString(13) != OperatorReaffirmationPolicy
            || row.GetString(8) != OperatorSourceOrigin
            || row.GetString(15) != OperatorSourceOrigin
            || row.GetString(16) != "unrelated"
            || !row.IsDBNull(17) || row.GetString(18) != "confirm"
            || Hash(row.GetString(14)) != row.GetString(6))
            throw new InvalidOperationException("operator_reaffirmation_integrity_invalid");
        var receipt = new ProtectedOperatorReaffirmationIntent(
            row.GetString(0), row.GetString(1), row.GetString(2),
            row.GetString(3), row.GetString(4), row.GetString(5),
            row.GetString(6), row.GetString(7), row.GetString(8),
            row.GetString(9), row.GetString(10),
            checked((uint)row.GetInt64(11)), row.GetString(12));
        if (!row.IsDBNull(19))
        {
            var original = receipt;
            receipt = receipt with { Generation = row.GetInt64(19),
                PreviousBindingSha256 = row.IsDBNull(21) ? null : row.GetString(21),
                SignCount = checked((uint)row.GetInt64(22)), RecordedAtUtc = row.GetString(23) };
            if (receipt.BindingSha256 != row.GetString(20) || receipt.Generation != row.GetInt64(24)
                || (receipt.Generation == 1
                    ? (receipt.PreviousBindingSha256 is null
                        ? receipt.RecordedAtUtc != original.RecordedAtUtc || receipt.SignCount != original.SignCount
                        : receipt.PreviousBindingSha256 != original.BindingSha256)
                    : row.IsDBNull(25) || receipt.PreviousBindingSha256 != row.GetString(25)))
                throw new InvalidOperationException("operator_reaffirmation_generation_integrity_invalid");
        }
        if (row.Read())
            throw new InvalidOperationException("operator_reaffirmation_ambiguous");
        return receipt;
    }
}
