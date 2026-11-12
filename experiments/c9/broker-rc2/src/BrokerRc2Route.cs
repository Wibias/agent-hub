using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using AgentHub.C9.G2;
using AgentHub.C9.G3;
using AgentHub.C9.G345;

namespace AgentHub.LaneB;

// Authority is supplied only by a separately authenticated server-side bootstrap.
// The client wire frame contains only a length-prefixed ApprovalTicketV2.
internal sealed record VerifiedReviewAuthority(
    ReviewIntentWithoutTokenClaims Intent,
    TrustedKeySnapshot IssuerPublicKey,
    string ExpectedIssuer,
    string PreprovisionedG4JournalPath);

internal readonly record struct Rc2ReviewResult(
    string Reason, bool G2Verified, bool G3Verified, bool G5Bound,
    bool G4Reserved, bool CanExecuteCommit)
{
    internal static Rc2ReviewResult Deny(string reason) =>
        new(reason, false, false, false, false, false);

    internal byte[] WireResponse()
    {
        // RC2 has no apply/commit opcode and never emits a success-to-apply flag.
        var response = new {
            State = "NOT_COMMITTED", Applied = false, CanExecuteCommit = false,
            Reason, G2Verified, G3Verified, G5Bound, G4Reserved
        };
        return Encoding.UTF8.GetBytes(JsonSerializer.Serialize(response) + "\n");
    }
}

internal static class BrokerRc2Route
{
    // This is deliberately not a config parser and cannot trust the caller's
    // ticket, environment variables, or an adjacent local file as root authority.
    // Independent, authenticated issuer/checkpoint provisioning is still blocked.
    internal static VerifiedReviewAuthority? GetProductionAuthority() => null;

    // The only signed-ticket dispatch calls the already-positive-tested native
    // G2/G3/G4/G5 pipeline. The gate itself retains CI-only guards and returns
    // CanExecuteCommit=false for every outcome.
    internal static Rc2ReviewResult EvaluateConnected(
        SafeHandle pipe, VerifiedReviewAuthority? authority)
    {
        if (!OperatingSystem.IsWindows() || authority is null ||
            string.IsNullOrWhiteSpace(authority.PreprovisionedG4JournalPath) ||
            pipe is null || pipe.IsClosed || pipe.IsInvalid)
            return Rc2ReviewResult.Deny("RC2_INDEPENDENT_TRUST_OR_PIPE_UNAVAILABLE");
        try
        {
            using var journal = new G4NonceJournal(authority.PreprovisionedG4JournalPath);
            G2345PipeVerdict result = new G2345PipeReview(journal).EvaluateOneRead(
                pipe, authority.Intent, authority.IssuerPublicKey,
                authority.ExpectedIssuer, DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            // No production commit route, including after a full positive review.
            return new Rc2ReviewResult(result.Reason, result.G2KernelVerified,
                result.G3Verified, result.G5Bound, result.G4Reserved, false);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or
            InvalidOperationException or Win32Exception or ArgumentException)
        {
            return Rc2ReviewResult.Deny("RC2_AUTHORITY_LEDGER_OR_PIPE_DENIED");
        }
    }

    internal static bool IsForbiddenLegacyCommand(ReadOnlySpan<byte> frame) =>
        BrokerRequestRouter.IsLegacyApplyDenied(frame) ||
        frame.StartsWith("AHB2|LAB_COMMIT"u8) ||
        frame.StartsWith("AHB2|COMMIT"u8) || frame.StartsWith("AHB2|APPLY"u8);
}
