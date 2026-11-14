using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// A REAL E~ candidate imported from an operator-pinned, consistent COPY of
/// canonical Memory SQLite. Data provenance remains USER-WRITABLE / UNVERIFIED:
/// this import never grants human approval or enables a protected Claim.
///
/// This file replaces synthetic-only E~ ingestion in the protected host's
/// *candidate* path. It does not enable a model-callable write API.
/// </summary>
public sealed record OperatorEvidenceImport(
    string ProjectId, string Branch, string RevisionSha, string ProposalRef,
    string CanonicalFactSha256, string ReviewSnapshotSha256,
    string SourceEvidenceSha256, string Kind, string CanonicalFact,
    string PendingRequestId, string SourceOrigin, int EvidenceCount,
    string RequestedAction, bool HumanApprovalVerified = false,
    bool ClaimWritten = false);

public sealed partial class ProtectedPendingReviewLedger
{
    public const string OperatorSourceOrigin = "operator_pinned_unverified_evidence_v1";
    public const string OperatorEvidencePolicy = "agenthub-protected-operator-evidence-import-v1";
    public const string OperatorSnapshotFile = "operator-evidence-snapshot.sqlite3";
    public const string OperatorManifestFile = "operator-evidence-manifest.json";

    private sealed record Manifest(string? ProjectId, string? Branch,
        string? RevisionSha, string? ProposalRef, string? Decision);

    private sealed record EvidenceRow(string Id, string Authority,
        string Content, string Metadata);

