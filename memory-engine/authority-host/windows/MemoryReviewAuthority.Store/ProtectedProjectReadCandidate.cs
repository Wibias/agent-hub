using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// A reviewable proposal for a REAL repository. Every field is untrusted
/// intake data. It is NOT a service-verified Git root, user consent,
/// verified process identity, or an authorization to read a Claim.
/// </summary>
public sealed record ProtectedProjectReadRequest(
    string ProjectId,
    string Branch,
    string RevisionSha,
    string PrincipalSid,
    string ProposedGitRootSha256,
    string ProposedSignerSha256);

public sealed record ProtectedProjectReadCandidate(
    string CandidateId,
    ProtectedProjectReadRequest Request,
    string State,
    string CreatedAtUtc);

/// <summary>
/// Versioned, service-owned, default-deny real-project intake. Only a
/// separate future native consent + process-attestation protocol can
/// produce an actual access grant. No caller of these methods can grant
/// read access by setting a flag, replaying a request or restoring JSON.
/// </summary>
public sealed partial class ProtectedPendingReviewLedger
{
    public const string ProjectReadIntakePolicy = "agenthub-project-read-intake-no-authority-v1";
    public const string ProjectReadPending = "pending_independent_authorization";
    public const string ProjectReadWithdrawn = "withdrawn_durable_no_authority";

    private static readonly Regex ProjectReadProjectPattern = new(
        @"\Agithub\.com/[a-z0-9][a-z0-9_.-]{0,99}/[a-z0-9][a-z0-9_.-]{0,99}\z",
        RegexOptions.CultureInvariant);
    private static readonly Regex ProjectReadBranchPattern = new(
        @"\A[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}\z",
        RegexOptions.CultureInvariant);
    private static readonly Regex ProjectReadSidPattern = new(
        @"\AS-1-5-21-(?:[0-9]+-){2,}[0-9]+\z",
        RegexOptions.CultureInvariant);
    private static readonly Regex ProjectReadSha256Pattern = new(
        @"\A[0-9a-f]{64}\z", RegexOptions.CultureInvariant);
    private static readonly Regex ProjectReadGitShaPattern = new(
        @"\A[0-9a-f]{40}\z", RegexOptions.CultureInvariant);

