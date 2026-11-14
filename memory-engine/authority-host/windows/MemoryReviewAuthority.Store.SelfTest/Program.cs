using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using MemoryReviewAuthority.Store;

internal static class Program
{
    private static int _passed;
    private static readonly PendingReview Example = new(
        "github.com/example/lab-fixture",
        "main",
        new string('a', 40),
        "E~0123456789",
        new string('b', 64),
        Hash("Synthetic fact"),
        Hash("Synthetic supporting evidence"),
        "confirm");

    private static void Main()
    {
        Run("pending_record_only", PendingOnly);
        Run("repeated_exact_request_idempotent", ExactReplay);
        Run("conflicting_action_refused", ConflictingAction);
        Run("changed_evidence_or_snapshot_refused", ChangedEvidence);
        Run("different_proposal_is_independent", DifferentProposal);
        Run("reopen_preserves_pending_not_authority", Reopen);
        Run("input_and_path_validation", Validation);
        Run("wal_and_no_claim_schema", WalAndNoClaimSchema);
        Console.WriteLine($"MEMORY_REVIEW_LEDGER PASS {_passed}/8; NO_APPROVAL NO_CLAIM_WRITES");
    }

    private static void Run(string label, Action test)
    {
        var dir = Path.Combine(Path.GetTempPath(),
            "AgentHubReviewStoreSynthetic-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            TestDirectory = dir;
            test();
            Interlocked.Increment(ref _passed);
            Console.WriteLine("PASS " + label);
        }
        finally
        {
            TestDirectory = string.Empty;
            Directory.Delete(dir, true);
        }
    }

    private static string TestDirectory = string.Empty;
    private static ProtectedPendingReviewLedger Open()
        => ProtectedPendingReviewLedger.OpenInProtectedDirectory(TestDirectory);

    private static void PendingOnly()
    {
        using var store = Open();
        var record = store.RecordPending(Example);
        Check(record.Status == ProtectedPendingReviewLedger.PendingState);
        Check(record.Review == Example);
        Check(!string.IsNullOrWhiteSpace(record.RequestId));
        Check(store.CountPending() == 1);
        Check(store.ReadPending(Example.ProjectId, Example.Branch, Example.ProposalRef)
            == record);
        Check(store.ReadPending(Example.ProjectId, "other", Example.ProposalRef) is null);
    }

    private static void ExactReplay()
    {
        using var store = Open();
        var first = store.RecordPending(Example);
        var second = store.RecordPending(Example);
        Check(first == second);
        Check(store.CountPending() == 1);
    }

    private static void ConflictingAction()
    {
        using var store = Open();
        var original = store.RecordPending(Example);
        Throws<InvalidOperationException>(() =>
            store.RecordPending(Example with { RequestedAction = "reject" }));
        Check(store.CountPending() == 1);
        Check(store.ReadPending(Example.ProjectId, Example.Branch, Example.ProposalRef)
            == original);
    }

    private static void ChangedEvidence()
    {
        using var store = Open();
        store.RecordPending(Example);
        Throws<InvalidOperationException>(() =>
            store.RecordPending(Example with { SourceEvidenceSha256 = new string('c', 64) }));
        Throws<InvalidOperationException>(() =>
            store.RecordPending(Example with { ReviewSnapshotSha256 = new string('d', 64) }));
        Check(store.CountPending() == 1);
    }

    private static void DifferentProposal()
    {
        using var store = Open();
        store.RecordPending(Example);
        var other = Example with { ProposalRef = "E~9876543210" };
        store.RecordPending(other);
        Check(store.CountPending() == 2);
        Check(store.ReadPending(other.ProjectId, other.Branch, other.ProposalRef)?.Review == other);
    }

    private static void Reopen()
    {
        PendingReviewRecord before;
        using (var first = Open())
            before = first.RecordPending(Example);
        using var second = Open();
        Check(second.RecordPending(Example) == before);
        Check(second.CountPending() == 1);
        Check(second.ReadPending(Example.ProjectId, Example.Branch, Example.ProposalRef) == before);
    }

    private static void Validation()
    {
        using var store = Open();
        Throws<ArgumentException>(() =>
            store.RecordPending(Example with { RevisionSha = "main" }));
        Throws<ArgumentException>(() =>
            store.RecordPending(Example with { ProposalRef = "~pbad" }));
        Throws<ArgumentException>(() =>
            store.RecordPending(Example with { RequestedAction = "approved" }));
        Throws<ArgumentException>(() =>
            store.RecordPending(Example with { ProjectId = "../escape" }));
        Check(store.CountPending() == 0);
        Throws<ArgumentException>(() =>
            ProtectedPendingReviewLedger.OpenInProtectedDirectory(
                Path.Combine(TestDirectory, "missing")));
    }

    private static void WalAndNoClaimSchema()
    {
        using (var store = Open())
        {
            store.RecordPending(Example);
            Check(store.CountPending() == 1);
        }
        var path = Path.Combine(TestDirectory, "review-authority.sqlite3");
        Check(File.Exists(path) && new FileInfo(path).Length > 0);
        using var connection = new SqliteConnection(
            new SqliteConnectionStringBuilder
            {
                DataSource = path,
                Mode = SqliteOpenMode.ReadOnly,
                Pooling = false,
            }.ToString());
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA journal_mode;";
        Check(string.Equals(command.ExecuteScalar()?.ToString(), "wal",
            StringComparison.OrdinalIgnoreCase));
        command.CommandText = "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='claims';";
        Check(Convert.ToInt32(command.ExecuteScalar()) == 0);
        command.CommandText = "SELECT COUNT(*) FROM review_requests WHERE status='awaiting_independent_host_authorization';";
        Check(Convert.ToInt32(command.ExecuteScalar()) == 1);
    }

    private static string Hash(string value)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private static void Check(bool pass)
    {
        if (!pass) throw new InvalidOperationException("synthetic_store_assertion_failed");
    }

    private static void Throws<T>(Action action) where T : Exception
    {
        try { action(); }
        catch (T) { return; }
        throw new InvalidOperationException("expected_" + typeof(T).Name);
    }
}
