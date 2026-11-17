using System.Globalization;
using System.Text.RegularExpressions;
using MemoryReviewAuthority.Core;
using Microsoft.Data.Sqlite;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// This table is a protected audit of fixed synthetic CI reads, not a
/// production authorization table or a general real-project read grant.
/// A request is irreversibly consumed in SQLite BEFORE private pipe I/O.
/// A committed pre-I/O consume means "no retry", NOT "delivery confirmed".
/// </summary>
public sealed partial class ProtectedPendingReviewLedger
{
    public const string CiOneShotProject = "github.com/example/operator-evidence";
    public const string CiOneShotBranch = "main";
    private const string CiOneShotLane = "synthetic_read_once_ci_v1";
    private const string CiOneShotPolicy = "agenthub-protected-ci-read-once-v1";
    private static readonly Regex CiHex48 = new(
        @"\A[a-f0-9]{48}\z", RegexOptions.CultureInvariant);
    private static readonly Regex CiHex64 = new(
        @"\A[a-f0-9]{64}\z", RegexOptions.CultureInvariant);
    private static readonly Regex CiHex40 = new(
        @"\A[a-f0-9]{40}\z", RegexOptions.CultureInvariant);
    private static readonly Regex CiClaimId = new(
        @"\AC~[a-f0-9]{24}\z", RegexOptions.CultureInvariant);
    private static readonly Regex CiProposal = new(
        @"\AE~[a-f0-9]{10}\z", RegexOptions.CultureInvariant);
    private static readonly Regex CiSid = new(
        @"\AS-1-5-21-(?:[0-9]+-){2,}[0-9]+\z", RegexOptions.CultureInvariant);