    private static string Sha(string text)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)))
            .ToLowerInvariant();

    private static bool IsAsciiScope(string? text, int max)
        => text is { Length: > 0 } && text.Length <= max
            && text.All(c => c is >= '!' and <= '~');

    private static bool Hex(string? text, int length)
        => text is not null && text.Length == length
            && text.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');

    /// <summary>
    /// Import exactly one REAL E~ proposal, reading ONLY the fixed files in
    /// the same pre-ACL-verified protected directory as this ledger.
    /// The host/installer must first pin a consistent SQLite backup and
    /// manifest as an explicit elevated OPERATOR operation, NOT by a Codex
    /// client or an agent-supplied source path.
    ///
    /// No source trust is inferred from user_direct, repo_trusted, tool_result
    /// or file presence: those values are metadata from an untrusted DB.
    /// There is no implicit consent, WebAuthn enrollment or Claim write.
    /// </summary>
    public OperatorEvidenceImport ImportOperatorPinnedEvidence()
    {
        EnsureOpen();
        var snapshotPath = Path.Combine(_protectedDirectory, OperatorSnapshotFile);
        var manifestPath = Path.Combine(_protectedDirectory, OperatorManifestFile);
        static void CheckPinnedFile(string path, long max)
        {
            var file = new FileInfo(path);
            if (!file.Exists || file.Length <= 0 || file.Length > max
                || (file.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("operator_pinned_file_absent_or_invalid");
        }

        CheckPinnedFile(snapshotPath, 512L * 1024 * 1024);
        CheckPinnedFile(manifestPath, 4096);

        using var manifestJson = JsonDocument.Parse(File.ReadAllBytes(manifestPath));
        var root = manifestJson.RootElement;
        if (root.ValueKind != JsonValueKind.Object
            || root.EnumerateObject().Count() != 5)
            throw new InvalidOperationException("operator_manifest_invalid");
        static string? Field(JsonElement root, string name)
            => root.TryGetProperty(name, out var value)
                && value.ValueKind == JsonValueKind.String
                ? value.GetString() : null;
        var manifest = new Manifest(Field(root, "projectId"), Field(root, "branch"),
            Field(root, "revisionSha"), Field(root, "proposalRef"),
            Field(root, "decision"));
        if (!IsAsciiScope(manifest.ProjectId, 256)
            || !IsAsciiScope(manifest.Branch, 128)
            || !Hex(manifest.RevisionSha, 40)
            || manifest.ProposalRef is null
            || !System.Text.RegularExpressions.Regex.IsMatch(
                manifest.ProposalRef, @"\AE~[0-9a-f]{10}\z")
            || manifest.Decision is not ("confirm" or "reject"))
            throw new InvalidOperationException("operator_manifest_scope_invalid");

        // Read a consistent SQLite backup, not the user's live mutable DB.
        // The operator-pinned file is still UNTRUSTED as a user fact source.
        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = snapshotPath, Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Private, Pooling = false,
            ForeignKeys = true,
        };
        using var input = new SqliteConnection(builder.ToString());
        input.Open();
        using (var pragma = input.CreateCommand())
        {
            pragma.CommandText = "PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;";
            pragma.ExecuteNonQuery();
        }
        using var pinnedRead = input.BeginTransaction(deferred: true);

        // Determine E~ from the stored real proposal ID, not caller-supplied
        // metadata. The ref is a SHA256/10-hex prefix, and collisions deny.
        string? id = null;
        using (var query = input.CreateCommand())
        {
            query.Transaction = pinnedRead;
            query.CommandText = """
                SELECT id FROM memory_evidence_proposals
                WHERE project_id=$p AND branch=$b
                AND status='needs_confirmation'
                ORDER BY id LIMIT 10001;
                """;
            query.Parameters.AddWithValue("$p", manifest.ProjectId!);
            query.Parameters.AddWithValue("$b", manifest.Branch!);
            using var reader = query.ExecuteReader();
            var count = 0;
            while (reader.Read())
            {
                count++;
                if (count > 10000)
                    throw new InvalidOperationException("operator_proposal_limit");
                var candidate = reader.GetString(0);
                if ("E~" + Sha(candidate)[..10] != manifest.ProposalRef) continue;
                if (id is not null)
                    throw new InvalidOperationException("operator_opaque_ref_collision");
                id = candidate;
            }
        }
        if (id is null) throw new InvalidOperationException("operator_evidence_not_found");

        string kind;
        string fact;
        string proposalFingerprint;
        using (var query = input.CreateCommand())
        {
            query.Transaction = pinnedRead;
            query.CommandText = """
                SELECT kind, canonical_fact, fingerprint FROM memory_evidence_proposals
                WHERE id=$id AND project_id=$p AND branch=$b
                  AND status='needs_confirmation';
                """;
            query.Parameters.AddWithValue("$id", id);
            query.Parameters.AddWithValue("$p", manifest.ProjectId!);
            query.Parameters.AddWithValue("$b", manifest.Branch!);
            using var reader = query.ExecuteReader();
            if (!reader.Read())
                throw new InvalidOperationException("operator_evidence_changed");
            kind = reader.GetString(0);
            fact = reader.GetString(1);
            proposalFingerprint = reader.GetString(2);
            if (reader.Read())
                throw new InvalidOperationException("operator_evidence_duplicate");
        }
        if (kind is not ("knowledge" or "preference")
            || string.IsNullOrWhiteSpace(fact) || fact.Length > 4000)
            throw new InvalidOperationException("operator_fact_kind_unsupported");
        // Compare with the extraction pipeline's kind + NUL + NFKC/lower
        // canonical fingerprint, rather than relying on any stored hash.
        var normalizedFact = System.Text.RegularExpressions.Regex.Replace(
            fact.Normalize(NormalizationForm.FormKC), @"\s+", " ")
            .Trim().Normalize(NormalizationForm.FormKC).ToLowerInvariant();
        if (!Hex(proposalFingerprint, 64)
            || Sha(kind + "\0" + normalizedFact) != proposalFingerprint)
            throw new InvalidOperationException("operator_proposal_fingerprint_mismatch");

        // If the original pipeline explicitly targeted an earlier Claim,
        // it cannot be silently converted into an unrelated Claim merely
        // because the current active-Claims table is empty.
        using (var relations = input.CreateCommand())
        {
            relations.Transaction = pinnedRead;
            relations.CommandText = """
                SELECT 1 FROM sqlite_master WHERE type='table'
                  AND name='memory_evidence_proposal_relations';
                """;
            if (relations.ExecuteScalar() is not null)
            {
                using var relation = input.CreateCommand();
                relation.Transaction = pinnedRead;
                relation.CommandText = """
                    SELECT relation, related_claim_id
                    FROM memory_evidence_proposal_relations WHERE proposal_id=$id;
                    """;
                relation.Parameters.AddWithValue("$id", id);
                using var r = relation.ExecuteReader();
                if (r.Read() && (r.GetString(0) != "unrelated"
                    || !r.IsDBNull(1) || r.Read()))
                    throw new InvalidOperationException("operator_targeted_relation_unsafe");
            }
        }

        // No automatic update/supersede/contradiction support. When any
        // active Claim is present, the operator must resolve its relation
        // separately. An exact unrelated fact can proceed as a CANDIDATE
        // only when the comparison scope is empty.
        using (var countClaims = input.CreateCommand())
        {
            countClaims.Transaction = pinnedRead;
            countClaims.CommandText = """
                SELECT COUNT(*) FROM claims WHERE project_id=$p
                  AND branch_scope=$b AND state='active';
                """;
            countClaims.Parameters.AddWithValue("$p", manifest.ProjectId!);
            countClaims.Parameters.AddWithValue("$b", manifest.Branch!);
            if (Convert.ToInt64(countClaims.ExecuteScalar()) != 0)
                throw new InvalidOperationException("operator_relation_review_required");
        }

        var rows = new List<EvidenceRow>();
        using (var query = input.CreateCommand())
        {
            query.Transaction = pinnedRead;
            query.CommandText = """
                SELECT l.evidence_id, e.id, e.project_id, e.branch,
                       e.authority_class, e.sensitivity, e.content_redacted,
                       e.metadata_json
                FROM memory_evidence_proposal_evidence l
                LEFT JOIN evidence e ON e.id=l.evidence_id
                WHERE l.proposal_id=$id ORDER BY l.evidence_id;
                """;
            query.Parameters.AddWithValue("$id", id);
            using var reader = query.ExecuteReader();
            while (reader.Read())
            {
                if (rows.Count >= 10
                    || reader.IsDBNull(1)
                    || reader.GetString(0) != reader.GetString(1)
                    || reader.GetString(2) != manifest.ProjectId
                    || reader.GetString(3) != manifest.Branch
                    || reader.IsDBNull(4) || reader.IsDBNull(5)
                    || reader.IsDBNull(6))
                    throw new InvalidOperationException("operator_evidence_scope_invalid");
                var authority = reader.GetString(4);
                if (reader.GetString(5) != "normal"
                    || authority is not ("user_direct" or "repo_trusted" or "tool_observation")
                    || (kind == "preference" && authority != "user_direct"))
                    throw new InvalidOperationException("operator_evidence_authority_unsafe");
                var text = reader.GetString(6);
                var metadata = reader.IsDBNull(7) ? "" : reader.GetString(7);
                if (text.Length > 65536 || metadata.Length > 16384)
                    throw new InvalidOperationException("operator_evidence_size_invalid");
                if (authority == "tool_observation")
                {
                    using var metadataJson = JsonDocument.Parse(
                        string.IsNullOrEmpty(metadata) ? "{}" : metadata);
                    if (metadataJson.RootElement.ValueKind != JsonValueKind.Object)
                        throw new InvalidOperationException("operator_tool_metadata_invalid");
                    if (metadataJson.RootElement.TryGetProperty(
                        "tool_outcome", out var outcome)
                        && outcome.ValueKind == JsonValueKind.String
                        && outcome.GetString() == "failure")
                        throw new InvalidOperationException("operator_failed_tool_source");
                }
                rows.Add(new EvidenceRow(reader.GetString(0), authority,
                    text, metadata));
            }
        }
        if (rows.Count == 0)
            throw new InvalidOperationException("operator_evidence_missing");

        // A source digest binds the actual TEXT and metadata of every
        // linked Evidence row, not merely caller-supplied evidence IDs.
        var evidenceSha = Sha(JsonSerializer.Serialize(rows.Select(r => new
        {
            id = r.Id, authority = r.Authority,
            content = r.Content, metadata = r.Metadata,
        }).ToArray()));

        var factSha = Sha(fact);
        // Hash the entire protected-copy database in addition to the exact
        // fact and Evidence rows. Hidden policy/importance/support changes
        // cannot silently preserve the same pinned snapshot identity.
        using var sourceStream = File.OpenRead(snapshotPath);
        var snapshotFileHash = Convert.ToHexString(
            SHA256.HashData(sourceStream)).ToLowerInvariant();
        var snapshotSha = Sha(JsonSerializer.Serialize(new
        {
            policy = OperatorEvidencePolicy,
            project = manifest.ProjectId,
            branch = manifest.Branch,
            revision = manifest.RevisionSha,
            proposal = manifest.ProposalRef,
            sourceProposalId = id,
            factSha,
            evidenceSha,
            snapshotFileHash,
            kind,
            action = manifest.Decision,
            comparison = "no_active_claims",
        }));
        pinnedRead.Commit();

        var review = new PendingReview(
            manifest.ProjectId!, manifest.Branch!, manifest.RevisionSha!,
            manifest.ProposalRef!, snapshotSha, factSha, evidenceSha,
            manifest.Decision!);
        var source = new TrustedReviewSource(
            review.ProjectId, review.Branch, review.RevisionSha,
            review.ProposalRef, review.ReviewSnapshotSha256,
            fact, review.SourceEvidenceSha256, kind, "unrelated", null);
        var saved = RecordPending(review);
        StageSource(review, source, OperatorSourceOrigin);

        return new OperatorEvidenceImport(
            review.ProjectId, review.Branch, review.RevisionSha,
            review.ProposalRef, review.CanonicalFactSha256,
            review.ReviewSnapshotSha256, review.SourceEvidenceSha256,
            kind, fact, saved.RequestId, OperatorSourceOrigin, rows.Count,
            review.RequestedAction);
    }
}
