using System.Security.Cryptography;
using System.Text.Json;
using AgentHub.C9.G3;
using AgentHub.C9.G5;

namespace AgentHub.C9.G345;

// The three token provenance flags are supplied by a test harness, NOT verified here
// against Windows access tokens. This gate cannot attest G2 or grant execution.
public sealed record ReviewObservation(
    string TrustedRoot, string RelativePath,
    string ReleaseSha256, string RequestId, string Operation, string TargetId,
    string PayloadSha256, string BrokerServiceSid, string ClientServiceSid,
    bool BrokerTokenChecked, bool ClientTokenChecked, bool ImpersonationReverted);

public readonly record struct ReviewDecision(
    string Reason, bool G3Verified, bool G5Bound, bool G4Reserved, bool CanExecuteCommit)
{
    public static ReviewDecision Deny(string reason, bool g3 = false, bool g5 = false,
        bool g4 = false) => new(reason, g3, g5, g4, false);
}

public sealed class ReviewGate(G4NonceJournal journal)
{
    // To prevent accidental use as a production write check, this path is CI-only.
    public ReviewDecision Evaluate(byte[]? ticketJson, ReviewObservation? observation,
        TrustedKeySnapshot? trusted, string expectedIssuer, long nowUnix)
    {
        if (!OperatingSystem.IsWindows() ||
            Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
            Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows" ||
            Environment.GetEnvironmentVariable("AGENTHUB_G345_REVIEW_ONLY") != "DISPOSABLE_WINDOWS_TEST")
            return ReviewDecision.Deny("G345_REVIEW_SCOPE_DENIED");
        if (ticketJson is null || ticketJson.Length is < 150 or > 4096 ||
            observation is null || trusted is null)
            return ReviewDecision.Deny("G345_MISSING_CONTEXT");

        ApprovalTicketV2? ticket;
        try { ticket = JsonSerializer.Deserialize<ApprovalTicketV2>(ticketJson); }
        catch (Exception e) when (e is JsonException or NotSupportedException)
        { return ReviewDecision.Deny("G345_TICKET_FORMAT_DENIED"); }
        if (ticket is null) return ReviewDecision.Deny("G345_TICKET_FORMAT_DENIED");

        // Preliminary signature/scope validation prevents unsigned tickets from
        // causing any target-file IO. These provisional file fields are untrusted.
        ObservedIntent provisional = new(observation.ReleaseSha256, observation.RequestId,
            observation.Operation, observation.TargetId, ticket.TargetVolumeId,
            ticket.TargetFileId, observation.PayloadSha256, ticket.PreimageSha256,
            observation.BrokerServiceSid, observation.ClientServiceSid,
            observation.BrokerTokenChecked, observation.ClientTokenChecked,
            observation.ImpersonationReverted);
        OfflineVerdict precheck = OfflineAuthorization.Verify(ticketJson, provisional,
            trusted, expectedIssuer, nowUnix);
        if (!precheck.SignatureAndScopeVerified || precheck.CanExecuteCommit)
            return ReviewDecision.Deny("G3_SIGNATURE_OR_SCOPE_DENIED");

        var pin = new ApprovedFilePin(ticket.TargetVolumeId, ticket.TargetFileId,
            ticket.PreimageSha256);
        G5OpenResult opened = HandleIdentity.OpenApprovedReadOnly(
            observation.TrustedRoot, observation.RelativePath, pin);
        using PinnedReadOnlyFile? retained = opened.File;
        if (!opened.Verdict.IdentityAndPreimageMatched || opened.Verdict.CanExecuteCommit ||
            retained is null)
            return ReviewDecision.Deny("G5_TARGET_HANDLE_DENIED", g3:true);

        FileProof proof = retained.OriginalProof;
        ObservedIntent observed = provisional with {
            TargetVolumeId = proof.VolumeId, TargetFileId = proof.FileId,
            PreimageSha256 = proof.PreimageSha256
        };
        OfflineVerdict verified = OfflineAuthorization.Verify(ticketJson, observed,
            trusted, expectedIssuer, nowUnix);
        if (!verified.SignatureAndScopeVerified || verified.CanExecuteCommit ||
            retained.RecheckPinned() is not {IdentityAndPreimageMatched:true, CanExecuteCommit:false})
            return ReviewDecision.Deny("G345_RECHECK_OR_G3_DENIED",g3:true);

        // Ticket fields have now been verified against the retained native handle.
        // G4 persists consumption BEFORE the only positive advisory review result.
        G4Claim claim = new(ticket.TicketId, ticket.RequestId, ticket.Nonce,
            Convert.ToHexString(SHA256.HashData(ticketJson)).ToLowerInvariant(),
            proof.VolumeId, proof.FileId, proof.PreimageSha256);
        G4ReservationVerdict reserved = journal.Reserve(claim);
        if (!reserved.Reserved || reserved.CanExecuteCommit)
            return ReviewDecision.Deny(reserved.Reason, g3:true, g5:true);
        if (retained.RecheckPinned() is not {IdentityAndPreimageMatched:true, CanExecuteCommit:false})
            return ReviewDecision.Deny("G5_AFTER_RESERVATION_DENIED",g3:true,g4:true);
        return new ReviewDecision("G345_LOCAL_REVIEW_RESERVED_ONLY",true,true,true,false);
    }
}
