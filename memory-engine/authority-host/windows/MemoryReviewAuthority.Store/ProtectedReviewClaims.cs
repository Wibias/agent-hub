using MemoryReviewAuthority.Core;
using Microsoft.Data.Sqlite;
using System.Security.Cryptography;
using System.Text;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// A host-derived, independently checked source snapshot. The caller-supplied
/// canonical Memory SQLite database must NEVER be treated as a trusted source
/// merely because its rows contain a user_direct label.
/// </summary>
public sealed record TrustedReviewSource(
    string ProjectId,
    string Branch,
    string RevisionSha,
    string ProposalRef,
    string ReviewSnapshotSha256,
    string CanonicalFact,
    string SourceEvidenceSha256,
    string Kind,
    string Relation,
    string? RelatedClaimId);

/// <summary>
/// A service-owned immutable fact, not a row in the user-writable Memory DB.
/// No direct client can create one; the in-process host has to verify the
/// exact source and a one-use UV assertion before the atomic insert.
/// </summary>
public sealed record ProtectedReviewClaim(
    string ClaimId,
    string RequestId,
    string ProjectId,
    string Branch,
    string RevisionSha,
    string ProposalRef,
    string ReviewSnapshotSha256,
    string CanonicalFactSha256,
    string SourceEvidenceSha256,
    string Kind,
    string Value,
    string CreatedAtUtc,
    string PolicyVersion);

public sealed record ProtectedReviewDecisionResult(
    bool Recorded,
    string Disposition,
    string RequestId,
    ProtectedReviewClaim? Claim,
    bool ClaimWritten);

public sealed partial class ProtectedPendingReviewLedger
{
    public const string ProtectedClaimPolicyVersion = "agenthub-protected-review-claim-v1";

