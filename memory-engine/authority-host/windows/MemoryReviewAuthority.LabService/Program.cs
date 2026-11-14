using MemoryReviewAuthority.Store;
using System.Security.Cryptography;
using System.Text;
using System.Security.Principal;
using System.ServiceProcess;

namespace MemoryReviewAuthority.LabService;

/// <summary>
/// The test service has NO IPC endpoint, network listener, credential store,
/// Memory database access, or Claim-write operation. Its only filesystem
/// write is a benign marker under a pre-provisioned service-SID lab ACL. The SCM identity is
/// checked before even constructing future authority state.
/// </summary>
internal static class ReviewHostIdentity
{
    internal const string ServiceName = "AgentHubMemoryReviewLab";
    private const string LocalServiceSid = "S-1-5-19";
    private const string ServiceSidPrefix = "S-1-5-80-";

    // Pure contract for negative tests. Not an override or operator setting.
    internal static bool IsExpectedIdentity(
        string? userSid, IEnumerable<string>? tokenGroupSids, string? expectedServiceSid)
        => string.Equals(userSid, LocalServiceSid, StringComparison.Ordinal)
           && expectedServiceSid is not null
           && expectedServiceSid.StartsWith(ServiceSidPrefix, StringComparison.Ordinal)
           && expectedServiceSid.Length > ServiceSidPrefix.Length
           && tokenGroupSids is not null
           && tokenGroupSids.Contains(expectedServiceSid, StringComparer.Ordinal);

    internal static bool IsCurrentScmIdentity()
    {
        if (!OperatingSystem.IsWindows()) return false;
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            // Resolving the exact hardcoded service name requires that SCM
            // actually installed it. A caller cannot substitute another SID.
            var serviceSid = ((SecurityIdentifier)new NTAccount(
                "NT SERVICE", ServiceName).Translate(typeof(SecurityIdentifier))).Value;
            var groups = identity.Groups?
                .OfType<SecurityIdentifier>()
                .Select(s => s.Value).ToArray() ?? [];
            return IsExpectedIdentity(identity.User?.Value, groups, serviceSid);
        }
        catch
        {
            return false;
        }
    }
}

internal sealed class ReviewAuthorityLabService : ServiceBase
{
    internal ReviewAuthorityLabService()
    {
        ServiceName = ReviewHostIdentity.ServiceName;
        CanStop = true;
        CanPauseAndContinue = false;
        AutoLog = false;
    }

    protected override void OnStart(string[] args)
    {
        // No non-service user, wrong LocalService token or wrong service SID
        // may activate the process. A failure reports service start failure.
        if (!ReviewHostIdentity.IsCurrentScmIdentity())
            throw new InvalidOperationException("memory_review_service_identity_denied");

        // The disposable SCM lab pre-provisions this state directory with
        // ONLY the exact service SID (Modify) and SYSTEM/Admin (FullControl).
        // This benign marker proves a real restricted LocalService process
        // can write through the service-SID ACL. No untrusted path input.
        var stateDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "AgentHubMemoryReviewLab-State");
        if (!Directory.Exists(stateDir))
            throw new InvalidOperationException("protected_lab_state_missing");
        File.WriteAllText(Path.Combine(stateDir, "service-started.txt"),
            "SERVICE_SID_STATE_WRITE_OK");

        // LAB-ONLY synthetic request. This separate database is never an
        // approved Claim and contains NO real user evidence. The protected
        // state directory was ACL-provisioned before SCM start.
        using (var ledger = ProtectedPendingReviewLedger.OpenInProtectedDirectory(stateDir))
        {
            static string Hash(string value) =>
                Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

            var pending = new PendingReview(
                "github.com/example/lab-fixture",
                "main",
                new string('a', 40),
                "E~0123456789",
                new string('b', 64),
                Hash("Synthetic non-authorizing lab fact"),
                Hash("Synthetic non-authorizing lab Evidence"),
                "confirm");
            var record = ledger.RecordPending(pending);
            var replay = ledger.RecordPending(pending);
            if (record != replay
                || record.Status != ProtectedPendingReviewLedger.PendingState
                || ledger.CountPending() != 1)
                throw new InvalidOperationException("protected_pending_review_ledger_failed");
            File.WriteAllText(Path.Combine(stateDir, "protected-ledger-ok.txt"),
                "PENDING_ONLY_NO_AUTHORIZATION");
        }

        // Still NO credentials, real WebAuthn challenge, pipe, HTTP server,
        // user Memory database, Claim mutation or agent endpoint.
    }

    protected override void OnStop()
    {
        // No persistent state or side effects.
    }
}

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--policy-selftest")
        {
            const string expected = "S-1-5-80-123456";
            Require(ReviewHostIdentity.IsExpectedIdentity(
                "S-1-5-19", [expected], expected));
            Require(!ReviewHostIdentity.IsExpectedIdentity(
                "S-1-5-21-1000", [expected], expected));
            Require(!ReviewHostIdentity.IsExpectedIdentity(
                "S-1-5-19", ["S-1-5-80-999"], expected));
            Require(!ReviewHostIdentity.IsExpectedIdentity(
                "S-1-5-19", [expected], "S-1-5-21-1000"));
            Require(!ReviewHostIdentity.IsExpectedIdentity(
                "S-1-5-19", null, expected));
            // GitHub Windows runner is not an actual LocalService SCM host.
            Require(!ReviewHostIdentity.IsCurrentScmIdentity());
            Console.WriteLine("MEMORY_REVIEW_SERVICE_POLICY PASS 6/6; NO_MEMORY_WRITES");
            return 0;
        }
        if (args.Length != 0)
        {
            Console.Error.WriteLine("Unsupported command. The lab host exposes no actions.");
            return 2;
        }
        if (!OperatingSystem.IsWindows())
            return 2;
        try
        {
            ServiceBase.Run(new ReviewAuthorityLabService());
            return 0;
        }
        catch
        {
            // Do not disclose service state, credentials or filesystem paths.
            return 3;
        }
    }

    private static void Require(bool condition)
    {
        if (!condition) throw new InvalidOperationException("service_identity_negative_test_failed");
    }
}
