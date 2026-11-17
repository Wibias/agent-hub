using System.IO.Pipes;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using MemoryReviewAuthority.Core;
using MemoryReviewAuthority.Store;

namespace MemoryReviewAuthority.LabService;

/// <summary>
/// Restricted to the EXISTING administrator-only WebAuthn operator pipe.
/// A real protected Claim is visible to the sealed human UI *before* consent.
/// A valid consent is only a one-use intent receipt: no Codex/private reader
/// connection or memory read release is ever enabled by this lab path.
/// </summary>
internal sealed partial class OperatorWebAuthnPipe
{
    private readonly ReviewChallengeCore _readDisclosureCore = new();
    private ActiveReadDisclosure? _activeReadDisclosure;

    private sealed record ActiveReadDisclosure(
        ReadDisclosureTicket Ticket, string ClaimId, string ResultHash);

    private static string ReadHash(string text) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)))
            .ToLowerInvariant();

    // Fixed operator-preview destination, NOT an authenticated Codex session.
    internal const string ReadPreviewRecipient = "Sealed operator UI only; no Codex recipient";
    internal static readonly string ReadPreviewRecipientSha256 =
        ReadHash("agenthub-local-operator-ui-preview-no-codex-v1");

    private static string SnapshotHash(ProtectedOperatorDirectClaim claim) =>
        Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new[]
        {
            claim.ClaimId, claim.ProjectId, claim.Branch, claim.RevisionSha,
            claim.ProposalRef, claim.SnapshotSha256, claim.FactSha256,
            claim.Kind, claim.Value, claim.Provenance,
        }))).ToLowerInvariant();

    private static string? VerifiedPipePrincipalSid(NamedPipeServerStream pipe)
    {
        string? sid = null;
        pipe.RunAsClient(() =>
        {
            using var client = WindowsIdentity.GetCurrent(ifImpersonating: true);
            sid = client?.User?.Value;
        });
        return sid is not null && Regex.IsMatch(sid,
            @"\AS-1-5-21-(?:[0-9]+-){2,}[0-9]+\z",
            RegexOptions.CultureInvariant) ? sid : null;
    }

    private object? BeginReadDisclosure(
        JsonElement root, string nonce, NamedPipeServerStream? pipe)
    {
        if (pipe is null || !ExactKeys(root,
            "protocol", "op", "nonce", "projectId", "branch", "proposalRef"))
            return null;
        var project = Str(root, "projectId");
        var branch = Str(root, "branch");
        var proposal = Str(root, "proposalRef");
        if (project is null || branch is null || proposal is null
            || !Regex.IsMatch(project,
                @"\Agithub\.com/[a-z0-9][a-z0-9_.-]{0,99}/[a-z0-9][a-z0-9_.-]{0,99}\z")
            || branch.Length is < 1 or > 128
            || !Regex.IsMatch(proposal, @"\AE~[0-9a-f]{10}\z")
            || (_activeReadDisclosure is not null
                && _activeReadDisclosure.Ticket.ExpiresUtc > DateTimeOffset.UtcNow))
            return null;
        var native = _ledger.ReadOperatorCredential();
        if (native is null
            || native.EnrollmentState != ProtectedPendingReviewLedger.NativeEnrollmentState)
            return null;
        // It is critical that the actual Windows token, not any caller JSON
        // principal SID, is used for the purpose-bound challenge.
        var sid = VerifiedPipePrincipalSid(pipe);
        if (sid is null) return null;
        // All text comes from protected SQLite and its exact joins, never
        // from a caller-selected arbitrary file or user Memory SQLite.
        var claims = _ledger.ReadOperatorDirectClaims(project, branch, 100);
        var claim = claims.SingleOrDefault(c => c.ProposalRef == proposal);
        if (claim is null || claim.Kind is not ("knowledge" or "preference"))
            return null;
        var query = "exact-proposal:" + proposal;
        var resultHash = SnapshotHash(claim);
        var meaning = new ReadDisclosureMeaning(
            claim.ProjectId, claim.Branch, claim.RevisionSha, sid,
            Convert.ToHexString(RandomNumberGenerator.GetBytes(24))
                .ToLowerInvariant(),
            ReadHash(query), resultHash, ReadPreviewRecipientSha256);
        var ticket = _readDisclosureCore.BeginProtectedReadDisclosure(
            meaning, native.Credential);
        _activeReadDisclosure = new ActiveReadDisclosure(
            ticket, claim.ClaimId, resultHash);
        return new
        {
            protocol = Protocol, op = "read_begin", nonce,
            status = "protected_operator_read_preview_uv_challenge_no_release",
            service_signed = true,
            human_approval_verified = false,
            claim_written = false,
            read_released = false,
            published_to_codex = false,
            original_evidence_verified = false,
            request_id = meaning.RequestId,
            ticket_id = ticket.TicketId,
            challenge = ticket.ChallengeBase64Url,
            expires_utc = ticket.ExpiresUtc.ToString("O"),
            credential_id = native.Credential.CredentialIdBase64Url,
            expected_origin = native.Credential.ExpectedOrigin,
            principal_sid = sid,
            query, recipient = ReadPreviewRecipient,
            project_id = claim.ProjectId,
            branch = claim.Branch,
            revision_sha = claim.RevisionSha,
            proposal_ref = claim.ProposalRef,
            claim_id = claim.ClaimId,
            kind = claim.Kind, value = claim.Value,
            fact_sha256 = claim.FactSha256,
            snapshot_sha256 = claim.SnapshotSha256,
            result_set_sha256 = resultHash,
            query_sha256 = meaning.QuerySha256,
            recipient_session_sha256 = meaning.RecipientSessionSha256,
            provenance = claim.Provenance,
            historical_source_origin = claim.HistoricalSourceOrigin,
        };
    }

    private object? CompleteReadDisclosure(JsonElement root, string nonce)
    {
        // No possible success path for empty/malformed or replayed tickets.
        var active = _activeReadDisclosure;
        _activeReadDisclosure = null;
        if (active is null || !ExactKeys(root,
            "protocol", "op", "nonce", "ticketId", "assertion")
            || Str(root, "ticketId") != active.Ticket.TicketId
            || !root.TryGetProperty("assertion", out var assertion)
            || !ExactKeys(assertion, "credentialId", "type",
                "clientDataJSON", "authenticatorData", "signature"))
            return null;
        var item = new BrowserAssertion(
            Str(assertion, "credentialId") ?? "",
            Str(assertion, "type") ?? "",
            Str(assertion, "clientDataJSON") ?? "",
            Str(assertion, "authenticatorData") ?? "",
            Str(assertion, "signature") ?? "");
        // If the Claim changed (or protected store cannot read it), this is
        // not a permission. Its signed proof cannot override the source.
        var meaning = active.Ticket.Meaning;
        var claim = _ledger.ReadOperatorDirectClaims(
            meaning.ProjectId, meaning.Branch, 100)
            .SingleOrDefault(c => c.ClaimId == active.ClaimId);
        if (claim is null || SnapshotHash(claim) != active.ResultHash)
            return null;
        var result = _readDisclosureCore.VerifyProtectedReadDisclosureAndConsume(
            active.Ticket.TicketId, meaning, item);
        return new
        {
            protocol = Protocol, op = "read_complete", nonce,
            status = result.Status,
            signature_verified = result.Verified,
            service_signed = true,
            human_approval_verified = false,
            claim_written = false,
            read_released = false,
            published_to_codex = false,
            request_id = result.Verified ? meaning.RequestId : null,
            result_set_sha256 = meaning.ResultSetSha256,
        };
    }
}