    private static void InitializeCiOneShotReceiptSchema(SqliteConnection connection)
    {
        using var cmd=connection.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS protected_ci_read_once_receipts (
                request_id TEXT PRIMARY KEY NOT NULL CHECK(length(request_id)=48),
                project_id TEXT NOT NULL CHECK(
                    project_id='github.com/example/operator-evidence'),
                branch TEXT NOT NULL CHECK(branch='main'),
                revision_sha TEXT NOT NULL CHECK(length(revision_sha)=40),
                proposal_ref TEXT NOT NULL,
                claim_id TEXT NOT NULL,
                result_set_sha256 TEXT NOT NULL CHECK(length(result_set_sha256)=64),
                query_sha256 TEXT NOT NULL CHECK(length(query_sha256)=64),
                principal_sid TEXT NOT NULL,
                kernel_pid INTEGER NOT NULL CHECK(kernel_pid>0),
                recipient_session_sha256 TEXT UNIQUE NOT NULL
                    CHECK(length(recipient_session_sha256)=64),
                expires_utc TEXT NOT NULL,
                created_utc TEXT NOT NULL,
                consumed_utc TEXT,
                state TEXT NOT NULL CHECK(
                    state IN ('reserved','consumed_pre_io','aborted')),
                policy TEXT NOT NULL CHECK(
                    policy='agenthub-protected-ci-read-once-v1')
            ) STRICT;
            CREATE TRIGGER IF NOT EXISTS deny_ci_read_receipt_delete
                BEFORE DELETE ON protected_ci_read_once_receipts
                BEGIN SELECT RAISE(ABORT,'protected_ci_read_receipt_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_ci_read_receipt_rewrite
                BEFORE UPDATE ON protected_ci_read_once_receipts
                WHEN OLD.state!='reserved'
                    OR NEW.state NOT IN ('aborted','consumed_pre_io')
                    OR NEW.request_id!=OLD.request_id
                    OR NEW.project_id!=OLD.project_id
                    OR NEW.branch!=OLD.branch
                    OR NEW.revision_sha!=OLD.revision_sha
                    OR NEW.proposal_ref!=OLD.proposal_ref
                    OR NEW.claim_id!=OLD.claim_id
                    OR NEW.result_set_sha256!=OLD.result_set_sha256
                    OR NEW.query_sha256!=OLD.query_sha256
                    OR NEW.principal_sid!=OLD.principal_sid
                    OR NEW.kernel_pid!=OLD.kernel_pid
                    OR NEW.recipient_session_sha256!=OLD.recipient_session_sha256
                    OR NEW.expires_utc!=OLD.expires_utc
                    OR NEW.created_utc!=OLD.created_utc
                    OR NEW.policy!=OLD.policy
                    OR NEW.consumed_utc IS NULL
                BEGIN SELECT RAISE(ABORT,'protected_ci_read_receipt_immutable'); END;
            CREATE TABLE IF NOT EXISTS protected_ci_read_once_revocations (
                lane TEXT PRIMARY KEY NOT NULL CHECK(
                    lane='synthetic_read_once_ci_v1'),
                revoked_utc TEXT NOT NULL
            ) STRICT;
            CREATE TRIGGER IF NOT EXISTS deny_ci_read_revocation_delete
                BEFORE DELETE ON protected_ci_read_once_revocations
                BEGIN SELECT RAISE(ABORT,'protected_ci_read_revocation_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_ci_read_revocation_update
                BEFORE UPDATE ON protected_ci_read_once_revocations
                BEGIN SELECT RAISE(ABORT,'protected_ci_read_revocation_immutable'); END;
            """;
        cmd.ExecuteNonQuery();
    }

    private static void ValidateCiOneShotReceipt(
        ReadDisclosureMeaning meaning,string claimId,uint kernelPid,
        DateTimeOffset expiresUtc)
    {
        if (meaning is null
            || meaning.ProjectId!=CiOneShotProject
            || meaning.Branch!=CiOneShotBranch
            || !CiHex40.IsMatch(meaning.RevisionSha??"")
            || !CiHex48.IsMatch(meaning.RequestId??"")
            || !CiHex64.IsMatch(meaning.ResultSetSha256??"")
            || !CiHex64.IsMatch(meaning.QuerySha256??"")
            || !CiHex64.IsMatch(meaning.RecipientSessionSha256??"")
            || !CiSid.IsMatch(meaning.PrincipalSid??"")
            || !CiClaimId.IsMatch(claimId??"")
            || kernelPid==0
            || expiresUtc<=DateTimeOffset.UtcNow
            || expiresUtc>DateTimeOffset.UtcNow.AddMinutes(3))
            throw new ArgumentException("ci_read_once_receipt_invalid");
    }

    private bool CiOneShotRevoked(SqliteTransaction? tx)
    {
        using var cmd=_connection.CreateCommand();
        cmd.Transaction=tx;
        cmd.CommandText="SELECT COUNT(*) FROM protected_ci_read_once_revocations WHERE lane=$lane;";
        cmd.Parameters.AddWithValue("$lane",CiOneShotLane);
        return Convert.ToInt32(cmd.ExecuteScalar(),CultureInfo.InvariantCulture)>0;
    }

    /// <summary>
    /// Protected reservation. The operator service must independently select
    /// the Claim and observe the real pipe; this table does not do either.
    /// </summary>
    public bool ReserveCiOneShot(
        ReadDisclosureMeaning meaning,string claimId,
        string proposalRef,uint kernelPid,DateTimeOffset expiresUtc)
    {
        EnsureOpen();
        ValidateCiOneShotReceipt(meaning,claimId,kernelPid,expiresUtc);
        if(!CiProposal.IsMatch(proposalRef??""))
            throw new ArgumentException("ci_read_once_proposal_invalid");
        using var tx=_connection.BeginTransaction(deferred:false);
        if(CiOneShotRevoked(tx))return false;
        using var insert=_connection.CreateCommand();
        insert.Transaction=tx;
        insert.CommandText="""
            INSERT INTO protected_ci_read_once_receipts (
                request_id,project_id,branch,revision_sha,proposal_ref,
                claim_id,result_set_sha256,query_sha256,principal_sid,
                kernel_pid,recipient_session_sha256,expires_utc,created_utc,
                consumed_utc,state,policy
            ) VALUES(
                $request,$project,$branch,$revision,$proposal,$claim,$result,
                $query,$sid,$pid,$recipient,$expires,$created,NULL,'reserved',$policy
            );
            """;
        insert.Parameters.AddWithValue("$request",meaning.RequestId);
        insert.Parameters.AddWithValue("$project",meaning.ProjectId);
        insert.Parameters.AddWithValue("$branch",meaning.Branch);
        insert.Parameters.AddWithValue("$revision",meaning.RevisionSha);
        insert.Parameters.AddWithValue("$proposal",proposalRef);
        insert.Parameters.AddWithValue("$claim",claimId);
        insert.Parameters.AddWithValue("$result",meaning.ResultSetSha256);
        insert.Parameters.AddWithValue("$query",meaning.QuerySha256);
        insert.Parameters.AddWithValue("$sid",meaning.PrincipalSid);
        insert.Parameters.AddWithValue("$pid",checked((long)kernelPid));
        insert.Parameters.AddWithValue("$recipient",meaning.RecipientSessionSha256);
        insert.Parameters.AddWithValue("$expires",expiresUtc.ToUniversalTime().ToString("O"));
        insert.Parameters.AddWithValue("$created",DateTimeOffset.UtcNow.ToString("O"));
        insert.Parameters.AddWithValue("$policy",CiOneShotPolicy);
        try
        {
            if(insert.ExecuteNonQuery()!=1)return false;
        }
        catch(SqliteException error) when(error.SqliteErrorCode==19)
        {
            return false; // repeated request/recipient: no grant or overwrite
        }
        tx.Commit();
        return true;
    }

    /// <summary>
    /// Irreversibly consume a reservation in FULL-WAL BEFORE transmission.
    /// Even if the network/pipe write later fails, the request is spent.
    /// This is not an assertion that the receiver actually got the bytes.
    /// </summary>
    public bool ConsumeCiOneShotBeforeIo(
        ReadDisclosureMeaning meaning,string claimId,string proposalRef,
        uint kernelPid)
    {
        EnsureOpen();
        if(meaning is null || !CiHex48.IsMatch(meaning.RequestId??""))
            return false;
        using var tx=_connection.BeginTransaction(deferred:false);
        if(CiOneShotRevoked(tx))return false;
        using var check=_connection.CreateCommand();
        check.Transaction=tx;
        check.CommandText="""
            SELECT expires_utc FROM protected_ci_read_once_receipts
            WHERE request_id=$request AND project_id=$project AND branch=$branch
                AND revision_sha=$revision AND proposal_ref=$proposal
                AND claim_id=$claim AND result_set_sha256=$result
                AND query_sha256=$query AND principal_sid=$sid
                AND kernel_pid=$pid AND recipient_session_sha256=$recipient
                AND state='reserved' AND policy=$policy;
            """;
        check.Parameters.AddWithValue("$request",meaning.RequestId);
        check.Parameters.AddWithValue("$project",meaning.ProjectId);
        check.Parameters.AddWithValue("$branch",meaning.Branch);
        check.Parameters.AddWithValue("$revision",meaning.RevisionSha);
        check.Parameters.AddWithValue("$proposal",proposalRef);
        check.Parameters.AddWithValue("$claim",claimId);
        check.Parameters.AddWithValue("$result",meaning.ResultSetSha256);
        check.Parameters.AddWithValue("$query",meaning.QuerySha256);
        check.Parameters.AddWithValue("$sid",meaning.PrincipalSid);
        check.Parameters.AddWithValue("$pid",checked((long)kernelPid));
        check.Parameters.AddWithValue("$recipient",meaning.RecipientSessionSha256);
        check.Parameters.AddWithValue("$policy",CiOneShotPolicy);
        var expires=check.ExecuteScalar() as string;
        if(expires is null
            || !DateTimeOffset.TryParse(expires,CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,out var deadline)
            || deadline<=DateTimeOffset.UtcNow)
            return false;
        using var consume=_connection.CreateCommand();
        consume.Transaction=tx;
        consume.CommandText="""
            UPDATE protected_ci_read_once_receipts
            SET state='consumed_pre_io',consumed_utc=$now
            WHERE request_id=$request AND state='reserved';
            """;
        consume.Parameters.AddWithValue("$now",DateTimeOffset.UtcNow.ToString("O"));
        consume.Parameters.AddWithValue("$request",meaning.RequestId);
        if(consume.ExecuteNonQuery()!=1)return false;
        tx.Commit();
        return true;
    }

    public bool AbortCiOneShot(string requestId)
    {
        EnsureOpen();
        if(!CiHex48.IsMatch(requestId??""))return false;
        using var tx=_connection.BeginTransaction(deferred:false);
        using var command=_connection.CreateCommand();
        command.Transaction=tx;
        command.CommandText="""
            UPDATE protected_ci_read_once_receipts
            SET state='aborted',consumed_utc=$now
            WHERE request_id=$request AND state='reserved';
            """;
        command.Parameters.AddWithValue("$now",DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$request",requestId);
        var changed=command.ExecuteNonQuery()==1;
        tx.Commit();
        return changed;
    }

    /// <summary>
    /// Durable deny-only action. An administrator may revoke without a
    /// positive UV: revocation never creates, promotes or releases a Claim.
    /// </summary>
    public bool RevokeCiOneShot()
    {
        EnsureOpen();
        using var tx=_connection.BeginTransaction(deferred:false);
        using var revoke=_connection.CreateCommand();
        revoke.Transaction=tx;
        revoke.CommandText="""
            INSERT OR IGNORE INTO protected_ci_read_once_revocations(lane,revoked_utc)
            VALUES ($lane,$now);
            """;
        revoke.Parameters.AddWithValue("$lane",CiOneShotLane);
        revoke.Parameters.AddWithValue("$now",DateTimeOffset.UtcNow.ToString("O"));
        var inserted=revoke.ExecuteNonQuery()==1;
        using var deny=_connection.CreateCommand();
        deny.Transaction=tx;
        deny.CommandText="""
            UPDATE protected_ci_read_once_receipts
            SET state='aborted',consumed_utc=$now
            WHERE state='reserved';
            """;
        deny.Parameters.AddWithValue("$now",DateTimeOffset.UtcNow.ToString("O"));
        deny.ExecuteNonQuery();
        tx.Commit();
        return inserted;
    }

    public string ReadCiOneShotState(string requestId)
    {
        EnsureOpen();
        if(!CiHex48.IsMatch(requestId??""))return "not_found";
        using var cmd=_connection.CreateCommand();
        cmd.CommandText="""
            SELECT state FROM protected_ci_read_once_receipts
            WHERE request_id=$id AND policy=$policy;
            """;
        cmd.Parameters.AddWithValue("$id",requestId);
        cmd.Parameters.AddWithValue("$policy",CiOneShotPolicy);
        return cmd.ExecuteScalar()?.ToString()??"not_found";
    }

    public bool IsCiOneShotRevoked()
    {
        EnsureOpen();
        return CiOneShotRevoked(null);
    }
}