    private static void InitializeProtectedClaimSchema(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS protected_review_claims (
                claim_id TEXT PRIMARY KEY NOT NULL,
                request_id TEXT NOT NULL UNIQUE
                    REFERENCES review_requests(request_id) ON DELETE RESTRICT,
                project_id TEXT NOT NULL,
                branch TEXT NOT NULL,
                revision_sha TEXT NOT NULL CHECK (length(revision_sha)=40),
                proposal_ref TEXT NOT NULL,
                snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256)=64),
                fact_sha256 TEXT NOT NULL CHECK (length(fact_sha256)=64),
                evidence_sha256 TEXT NOT NULL CHECK (length(evidence_sha256)=64),
                kind TEXT NOT NULL CHECK (kind IN ('knowledge','preference')),
                value_text TEXT NOT NULL CHECK (length(value_text)>0),
                created_at_utc TEXT NOT NULL,
                policy_version TEXT NOT NULL
                    CHECK (policy_version='agenthub-protected-review-claim-v1'),
                UNIQUE (project_id, branch, fact_sha256),
                UNIQUE (project_id, branch, proposal_ref)
            ) STRICT;
            CREATE INDEX IF NOT EXISTS protected_review_claims_scope
              ON protected_review_claims(project_id, branch, created_at_utc);
            """;
        command.ExecuteNonQuery();
    }

    /// <summary>
    /// Bounded, service-side read projection. No public pipe, HTTP handler or
    /// model-controlled path is installed by this library.
    /// </summary>
    public IReadOnlyList<ProtectedReviewClaim> ReadProtectedClaims(
        string projectId, string branch, int maxItems = 20)
    {
        EnsureOpen();
        if (!ValidReadScope(projectId, branch)
            || maxItems is < 1 or > 100)
            throw new ArgumentException("invalid_protected_claim_read_scope");
        using var command = _connection.CreateCommand();
        command.CommandText = """
            SELECT c.claim_id, c.request_id, c.project_id, c.branch,
                   c.revision_sha, c.proposal_ref, c.snapshot_sha256,
                   c.fact_sha256, c.evidence_sha256, c.kind, c.value_text,
                   c.created_at_utc, c.policy_version
            FROM protected_review_claims c
            JOIN verified_review_intents v ON v.request_id=c.request_id
            WHERE c.project_id=$project AND c.branch=$branch
              AND v.disposition=$confirm
            ORDER BY c.created_at_utc DESC, c.claim_id ASC
            LIMIT $limit;
            """;
        command.Parameters.AddWithValue("$project", projectId);
        command.Parameters.AddWithValue("$branch", branch);
        command.Parameters.AddWithValue("$confirm", ConfirmDisposition);
        command.Parameters.AddWithValue("$limit", maxItems);
        var found = new List<ProtectedReviewClaim>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            var claim = new ProtectedReviewClaim(
                reader.GetString(0), reader.GetString(1), reader.GetString(2),
                reader.GetString(3), reader.GetString(4), reader.GetString(5),
                reader.GetString(6), reader.GetString(7), reader.GetString(8),
                reader.GetString(9), reader.GetString(10), reader.GetString(11),
                reader.GetString(12));
            if (claim.PolicyVersion != ProtectedClaimPolicyVersion
                || claim.Value.Length is < 1 or > 4000
                || Hash(claim.Value) != claim.CanonicalFactSha256)
                throw new InvalidOperationException("protected_claim_integrity_invalid");
            found.Add(claim);
        }
        return found;
    }

    private static bool ValidReadScope(string? projectId, string? branch)
        => projectId is { Length: > 0 and <= 256 }
            && branch is { Length: > 0 and <= 128 }
            && !projectId.Contains(' ') && !branch.Contains(' ');

    private static string Hash(string value)
        => Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    /// <summary>
    /// Writes the verified decision AND (for an unrelated confirm only) the
    /// protected Claim in ONE immediate transaction. Rejection is a durable
    /// decision without a Claim. Does not mutate canonical Memory SQLite.
    /// Caller: the in-process coordinator only, after valid one-time UV proof
    /// and independent host-side exact source resolution.
    /// </summary>
    internal ProtectedReviewDecisionResult CommitReviewedDecision(
        ReviewMeaning meaning,
        PinnedCredential credential,
        VerificationResult proof,
        TrustedReviewSource currentSource)
    {
        EnsureOpen();
        if (meaning is null || credential is null || proof is null
            || currentSource is null || !proof.Verified
            || !proof.UserPresent || !proof.UserVerified
            || proof.ApprovedReviewDecision || proof.ClaimWritten)
            throw new InvalidOperationException("verified_host_proof_required");
        if (meaning.CanonicalFact is null
            || meaning.CanonicalFact.Length is < 1 or > 4000
            || Hash(meaning.CanonicalFact) != meaning.CanonicalFactSha256)
            throw new InvalidOperationException("review_fact_invalid");
        // This check is necessary but NOT sufficient to trust the source.
        // The host must inject a trusted reader, never take a client object.
        if (currentSource.ProjectId != meaning.ProjectId
            || currentSource.Branch != meaning.Branch
            || currentSource.RevisionSha != meaning.RevisionSha
            || currentSource.ProposalRef != meaning.ProposalRef
            || currentSource.ReviewSnapshotSha256 != meaning.ReviewSnapshotSha256
            || currentSource.CanonicalFact != meaning.CanonicalFact
            || currentSource.Kind is not ("knowledge" or "preference")
            || currentSource.Relation != "unrelated"
            || currentSource.RelatedClaimId is not null
            || currentSource.SourceEvidenceSha256 is not { Length: 64 }
            || !currentSource.SourceEvidenceSha256.All(c =>
                c is >= '0' and <= '9' or >= 'a' and <= 'f'))
            throw new InvalidOperationException("trusted_source_mismatch_or_relation_unsafe");

        using var transaction = _connection.BeginTransaction(deferred: false);
        var pending = Lookup(meaning.ProjectId, meaning.Branch,
            meaning.ProposalRef, transaction);
        if (pending is null
            || pending.Review.RevisionSha != meaning.RevisionSha
            || pending.Review.ReviewSnapshotSha256 != meaning.ReviewSnapshotSha256
            || pending.Review.CanonicalFactSha256 != meaning.CanonicalFactSha256
            || pending.Review.SourceEvidenceSha256 != currentSource.SourceEvidenceSha256
            || pending.Review.RequestedAction != meaning.Decision
            || pending.Status != PendingState)
            throw new InvalidOperationException("pending_review_changed");
        if (FindVerifiedIntent(pending.RequestId, transaction) is not null)
            throw new InvalidOperationException("review_decision_already_recorded");

        // Record the same UV proof as the existing verified-intent API, but do
        // not commit halfway through. Rollback removes BOTH decision and Claim.
        var disposition = meaning.Decision switch
        {
            "confirm" => ConfirmDisposition,
            "reject" => RejectDisposition,
            _ => throw new InvalidOperationException("invalid_review_action"),
        };
        var when = DateTimeOffset.UtcNow.ToString("O");
        using (var insert = _connection.CreateCommand())
        {
            insert.Transaction = transaction;
            insert.CommandText = """
                INSERT INTO verified_review_intents
                (request_id, disposition, credential_id_sha256, sign_count,
                 verified_at_utc, policy_version)
                VALUES ($request,$disposition,$credential,$count,$when,$policy);
                """;
            insert.Parameters.AddWithValue("$request", pending.RequestId);
            insert.Parameters.AddWithValue("$disposition", disposition);
            insert.Parameters.AddWithValue("$credential",
                Hash(credential.CredentialIdBase64Url));
            insert.Parameters.AddWithValue("$count", checked((long)proof.SignCount));
            insert.Parameters.AddWithValue("$when", when);
            insert.Parameters.AddWithValue("$policy", VerifiedIntentPolicyVersion);
            if (insert.ExecuteNonQuery() != 1)
                throw new InvalidOperationException("verified_review_decision_insert_failed");
        }

        ProtectedReviewClaim? claim = null;
        if (meaning.Decision == "confirm")
        {
            var claimId = "C~" + Hash(
                "agenthub-protected-claim-v1\n"
                + pending.RequestId + "\n" + pending.Review.CanonicalFactSha256
            )[..24];
            claim = new ProtectedReviewClaim(
                claimId, pending.RequestId, meaning.ProjectId, meaning.Branch,
                meaning.RevisionSha, meaning.ProposalRef,
                meaning.ReviewSnapshotSha256, meaning.CanonicalFactSha256,
                currentSource.SourceEvidenceSha256, currentSource.Kind,
                meaning.CanonicalFact, when, ProtectedClaimPolicyVersion);
            using var insert = _connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = """
                INSERT INTO protected_review_claims
                (claim_id, request_id, project_id, branch, revision_sha,
                 proposal_ref, snapshot_sha256, fact_sha256, evidence_sha256,
                 kind, value_text, created_at_utc, policy_version)
                VALUES ($id,$request,$project,$branch,$revision,$proposal,
                        $snapshot,$fact,$evidence,$kind,$value,$when,$policy);
                """;
            insert.Parameters.AddWithValue("$id", claim.ClaimId);
            insert.Parameters.AddWithValue("$request", claim.RequestId);
            insert.Parameters.AddWithValue("$project", claim.ProjectId);
            insert.Parameters.AddWithValue("$branch", claim.Branch);
            insert.Parameters.AddWithValue("$revision", claim.RevisionSha);
            insert.Parameters.AddWithValue("$proposal", claim.ProposalRef);
            insert.Parameters.AddWithValue("$snapshot", claim.ReviewSnapshotSha256);
            insert.Parameters.AddWithValue("$fact", claim.CanonicalFactSha256);
            insert.Parameters.AddWithValue("$evidence", claim.SourceEvidenceSha256);
            insert.Parameters.AddWithValue("$kind", claim.Kind);
            insert.Parameters.AddWithValue("$value", claim.Value);
            insert.Parameters.AddWithValue("$when", claim.CreatedAtUtc);
            insert.Parameters.AddWithValue("$policy", claim.PolicyVersion);
            if (insert.ExecuteNonQuery() != 1)
                throw new InvalidOperationException("protected_claim_insert_failed");
        }
        transaction.Commit();
        return new ProtectedReviewDecisionResult(
            true, disposition, pending.RequestId, claim, claim is not null);
    }
}
