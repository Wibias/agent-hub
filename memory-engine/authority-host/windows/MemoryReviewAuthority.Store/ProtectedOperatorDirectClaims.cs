using System.Security.Cryptography;
using System.Text;
using MemoryReviewAuthority.Core;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// A new user-direct statement, authorized by TWO distinct recent gestures:
/// a native protected reaffirmation intent and a fresh Claim-publication UV.
/// Historical operator-pinned evidence is NEVER independently authenticated.
/// This type is NOT exposed by any service IPC or Codex read path.
/// </summary>
public sealed record ProtectedOperatorDirectClaim(
    string ClaimId,
    string RequestId,
    string ProjectId,
    string Branch,
    string RevisionSha,
    string ProposalRef,
    string SnapshotSha256,
    string FactSha256,
    string HistoricalEvidenceSha256,
    string Kind,
    string Value,
    string CreatedAtUtc,
    string Provenance,
    string HistoricalSourceOrigin,
    bool HistoricalEvidenceVerified = false);

public sealed partial class ProtectedPendingReviewLedger
{
    public const string OperatorDirectClaimPolicy = "agenthub-protected-operator-direct-claim-v1";
    public const string OperatorDirectClaimOrigin = "user_direct_reaffirmed_and_published_v1";
    public static readonly TimeSpan OperatorReaffirmationLifetime = TimeSpan.FromMinutes(15);

