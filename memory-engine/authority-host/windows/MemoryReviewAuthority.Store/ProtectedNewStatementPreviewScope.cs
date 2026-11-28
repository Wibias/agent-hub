using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

public sealed record NewStatementPreviewScope(string ProjectId, string Branch, string RevisionSha, string PinSha256);

public sealed partial class ProtectedPendingReviewLedger
{
    public const string NewStatementScopeFile = "new-statement-preview-scope.json";
    private const string NewStatementScopePolicy = "agenthub-host-pinned-statement-preview-v1";

    private static NewStatementPreviewScope MakeNewStatementScope(string project, string branch, string revision)
    {
        if (project is null || !Regex.IsMatch(project, @"\Agithub\.com/[a-z0-9][a-z0-9_.-]{0,99}/[a-z0-9][a-z0-9_.-]{0,99}\z")
            || branch is not { Length: > 0 and <= 128 } || !Regex.IsMatch(branch, @"\A[A-Za-z0-9][A-Za-z0-9._/-]*\z")
            || branch.Contains("..", StringComparison.Ordinal) || branch.Contains("//", StringComparison.Ordinal)
            || branch.EndsWith("/", StringComparison.Ordinal) || branch.EndsWith(".", StringComparison.Ordinal)
            || branch.Split('/').Any(part => part.StartsWith(".", StringComparison.Ordinal)
                || part.EndsWith(".lock", StringComparison.OrdinalIgnoreCase))
            || revision is null || !Regex.IsMatch(revision, @"\A[0-9a-f]{40}\z"))
            throw new ArgumentException("new_statement_scope_invalid");
        return new(project, branch, revision, Hash(JsonSerializer.Serialize(new[] { NewStatementScopePolicy, project, branch, revision })));
    }

