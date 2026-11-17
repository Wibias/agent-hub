using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// Deterministic NON-SECRET snapshot of the entire disposable one-shot CI
/// journal. Used only by the LocalService's separately protected registry
/// checkpoint, not by an untrusted Codex client.
/// </summary>
public sealed partial class ProtectedPendingReviewLedger
{
    public (string Sha256, int Receipts, bool Revoked) ReadCiOneShotFenceSnapshot()
    {
        EnsureOpen();
        var records = new List<string[]>();
        using (var cmd = _connection.CreateCommand())
        {
            cmd.CommandText = """
                SELECT request_id,project_id,branch,revision_sha,proposal_ref,
                  claim_id,result_set_sha256,query_sha256,principal_sid,kernel_pid,
                  recipient_session_sha256,expires_utc,created_utc,
                  COALESCE(consumed_utc,''),state,policy
                FROM protected_ci_read_once_receipts ORDER BY request_id;
                """;
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var record = new string[16];
                for (var i = 0; i < record.Length; i++)
                    record[i] = i == 9
                        ? reader.GetInt64(i).ToString(CultureInfo.InvariantCulture)
                        : reader.GetString(i);
                records.Add(record);
            }
        }
        var revocations = new List<string[]>();
        using (var cmd = _connection.CreateCommand())
        {
            cmd.CommandText = """
                SELECT lane,revoked_utc FROM protected_ci_read_once_revocations
                ORDER BY lane;
                """;
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
                revocations.Add([reader.GetString(0), reader.GetString(1)]);
        }
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new
        {
            policy = "agenthub-ci-read-once-registry-fence-snapshot-v1",
            receipts = records,
            revocations,
        });
        return (Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            records.Count, revocations.Count != 0);
    }
}