    private static void InitializeOperatorDirectClaimSchema(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS protected_operator_direct_claims (
                claim_id TEXT PRIMARY KEY NOT NULL,
                request_id TEXT NOT NULL UNIQUE
                    REFERENCES protected_operator_reaffirmation_intents(request_id)
                    ON DELETE RESTRICT,
                project_id TEXT NOT NULL,
                branch TEXT NOT NULL,
                revision_sha TEXT NOT NULL CHECK(length(revision_sha)=40),
                proposal_ref TEXT NOT NULL,
                snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64),
                fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64),
                historical_evidence_sha256 TEXT NOT NULL
                    CHECK(length(historical_evidence_sha256)=64),
                kind TEXT NOT NULL CHECK(kind IN ('knowledge','preference')),
                value_text TEXT NOT NULL CHECK(length(value_text) BETWEEN 1 AND 4000),
                created_at_utc TEXT NOT NULL,
                source_origin TEXT NOT NULL CHECK(
                    source_origin='user_direct_reaffirmed_and_published_v1'),
                historical_source_origin TEXT NOT NULL CHECK(
                    historical_source_origin='operator_pinned_unverified_evidence_v1'),
                historical_evidence_verified INTEGER NOT NULL DEFAULT 0
                    CHECK(historical_evidence_verified=0),
                credential_id_sha256 TEXT NOT NULL
                    CHECK(length(credential_id_sha256)=64),
                sign_count INTEGER NOT NULL CHECK(
                    sign_count BETWEEN 0 AND 4294967295),
                policy_version TEXT NOT NULL CHECK(
                    policy_version='agenthub-protected-operator-direct-claim-v1'),
                UNIQUE(project_id,branch,fact_sha256),
                UNIQUE(project_id,branch,proposal_ref)
            ) STRICT;
            CREATE TRIGGER IF NOT EXISTS deny_direct_claim_update
              BEFORE UPDATE ON protected_operator_direct_claims
              BEGIN SELECT RAISE(ABORT, 'operator_direct_claim_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_direct_claim_delete
              BEFORE DELETE ON protected_operator_direct_claims
              BEGIN SELECT RAISE(ABORT, 'operator_direct_claim_immutable'); END;
            """;
        cmd.ExecuteNonQuery();
    }

    /// <summary>
    /// The host's second, separate explicit publication gesture. The
    /// WebAuthn verifier has already consumed its commit-purpose ticket.
    /// This code verifies the immutable first reaffirmation, exact trusted
    /// PROTECTED copy of the candidate text and monotonic credential counter.
    /// A successful insert remains PRIVATE until an independently designed
    /// signed, scope-validated read projection is accepted for Codex.
    /// </summary>
    internal ProtectedOperatorDirectClaim CommitOperatorDirectClaim(
        ReviewMeaning meaning, PinnedCredential pinned, VerificationResult proof)
    {
        EnsureOpen();
        if (meaning is null || pinned is null || proof is null
            || meaning.Decision != "confirm"
            || !proof.Verified || !proof.UserPresent || !proof.UserVerified
            || proof.Status != "verified_protected_claim_commit_intent_only"
            || proof.ApprovedReviewDecision || proof.ClaimWritten
            || meaning.CanonicalFact is not { Length: > 0 and <= 4000 }
            || Hash(meaning.CanonicalFact) != meaning.CanonicalFactSha256)
            throw new InvalidOperationException("direct_claim_commit_purpose_required");

        // The pending decision, verified native pin, original protected
        // source, previous reaffirmation and new Claim are checked and
        // inserted under the SAME immediate SQLite transaction.
        using var tx = _connection.BeginTransaction(deferred: false);
        var credential = FindOperatorCredential(tx);
        if (credential is null
            || credential.EnrollmentState != NativeEnrollmentState
            || credential.Credential != pinned)
            throw new InvalidOperationException("direct_claim_native_credential_required");
        var pending = Lookup(meaning.ProjectId, meaning.Branch, meaning.ProposalRef, tx);
        if (pending is null || pending.Status != PendingState
            || pending.Review.RevisionSha != meaning.RevisionSha
            || pending.Review.ReviewSnapshotSha256 != meaning.ReviewSnapshotSha256
            || pending.Review.CanonicalFactSha256 != meaning.CanonicalFactSha256
            || pending.Review.RequestedAction != "confirm"
            || FindVerifiedIntent(pending.RequestId, tx) is not null)
            throw new InvalidOperationException("direct_claim_pending_context_changed");

        var source = FindServiceOwnedSource(pending.RequestId, tx);
        if (source is null || source.SourceOrigin != OperatorSourceOrigin)
            throw new InvalidOperationException("direct_claim_untrusted_source");
        ValidateSource(pending.Review, source.Source);
        if (source.Source.CanonicalFact != meaning.CanonicalFact
            || source.Source.Relation != "unrelated"
            || source.Source.RelatedClaimId is not null
            || source.Source.Kind is not ("knowledge" or "preference"))
            throw new InvalidOperationException("direct_claim_related_or_unsafe_source");

        // The earlier human reaffirmation MUST be present, immutable and
        // fresh. Its statement cannot be reused for a publication much later.
        using (var first = _connection.CreateCommand())
        {
            first.Transaction = tx;
            first.CommandText = """
                SELECT project_id,branch,revision_sha,proposal_ref,
                       snapshot_sha256,fact_sha256,evidence_sha256,
                       source_origin,kind,credential_id_sha256,sign_count,
                       recorded_at_utc,policy_version
                FROM protected_operator_reaffirmation_intents
                WHERE request_id=$request;
                """;
            first.Parameters.AddWithValue("$request", pending.RequestId);
            using var row = first.ExecuteReader();
            if (!row.Read()
                || row.GetString(0) != meaning.ProjectId
                || row.GetString(1) != meaning.Branch
                || row.GetString(2) != meaning.RevisionSha
                || row.GetString(3) != meaning.ProposalRef
                || row.GetString(4) != meaning.ReviewSnapshotSha256
                || row.GetString(5) != meaning.CanonicalFactSha256
                || row.GetString(6) != source.Source.SourceEvidenceSha256
                || row.GetString(7) != OperatorSourceOrigin
                || row.GetString(8) != source.Source.Kind
                || row.GetString(9) != Hash(pinned.CredentialIdBase64Url)
                || row.GetString(12) != OperatorReaffirmationPolicy
                || !DateTimeOffset.TryParse(row.GetString(11), out var reaffirmed)
                || reaffirmed > DateTimeOffset.UtcNow
                || DateTimeOffset.UtcNow - reaffirmed > OperatorReaffirmationLifetime
                || row.GetInt64(10) > credential.LastSignCount)
                throw new InvalidOperationException("direct_claim_reaffirmation_missing_or_stale");
            if (row.Read())
                throw new InvalidOperationException("direct_claim_ambiguous_reaffirmation");
        }

        if (proof.SignCount > 0 && credential.LastSignCount > 0
            && proof.SignCount <= credential.LastSignCount)
            throw new InvalidOperationException("direct_claim_counter_replay");

        // Check unique fact across the existing synthetic lab table too.
        // The new DIRECT table is a separate provenance type, never a
        // synthetic claim with a misleading source-origin label.
        using (var duplicate = _connection.CreateCommand())
        {
            duplicate.Transaction = tx;
            duplicate.CommandText = """
                SELECT EXISTS(
                    SELECT 1 FROM protected_review_claims
                    WHERE project_id=$project AND branch=$branch AND fact_sha256=$hash
                );
                """;
            duplicate.Parameters.AddWithValue("$project", meaning.ProjectId);
            duplicate.Parameters.AddWithValue("$branch", meaning.Branch);
            duplicate.Parameters.AddWithValue("$hash", meaning.CanonicalFactSha256);
            if (Convert.ToInt32(duplicate.ExecuteScalar()) != 0)
                throw new InvalidOperationException("direct_claim_conflicts_with_lab_claim");
        }

        var when = DateTimeOffset.UtcNow.ToString("O");
        var claim = new ProtectedOperatorDirectClaim(
            "C~" + Hash("agenthub-protected-operator-direct-claim-v1\n"
                + pending.RequestId + "\n" + meaning.CanonicalFactSha256)[..24],
            pending.RequestId, meaning.ProjectId, meaning.Branch,
            meaning.RevisionSha, meaning.ProposalRef,
            meaning.ReviewSnapshotSha256, meaning.CanonicalFactSha256,
            source.Source.SourceEvidenceSha256, source.Source.Kind,
            meaning.CanonicalFact, when, OperatorDirectClaimOrigin, OperatorSourceOrigin);

        using (var insert = _connection.CreateCommand())
        {
            insert.Transaction = tx;
            insert.CommandText = """
                INSERT INTO protected_operator_direct_claims
                (claim_id,request_id,project_id,branch,revision_sha,
                 proposal_ref,snapshot_sha256,fact_sha256,historical_evidence_sha256,
                 kind,value_text,created_at_utc,source_origin,
                 historical_source_origin,historical_evidence_verified,
                 credential_id_sha256,sign_count,policy_version)
                VALUES ($id,$request,$project,$branch,$revision,$proposal,$snapshot,
                        $fact,$evidence,$kind,$value,$when,$origin,$historic,0,
                        $credential,$counter,$policy);
                """;
            insert.Parameters.AddWithValue("$id", claim.ClaimId);
            insert.Parameters.AddWithValue("$request", claim.RequestId);
            insert.Parameters.AddWithValue("$project", claim.ProjectId);
            insert.Parameters.AddWithValue("$branch", claim.Branch);
            insert.Parameters.AddWithValue("$revision", claim.RevisionSha);
            insert.Parameters.AddWithValue("$proposal", claim.ProposalRef);
            insert.Parameters.AddWithValue("$snapshot", claim.SnapshotSha256);
            insert.Parameters.AddWithValue("$fact", claim.FactSha256);
            insert.Parameters.AddWithValue("$evidence", claim.HistoricalEvidenceSha256);
            insert.Parameters.AddWithValue("$kind", claim.Kind);
            insert.Parameters.AddWithValue("$value", claim.Value);
            insert.Parameters.AddWithValue("$when", claim.CreatedAtUtc);
            insert.Parameters.AddWithValue("$origin", claim.Provenance);
            insert.Parameters.AddWithValue("$historic", claim.HistoricalSourceOrigin);
            insert.Parameters.AddWithValue("$credential", Hash(pinned.CredentialIdBase64Url));
            insert.Parameters.AddWithValue("$counter", (long)proof.SignCount);
            insert.Parameters.AddWithValue("$policy", OperatorDirectClaimPolicy);
            if (insert.ExecuteNonQuery() != 1)
                throw new InvalidOperationException("direct_claim_insert_failed");
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
                throw new InvalidOperationException("direct_claim_counter_conflict");
        }
        tx.Commit();
        return claim;
    }

    /// <summary>
    /// Host-internal projection only. NEVER use for current public read pipe,
    /// hooks or Codex before separately authenticating scope and signing.
    /// </summary>
    public IReadOnlyList<ProtectedOperatorDirectClaim> ReadOperatorDirectClaims(
        string projectId, string branch, int maxItems = 20)
    {
        EnsureOpen();
        if (!ValidReadScope(projectId, branch)
            || maxItems is < 1 or > 100)
            throw new ArgumentException("direct_claim_invalid_scope");
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = """
            SELECT c.claim_id,c.request_id,c.project_id,c.branch,
                   c.revision_sha,c.proposal_ref,c.snapshot_sha256,c.fact_sha256,
                   c.historical_evidence_sha256,c.kind,c.value_text,
                   c.created_at_utc,c.source_origin,c.historical_source_origin,
                   c.historical_evidence_verified,c.policy_version,
                   r.fact_sha256,r.evidence_sha256,r.snapshot_sha256,
                   s.canonical_fact,s.source_origin,
                   a.fact_sha256,a.evidence_sha256,a.source_origin
            FROM protected_operator_direct_claims c
            JOIN review_requests r ON r.request_id=c.request_id
                AND r.project_id=c.project_id AND r.branch=c.branch
                AND r.revision_sha=c.revision_sha
                AND r.proposal_ref=c.proposal_ref
            JOIN protected_review_sources s ON s.request_id=c.request_id
                AND s.project_id=c.project_id AND s.branch=c.branch
                AND s.revision_sha=c.revision_sha
                AND s.proposal_ref=c.proposal_ref
            JOIN protected_operator_reaffirmation_intents a
                ON a.request_id=c.request_id AND a.project_id=c.project_id
                AND a.branch=c.branch AND a.revision_sha=c.revision_sha
                AND a.proposal_ref=c.proposal_ref
            WHERE c.project_id=$project AND c.branch=$branch
            ORDER BY c.created_at_utc DESC,c.claim_id ASC LIMIT $limit;
            """;
        cmd.Parameters.AddWithValue("$project", projectId);
        cmd.Parameters.AddWithValue("$branch", branch);
        cmd.Parameters.AddWithValue("$limit", maxItems);
        using var reader = cmd.ExecuteReader();
        var found = new List<ProtectedOperatorDirectClaim>();
        while (reader.Read())
        {
            if (reader.GetString(15) != OperatorDirectClaimPolicy
                || reader.GetInt64(14) != 0
                || reader.GetString(12) != OperatorDirectClaimOrigin
                || reader.GetString(13) != OperatorSourceOrigin
                || reader.GetString(20) != OperatorSourceOrigin
                || reader.GetString(23) != OperatorSourceOrigin
                || reader.GetString(16) != reader.GetString(7)
                || reader.GetString(17) != reader.GetString(8)
                || reader.GetString(18) != reader.GetString(6)
                || reader.GetString(19) != reader.GetString(10)
                || reader.GetString(21) != reader.GetString(7)
                || reader.GetString(22) != reader.GetString(8)
                || Hash(reader.GetString(10)) != reader.GetString(7))
                throw new InvalidOperationException("direct_claim_integrity_invalid");
            found.Add(new ProtectedOperatorDirectClaim(
                reader.GetString(0),reader.GetString(1),reader.GetString(2),
                reader.GetString(3),reader.GetString(4),reader.GetString(5),
                reader.GetString(6),reader.GetString(7),reader.GetString(8),
                reader.GetString(9),reader.GetString(10),reader.GetString(11),
                reader.GetString(12),reader.GetString(13)));
        }
        return found;
    }
}
