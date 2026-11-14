using MemoryReviewAuthority.Store;
using System.Security.Cryptography;
using System.Text;
using System.Security.Principal;
using System.ServiceProcess;

namespace MemoryReviewAuthority.LabService;

/// <summary>
/// Disposable GitHub Actions lab host; NOT a production service. It exposes
/// only a signed read-only local named pipe serving one synthetic fixture
/// Claim. No approval/write IPC, network listener or user Memory DB access.
/// The SCM identity is checked before any protected state is opened.
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
    private ProtectedPendingReviewLedger? _ledger;
    private SignedProtectedClaimPipe? _readPipe;
    private OperatorWebAuthnPipe? _operatorProofPipe;

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

        // The only generated Claim is explicitly synthetic. An ephemeral test
        // key verifies the UV check path, never an actual human or Windows Hello
        // user. Neither user-writable canonical SQLite nor MCP is opened here.
        _ledger = ProtectedPendingReviewLedger.OpenInProtectedDirectory(stateDir);
        SyntheticLabClaim.Seed(_ledger);
        // A distinct REAL E~ pipeline input can be pinned by the elevated
        // operator into this service-owned directory. No input path, source
        // content, scope or action is accepted via the user-facing pipe.
        // Import is an UNAPPROVED pending review, not a Claim.
        if (File.Exists(Path.Combine(stateDir,
            ProtectedPendingReviewLedger.OperatorManifestFile)))
        {
            var imported = _ledger.ImportOperatorPinnedEvidence();
            if (imported.HumanApprovalVerified || imported.ClaimWritten
                || _ledger.ReadProtectedClaims(imported.ProjectId, imported.Branch).Count != 0)
                throw new InvalidOperationException("operator_import_unexpected_authority");
            File.WriteAllText(Path.Combine(stateDir, "operator-evidence-imported.txt"),
                "REAL_EVIDENCE_PENDING_NO_CLAIM");
        }
        // Optional, fixed-name administrator-pinned WebAuthn public key.
        // Staging does not establish a real identity or approve a Claim.
        // The lab never issues a browser credential or signs real approvals.
        if (File.Exists(Path.Combine(stateDir,
            ProtectedPendingReviewLedger.OperatorCredentialFile)))
        {
            var credential = _ledger.StageUnverifiedOperatorCredential();
            if (credential.CredentialRegistrationTrusted
                || credential.HumanApprovalVerified
                || credential.EnrollmentState !=
                    ProtectedPendingReviewLedger.OperatorCredentialState
                || _ledger.CountPending() < 1)
                throw new InvalidOperationException("operator_credential_unexpected_authority");
            File.WriteAllText(Path.Combine(stateDir, "operator-credential-pinned.txt"),
                "OPERATOR_CREDENTIAL_UNVERIFIED_NO_APPROVAL");
        }
        File.WriteAllText(Path.Combine(stateDir, "protected-ledger-ok.txt"),
            "SYNTHETIC_PROTECTED_CLAIM_NO_HUMAN_APPROVAL");

        _readPipe = new SignedProtectedClaimPipe(_ledger, stateDir);
        _readPipe.Start();
        if (_ledger.ReadOperatorCredential() is not null)
        {
            // Admin-ACL only. This is a NON-AUTHORIZING browser UV probe:
            // the only result is a signed "no-approval/no-Claim" receipt.
            // The existing read-only Codex pipe remains unchanged.
            _operatorProofPipe = new OperatorWebAuthnPipe(_ledger, stateDir);
            _operatorProofPipe.Start();
        }
    }

    protected override void OnStop()
    {
        _operatorProofPipe?.Dispose();
        _operatorProofPipe = null;
        _readPipe?.Dispose();
        _readPipe = null;
        _ledger?.Dispose();
        _ledger = null;
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
