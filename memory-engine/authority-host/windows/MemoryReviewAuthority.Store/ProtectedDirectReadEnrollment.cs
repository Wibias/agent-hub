using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// Append-only protected CI reader enrollment history. The only supported
/// generation is an initial synthetic-lab enrollment and its irrevocable
/// revocation. A restored policy file CANNOT re-enroll that lane, even after
/// a fresh LocalService process reads the same SQLite WAL.
/// Not an operator-account or production project enrollment authority.
/// </summary>
public sealed partial class ProtectedPendingReviewLedger
{
    public const string DirectReadCiPolicy = "agenthub-direct-read-enrollment-ledger-ci-v1";
    public const string AdminDirectReadCiLane = "admin-direct-ci";
    public const string UserDirectReadCiLane = "user-direct-ci";

    private sealed record DirectReadEvent(
        long Number, string Kind, string Digest, string PrincipalSid,
        string Project, string Branch, string Revision);

    private static void InitializeDirectReadEnrollmentSchema(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS protected_direct_read_enrollment_events (
                lane TEXT NOT NULL CHECK(lane IN ('admin-direct-ci','user-direct-ci')),
                event_number INTEGER NOT NULL CHECK(event_number IN (1,2)),
                event_kind TEXT NOT NULL CHECK(
                    (event_number=1 AND event_kind='enrolled') OR
                    (event_number=2 AND event_kind='revoked')),
                policy_sha256 TEXT NOT NULL CHECK(length(policy_sha256)=64),
                principal_sid TEXT NOT NULL,
                project_id TEXT NOT NULL,
                branch TEXT NOT NULL,
                revision_sha TEXT NOT NULL CHECK(length(revision_sha)=40),
                recorded_at_utc TEXT NOT NULL,
                policy_version TEXT NOT NULL CHECK(
                    policy_version='agenthub-direct-read-enrollment-ledger-ci-v1'),
                PRIMARY KEY(lane,event_number)
            ) STRICT;
            CREATE TRIGGER IF NOT EXISTS direct_read_enrollment_no_update
              BEFORE UPDATE ON protected_direct_read_enrollment_events
              BEGIN SELECT RAISE(ABORT,'direct_read_enrollment_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS direct_read_enrollment_no_delete
              BEFORE DELETE ON protected_direct_read_enrollment_events
              BEGIN SELECT RAISE(ABORT,'direct_read_enrollment_immutable'); END;
            """;
        cmd.ExecuteNonQuery();
    }

    private static void ValidateDirectReadLane(string lane)
    {
        if (lane is not (AdminDirectReadCiLane or UserDirectReadCiLane))
            throw new ArgumentException("direct_ci_unknown_lane");
    }

    private static bool ValidDirectReadPin(string? sha)
        => sha is not null && Regex.IsMatch(sha, @"\A[0-9a-f]{64}\z",
            RegexOptions.CultureInvariant);

    private static List<DirectReadEvent> LoadDirectReadEvents(
        SqliteConnection connection, string lane, SqliteTransaction? tx = null)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            SELECT event_number,event_kind,policy_sha256,principal_sid,
                   project_id,branch,revision_sha,policy_version
            FROM protected_direct_read_enrollment_events
            WHERE lane=$lane ORDER BY event_number;
            """;
        cmd.Parameters.AddWithValue("$lane", lane);
        using var reader = cmd.ExecuteReader();
        var events = new List<DirectReadEvent>();
        while (reader.Read())
        {
            if (reader.GetString(7) != DirectReadCiPolicy)
                throw new InvalidOperationException("direct_ci_ledger_bad_version");
            events.Add(new DirectReadEvent(reader.GetInt64(0),
                reader.GetString(1),reader.GetString(2),reader.GetString(3),
                reader.GetString(4),reader.GetString(5),reader.GetString(6)));
        }
        if (events.Count > 2
            || events.Count > 0 &&
                (events[0].Number != 1 || events[0].Kind != "enrolled")
            || events.Count == 2 &&
                (events[1].Number != 2 || events[1].Kind != "revoked"
                || events[0].Digest != events[1].Digest
                || events[0].PrincipalSid != events[1].PrincipalSid
                || events[0].Project != events[1].Project
                || events[0].Branch != events[1].Branch
                || events[0].Revision != events[1].Revision))
            throw new InvalidOperationException("direct_ci_ledger_corrupt_sequence");
        return events;
    }

    private void AppendDirectReadEvent(
        SqliteTransaction tx, string lane, long number, string kind,
        DirectReadEvent pin)
    {
        using var cmd = _connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO protected_direct_read_enrollment_events
              (lane,event_number,event_kind,policy_sha256,principal_sid,
               project_id,branch,revision_sha,recorded_at_utc,policy_version)
            VALUES ($lane,$number,$kind,$hash,$sid,$project,$branch,
                    $revision,$when,$version);
            """;
        cmd.Parameters.AddWithValue("$lane", lane);
        cmd.Parameters.AddWithValue("$number", number);
        cmd.Parameters.AddWithValue("$kind", kind);
        cmd.Parameters.AddWithValue("$hash", pin.Digest);
        cmd.Parameters.AddWithValue("$sid", pin.PrincipalSid);
        cmd.Parameters.AddWithValue("$project", pin.Project);
        cmd.Parameters.AddWithValue("$branch", pin.Branch);
        cmd.Parameters.AddWithValue("$revision", pin.Revision);
        cmd.Parameters.AddWithValue("$when", DateTimeOffset.UtcNow.ToString("O"));
        cmd.Parameters.AddWithValue("$version", DirectReadCiPolicy);
        if (cmd.ExecuteNonQuery() != 1)
            throw new InvalidOperationException("direct_ci_ledger_insert_failed");
    }

    /// <summary>
    /// Called only by the synthetic SCM host AFTER it validates its OS
    /// identity, service-SID-protected state, fixed project, exact native
    /// policy and signer. Never callable via the nonadmin pipe.
    /// There is NO re-enrollment API for this CI-only generation.
    /// </summary>
    public bool BindInitialDirectReadCiEnrollment(
        string lane, string policySha256, string principalSid,
        string project, string branch, string revisionSha)
    {
        EnsureOpen();
        ValidateDirectReadLane(lane);
        if (!ValidDirectReadPin(policySha256)
            || principalSid is null
            || !Regex.IsMatch(principalSid,
                @"\AS-1-5-21-(?:[0-9]+-){2,}[0-9]+\z")
            || project != "github.com/example/operator-evidence"
            || branch != "main"
            || !Regex.IsMatch(revisionSha ?? "",
                @"\A[0-9a-f]{40}\z"))
            throw new ArgumentException("direct_ci_enrollment_wrong_scope");
        using var tx = _connection.BeginTransaction(deferred: false);
        var rows = LoadDirectReadEvents(_connection, lane, tx);
        if (rows.Count == 0)
        {
            AppendDirectReadEvent(tx,lane,1,"enrolled",
                new DirectReadEvent(1,"enrolled",policySha256,principalSid,
                    project,branch,revisionSha!));
            tx.Commit();
            return true;
        }
        var first = rows[0];
        if (rows.Count != 1 || first.Digest != policySha256
            || first.PrincipalSid != principalSid || first.Project != project
            || first.Branch != branch || first.Revision != revisionSha)
            return false;
        tx.Commit();
        return true;
    }

    /// <summary>
    /// Startup reconciliation is mandatory even if the original CI policy
    /// file is absent. A disappeared/replaced active enrollment is converted
    /// to a durable revocation before the service can open a read pipe.
    /// </summary>
    public bool ReconcileDirectReadCiStartup(string lane, string? currentSha256)
    {
        EnsureOpen();
        ValidateDirectReadLane(lane);
        using var tx = _connection.BeginTransaction(deferred: false);
        var rows = LoadDirectReadEvents(_connection,lane,tx);
        if (rows.Count == 0)
            return ValidDirectReadPin(currentSha256); // first enrollment only
        if (rows.Count == 2)
            return false; // irrevocable across restarts
        if (rows[0].Digest == currentSha256)
            return true;
        AppendDirectReadEvent(tx,lane,2,"revoked",rows[0]);
        tx.Commit();
        return false;
    }

    public bool DirectReadCiEnrollmentActive(string lane, string policySha256)
    {
        EnsureOpen();
        ValidateDirectReadLane(lane);
        if (!ValidDirectReadPin(policySha256)) return false;
        var rows = LoadDirectReadEvents(_connection,lane);
        return rows.Count == 1
            && rows[0].Digest == policySha256;
    }

    /// <summary>
    /// Single protected SQLite transaction permanently revokes the CI lane.
    /// This only restricts access; no API can publish or reinstate a Claim.
    /// A successful return establishes a durable tombstone under synchronous
    /// FULL WAL. It cannot undo already emitted signed responses.
    /// </summary>
    public void RevokeDirectReadCiEnrollment(string lane, string policySha256)
    {
        EnsureOpen();
        ValidateDirectReadLane(lane);
        if (!ValidDirectReadPin(policySha256))
            throw new ArgumentException("direct_ci_revocation_bad_pin");
        using var tx = _connection.BeginTransaction(deferred: false);
        var rows = LoadDirectReadEvents(_connection,lane,tx);
        if (rows.Count == 0 || rows[0].Digest != policySha256)
            throw new InvalidOperationException("direct_ci_revocation_unrecognized");
        if (rows.Count == 1)
        {
            AppendDirectReadEvent(tx,lane,2,"revoked",rows[0]);
            tx.Commit();
        }
    }

    public string ReadDirectReadCiEnrollmentState(string lane)
    {
        EnsureOpen();
        ValidateDirectReadLane(lane);
        var rows = LoadDirectReadEvents(_connection,lane);
        return rows.Count switch
        {
            0 => "never_enrolled",
            1 => "enrolled_ci_only",
            2 => "revoked_durable_ci_only",
            _ => throw new InvalidOperationException("direct_ci_ledger_corrupt_sequence"),
        };
    }
}