    private static void InitializeNewStatementScopeSchema(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS protected_new_statement_preview_scope (
                singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1),
                project_id TEXT NOT NULL,
                branch TEXT NOT NULL,
                revision_sha TEXT NOT NULL CHECK(length(revision_sha)=40),
                pin_sha256 TEXT NOT NULL UNIQUE CHECK(length(pin_sha256)=64),
                policy_version TEXT NOT NULL CHECK(policy_version='agenthub-host-pinned-statement-preview-v1')
            ) STRICT;
            CREATE TABLE IF NOT EXISTS protected_new_statement_scope_withdrawal (
                singleton INTEGER PRIMARY KEY NOT NULL REFERENCES protected_new_statement_preview_scope(singleton) CHECK(singleton=1)
            ) STRICT;
            CREATE TRIGGER IF NOT EXISTS deny_statement_scope_update
              BEFORE UPDATE ON protected_new_statement_preview_scope
              BEGIN SELECT RAISE(ABORT, 'statement_scope_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_statement_scope_delete
              BEFORE DELETE ON protected_new_statement_preview_scope
              BEGIN SELECT RAISE(ABORT, 'statement_scope_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_statement_scope_replace
              BEFORE INSERT ON protected_new_statement_preview_scope
              WHEN EXISTS (SELECT 1 FROM protected_new_statement_preview_scope)
              BEGIN SELECT RAISE(ABORT, 'statement_scope_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_statement_scope_withdrawal_update
              BEFORE UPDATE ON protected_new_statement_scope_withdrawal
              BEGIN SELECT RAISE(ABORT, 'statement_scope_withdrawal_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_statement_scope_withdrawal_delete
              BEFORE DELETE ON protected_new_statement_scope_withdrawal
              BEGIN SELECT RAISE(ABORT, 'statement_scope_withdrawal_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_statement_scope_withdrawal_replace
              BEFORE INSERT ON protected_new_statement_scope_withdrawal
              WHEN EXISTS (SELECT 1 FROM protected_new_statement_scope_withdrawal)
              BEGIN SELECT RAISE(ABORT, 'statement_scope_withdrawal_immutable'); END;
            """;
        cmd.ExecuteNonQuery();
    }

    /// <summary>
    /// Requires independently protected manifest and directory ownership.
    /// Pins preview scope only; does not authenticate Git identity or authorize publication.
    /// </summary>
    public NewStatementPreviewScope PinNewStatementPreviewScope()
    {
        EnsureOpen();
        var path = Path.Combine(_protectedDirectory, NewStatementScopeFile);
        var info = new FileInfo(path);
        if (!info.Exists || info.Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidOperationException("new_statement_scope_manifest_missing_or_unsafe");
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length is < 32 or > 4096)
            throw new InvalidOperationException("new_statement_scope_manifest_size");
        var bytes = new byte[checked((int)stream.Length)];
        stream.ReadExactly(bytes);
        using var json = JsonDocument.Parse(bytes);
        var root = json.RootElement;
        var fields = new[] { "protocol", "projectId", "branch", "revisionSha" };
        if (root.ValueKind != JsonValueKind.Object
            || !root.EnumerateObject().Select(x => x.Name).Order(StringComparer.Ordinal).SequenceEqual(fields.Order(StringComparer.Ordinal))
            || root.EnumerateObject().Any(x => x.Value.ValueKind != JsonValueKind.String)
            || root.GetProperty("protocol").GetString() != NewStatementScopePolicy)
            throw new InvalidOperationException("new_statement_scope_manifest_invalid");
        var pin = MakeNewStatementScope(root.GetProperty("projectId").GetString()!,
            root.GetProperty("branch").GetString()!, root.GetProperty("revisionSha").GetString()!);
        using var tx = _connection.BeginTransaction(deferred: false);
        using var cmd = _connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "SELECT COUNT(*) FROM protected_new_statement_preview_scope;";
        if (Convert.ToInt64(cmd.ExecuteScalar()) != 0)
        {
            if (RequireNewStatementScope(pin.ProjectId, pin.Branch, pin.RevisionSha, tx) != pin)
                throw new InvalidOperationException("new_statement_scope_conflict");
            tx.Commit();
            return pin;
        }
        cmd.CommandText = """
            INSERT INTO protected_new_statement_preview_scope
            (singleton,project_id,branch,revision_sha,pin_sha256,policy_version)
            VALUES(1,$project,$branch,$revision,$pin,$policy);
            """;
        cmd.Parameters.AddWithValue("$project", pin.ProjectId);
        cmd.Parameters.AddWithValue("$branch", pin.Branch);
        cmd.Parameters.AddWithValue("$revision", pin.RevisionSha);
        cmd.Parameters.AddWithValue("$pin", pin.PinSha256);
        cmd.Parameters.AddWithValue("$policy", NewStatementScopePolicy);
        if (cmd.ExecuteNonQuery() != 1) throw new InvalidOperationException("new_statement_scope_pin_failed");
        tx.Commit();
        return pin;
    }

    public void WithdrawNewStatementPreviewScope()
    {
        EnsureOpen();
        using var tx = _connection.BeginTransaction(deferred: false);
        using var cmd = _connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO protected_new_statement_scope_withdrawal(singleton)
            SELECT singleton FROM protected_new_statement_preview_scope
            WHERE NOT EXISTS (SELECT 1 FROM protected_new_statement_scope_withdrawal);
            """;
        cmd.ExecuteNonQuery();
        tx.Commit();
    }

    internal NewStatementPreviewScope RequireNewStatementScope(string project, string branch, string revision, SqliteTransaction? tx = null)
    {
        EnsureOpen();
        var expected = MakeNewStatementScope(project, branch, revision);
        using var cmd = _connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            SELECT p.project_id,p.branch,p.revision_sha,p.pin_sha256,p.policy_version
            FROM protected_new_statement_preview_scope p
            WHERE p.singleton=1 AND NOT EXISTS (SELECT 1 FROM protected_new_statement_scope_withdrawal);
            """;
        using var row = cmd.ExecuteReader();
        if (!row.Read() || row.GetString(0) != expected.ProjectId || row.GetString(1) != expected.Branch
            || row.GetString(2) != expected.RevisionSha || row.GetString(3) != expected.PinSha256
            || row.GetString(4) != NewStatementScopePolicy)
            throw new InvalidOperationException("new_statement_scope_not_pinned_or_withdrawn");
        return expected;
    }
}