    private static void InitializeProjectReadIntakeSchema(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS protected_project_read_candidates (
                candidate_id TEXT PRIMARY KEY NOT NULL CHECK(length(candidate_id)=48),
                project_id TEXT NOT NULL,
                branch TEXT NOT NULL,
                revision_sha TEXT NOT NULL CHECK(length(revision_sha)=40),
                principal_sid TEXT NOT NULL,
                proposed_git_root_sha256 TEXT NOT NULL CHECK(length(proposed_git_root_sha256)=64),
                proposed_signer_sha256 TEXT NOT NULL CHECK(length(proposed_signer_sha256)=64),
                created_at_utc TEXT NOT NULL,
                policy_version TEXT NOT NULL CHECK(
                    policy_version='agenthub-project-read-intake-no-authority-v1'),
                UNIQUE(project_id, branch, revision_sha, principal_sid)
            ) STRICT;
            CREATE TABLE IF NOT EXISTS protected_project_read_withdrawals (
                candidate_id TEXT PRIMARY KEY NOT NULL
                    REFERENCES protected_project_read_candidates(candidate_id),
                reason TEXT NOT NULL CHECK(reason IN (
                    'operator_denied', 'scope_superseded', 'suspected_compromise')),
                recorded_at_utc TEXT NOT NULL,
                policy_version TEXT NOT NULL CHECK(
                    policy_version='agenthub-project-read-intake-no-authority-v1')
            ) STRICT;
            CREATE TRIGGER IF NOT EXISTS project_read_candidate_no_update
              BEFORE UPDATE ON protected_project_read_candidates
              BEGIN SELECT RAISE(ABORT, 'project_read_candidate_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS project_read_candidate_no_delete
              BEFORE DELETE ON protected_project_read_candidates
              BEGIN SELECT RAISE(ABORT, 'project_read_candidate_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS project_read_withdrawal_no_update
              BEFORE UPDATE ON protected_project_read_withdrawals
              BEGIN SELECT RAISE(ABORT, 'project_read_withdrawal_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS project_read_withdrawal_no_delete
              BEFORE DELETE ON protected_project_read_withdrawals
              BEGIN SELECT RAISE(ABORT, 'project_read_withdrawal_immutable'); END;
            """;
        cmd.ExecuteNonQuery();
    }

    private static void ValidateProjectReadRequest(ProtectedProjectReadRequest? request)
    {
        if (request is null
            || !ProjectReadProjectPattern.IsMatch(request.ProjectId ?? "")
            || !ProjectReadBranchPattern.IsMatch(request.Branch ?? "")
            || request.Branch.Contains("..", StringComparison.Ordinal)
            || request.Branch.Contains("//", StringComparison.Ordinal)
            || request.Branch.EndsWith("/", StringComparison.Ordinal)
            || request.Branch.EndsWith(".lock", StringComparison.OrdinalIgnoreCase)
            || !ProjectReadGitShaPattern.IsMatch(request.RevisionSha ?? "")
            || !ProjectReadSidPattern.IsMatch(request.PrincipalSid ?? "")
            || !ProjectReadSha256Pattern.IsMatch(request.ProposedGitRootSha256 ?? "")
            || !ProjectReadSha256Pattern.IsMatch(request.ProposedSignerSha256 ?? ""))
            throw new ArgumentException("project_read_intake_invalid_scope");
    }

    private ProtectedProjectReadCandidate? FindProjectReadCandidate(
        string projectId, string branch, string revisionSha, string sid,
        SqliteTransaction? tx)
    {
        using var cmd = _connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            SELECT c.candidate_id,c.project_id,c.branch,c.revision_sha,
                   c.principal_sid,c.proposed_git_root_sha256,
                   c.proposed_signer_sha256,c.created_at_utc,c.policy_version,
                   w.candidate_id
            FROM protected_project_read_candidates c
            LEFT JOIN protected_project_read_withdrawals w
              ON w.candidate_id=c.candidate_id
            WHERE c.project_id=$project AND c.branch=$branch
              AND c.revision_sha=$rev AND c.principal_sid=$sid;
            """;
        cmd.Parameters.AddWithValue("$project",projectId);
        cmd.Parameters.AddWithValue("$branch",branch);
        cmd.Parameters.AddWithValue("$rev",revisionSha);
        cmd.Parameters.AddWithValue("$sid",sid);
        using var reader = cmd.ExecuteReader();
        if (!reader.Read()) return null;
        if (reader.GetString(8) != ProjectReadIntakePolicy)
            throw new InvalidOperationException("project_read_candidate_bad_policy");
        return new ProtectedProjectReadCandidate(reader.GetString(0),
            new ProtectedProjectReadRequest(reader.GetString(1),
                reader.GetString(2),reader.GetString(3),
                reader.GetString(4),reader.GetString(5),reader.GetString(6)),
            reader.IsDBNull(9) ? ProjectReadPending : ProjectReadWithdrawn,
            reader.GetString(7));
    }

    /// <summary>
    /// Idempotently records a candidate, not a grant. The caller MUST NOT
    /// treat a proposed Git root / SID / signer hash as independently
    /// attested. A conflicting replacement is refused and no key bytes
    /// or Claim text are accepted or stored.
    /// </summary>
    public ProtectedProjectReadCandidate RecordProjectReadCandidate(
        ProtectedProjectReadRequest request)
    {
        EnsureOpen();
        ValidateProjectReadRequest(request);
        using var tx = _connection.BeginTransaction(deferred: false);
        var existing = FindProjectReadCandidate(request.ProjectId,request.Branch,
            request.RevisionSha,request.PrincipalSid,tx);
        if (existing is not null)
        {
            if (existing.Request != request
                || existing.State != ProjectReadPending)
                throw new InvalidOperationException(
                    "project_read_candidate_conflict_or_withdrawn");
            tx.Commit();
            return existing;
        }
        var candidate = new ProtectedProjectReadCandidate(
            Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant(),
            request, ProjectReadPending, DateTimeOffset.UtcNow.ToString("O"));
        using var write = _connection.CreateCommand();
        write.Transaction = tx;
        write.CommandText = """
            INSERT INTO protected_project_read_candidates (
                candidate_id,project_id,branch,revision_sha,principal_sid,
                proposed_git_root_sha256,proposed_signer_sha256,
                created_at_utc,policy_version)
            VALUES($id,$project,$branch,$rev,$sid,$root,$signer,$when,$policy);
            """;
        write.Parameters.AddWithValue("$id",candidate.CandidateId);
        write.Parameters.AddWithValue("$project",request.ProjectId);
        write.Parameters.AddWithValue("$branch",request.Branch);
        write.Parameters.AddWithValue("$rev",request.RevisionSha);
        write.Parameters.AddWithValue("$sid",request.PrincipalSid);
        write.Parameters.AddWithValue("$root",request.ProposedGitRootSha256);
        write.Parameters.AddWithValue("$signer",request.ProposedSignerSha256);
        write.Parameters.AddWithValue("$when",candidate.CreatedAtUtc);
        write.Parameters.AddWithValue("$policy",ProjectReadIntakePolicy);
        if (write.ExecuteNonQuery() != 1)
            throw new InvalidOperationException("project_read_candidate_insert_failed");
        tx.Commit();
        return candidate;
    }

    /// <summary>
    /// Irreversibly withdraws an intake candidate. There was never an
    /// access grant to revoke. Replaying or restoring a candidate cannot
    /// activate a private reader. The real access ledger must be separate.
    /// </summary>
    public void WithdrawProjectReadCandidate(
        ProtectedProjectReadRequest request, string reason)
    {
        EnsureOpen();
        ValidateProjectReadRequest(request);
        if (reason is not ("operator_denied" or "scope_superseded"
            or "suspected_compromise"))
            throw new ArgumentException("project_read_invalid_withdraw_reason");
        using var tx = _connection.BeginTransaction(deferred: false);
        var candidate = FindProjectReadCandidate(request.ProjectId,request.Branch,
            request.RevisionSha,request.PrincipalSid,tx);
        if (candidate is null || candidate.Request != request)
            throw new InvalidOperationException("project_read_unknown_candidate");
        if (candidate.State == ProjectReadWithdrawn)
        {
            tx.Commit();
            return;
        }
        using var write = _connection.CreateCommand();
        write.Transaction = tx;
        write.CommandText = """
            INSERT INTO protected_project_read_withdrawals (
                candidate_id,reason,recorded_at_utc,policy_version)
            VALUES($id,$reason,$when,$policy);
            """;
        write.Parameters.AddWithValue("$id",candidate.CandidateId);
        write.Parameters.AddWithValue("$reason",reason);
        write.Parameters.AddWithValue("$when",DateTimeOffset.UtcNow.ToString("O"));
        write.Parameters.AddWithValue("$policy",ProjectReadIntakePolicy);
        if (write.ExecuteNonQuery() != 1)
            throw new InvalidOperationException("project_read_withdraw_insert_failed");
        tx.Commit();
    }

    public ProtectedProjectReadCandidate? ReadProjectReadCandidate(
        ProtectedProjectReadRequest request)
    {
        EnsureOpen();
        ValidateProjectReadRequest(request);
        var item = FindProjectReadCandidate(request.ProjectId,request.Branch,
            request.RevisionSha,request.PrincipalSid,null);
        return item?.Request == request ? item : null;
    }
}
