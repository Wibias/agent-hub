using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MemoryReviewAuthority.OperatorUi;

/// <summary>
/// An actual signed protected Claim and an ALREADY CONNECTED Windows recipient.
/// The recipient is a CI helper or CI MCP; it is NOT independently attested
/// as original Codex, nor safe from same-account process injection.
/// </summary>
internal sealed record CiOneShotOffer(
    string RequestId, string TicketId, string Challenge,
    string CredentialId, string ExpectedOrigin, DateTimeOffset ExpiresUtc,
    string ProjectId, string Branch, string RevisionSha, string ProposalRef,
    string PrincipalSid, string Query, string ClaimId, string Kind,
    string Value, string FactSha256, string SnapshotSha256,
    string ResultSetSha256, string Recipient, string Provenance,
    uint KernelRecipientPid, string RecipientSessionSha256,
    string RecipientProcessImagePath, ulong RecipientProcessCreatedFileTime,
    bool RecipientOsOriginAttested);

internal static partial class ProtectedOperatorService
{
    private const string CiOneShotRecipient =
        "CI ONLY: kernel-observed connected pipe, not verified Codex";

    internal static CiOneShotOffer BeginCiOneShotRead(
        string project, string branch, string proposalRef)
    {
        if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true"
            || Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows"
            || project != "github.com/example/operator-evidence"
            || branch != "main" || !Ref.IsMatch(proposalRef))
            throw new InvalidOperationException(
                "CI-Einmal-Empfänger außerhalb der synthetischen Testumgebung gesperrt");

        using var verified = Request("ci_read_begin", new
        {
            projectId = project, branch, proposalRef,
        });
        var r = verified.RootElement;
        if (!HasExactFields(r,
            "protocol","op","nonce","status","service_signed",
            "human_approval_verified","claim_written","read_released",
            "published_to_codex","request_id","ticket_id","challenge",
            "expires_utc","credential_id","expected_origin","principal_sid",
            "recipient_kernel_pid","recipient_session_sha256",
            "recipient_process_image","recipient_process_created_filetime",
            "recipient_os_origin_attested","query",
            "query_sha256","result_set_sha256","project_id","branch",
            "revision_sha","proposal_ref","claim_id","kind","value",
            "fact_sha256","snapshot_sha256","historical_source_origin",
            "provenance","recipient")
            || Str(r, "status") !=
                "ci_one_shot_exact_recipient_uv_challenge_no_release"
            || r.GetProperty("read_released").GetBoolean()
            || r.GetProperty("published_to_codex").GetBoolean()
            || r.GetProperty("claim_written").GetBoolean()
            || Str(r,"recipient") != CiOneShotRecipient
            || r.GetProperty("recipient_os_origin_attested").GetBoolean()
            || Str(r,"project_id") != project || Str(r,"branch") != branch
            || Str(r,"proposal_ref") != proposalRef
            || Str(r,"kind") is not ("knowledge" or "preference")
            || Str(r,"provenance") != "user_direct_reaffirmed_and_published_v1"
            || Str(r,"historical_source_origin") !=
                "operator_pinned_unverified_evidence_v1"
            || !Hex40.IsMatch(Str(r,"revision_sha"))
            || !Hex64.IsMatch(Str(r,"fact_sha256"))
            || !Hex64.IsMatch(Str(r,"snapshot_sha256"))
            || !Hex64.IsMatch(Str(r,"result_set_sha256"))
            || !Hex64.IsMatch(Str(r,"recipient_session_sha256"))
            || !Regex.IsMatch(Str(r,"request_id"),@"\A[0-9a-f]{48}\z")
            || !Regex.IsMatch(Str(r,"claim_id"),@"\AC~[0-9a-f]{24}\z")
            || !NativeWindowsWebAuthn.ValidPinnedLocalOrigin(
                Str(r,"expected_origin")))
            throw new InvalidOperationException(
                "Nicht vertrauenswürdiges, unvollständiges Einmal-Read-Angebot");

        var currentSid = WindowsIdentity.GetCurrent().User?.Value;
        if (string.IsNullOrWhiteSpace(currentSid)
            || Str(r,"principal_sid") != currentSid)
            throw new InvalidOperationException(
                "Operator- und Empfänger-Windows-Konto stimmen nicht überein");
        var pid = r.GetProperty("recipient_kernel_pid").GetUInt32();
        if (pid == 0 || pid > int.MaxValue)
            throw new InvalidOperationException("Kernel-Empfänger-PID ungültig");
        var observedImage=Str(r,"recipient_process_image");
        var creation=r.GetProperty("recipient_process_created_filetime").GetUInt64();
        if (!Path.IsPathFullyQualified(observedImage)
            || observedImage.Length>2048 || creation==0
            || observedImage.Contains('\n') || observedImage.Contains('\r'))
            throw new InvalidOperationException(
                "Kernel-Prozessherkunft nicht verifizierbar");
        var query = "exact-proposal:" + proposalRef;
        var expectedResult = new[]
        {
            Str(r,"claim_id"),project,branch,Str(r,"revision_sha"),
            proposalRef,Str(r,"snapshot_sha256"),Str(r,"fact_sha256"),
            Str(r,"kind"),Str(r,"value"),Str(r,"provenance"),
        };
        var hash=Convert.ToHexString(SHA256.HashData(
            JsonSerializer.SerializeToUtf8Bytes(expectedResult)))
            .ToLowerInvariant();
        var originalValue=Str(r,"value");
        if (originalValue.Length is < 1 or > 4000
            || hash != Str(r,"result_set_sha256")
            || Str(r,"query") != query
            || Convert.ToHexString(SHA256.HashData(
                Utf8.GetBytes(query))).ToLowerInvariant()
                != Str(r,"query_sha256")
            || Convert.ToHexString(SHA256.HashData(
                Utf8.GetBytes(originalValue))).ToLowerInvariant()
                != Str(r,"fact_sha256"))
            throw new InvalidOperationException(
                "Einmal-Read-Claim, Query oder Ergebnisfingerabdruck verändert");
        _ = Decode(Str(r,"ticket_id"),64);
        _ = Decode(Str(r,"credential_id"),1024);
        if (Decode(Str(r,"challenge"),64).Length != 32
            || !DateTimeOffset.TryParse(Str(r,"expires_utc"),out var expiry)
            || expiry <= DateTimeOffset.UtcNow
            || expiry > DateTimeOffset.UtcNow.AddMinutes(2))
            throw new InvalidOperationException("Einmal-Read-Challenge abgelaufen");
        return new CiOneShotOffer(
            Str(r,"request_id"),Str(r,"ticket_id"),Str(r,"challenge"),
            Str(r,"credential_id"),Str(r,"expected_origin"),expiry,
            project,branch,Str(r,"revision_sha"),proposalRef,
            currentSid,query,Str(r,"claim_id"),Str(r,"kind"),
            originalValue,Str(r,"fact_sha256"),Str(r,"snapshot_sha256"),
            hash,CiOneShotRecipient,Str(r,"provenance"),pid,
            Str(r,"recipient_session_sha256"),observedImage,creation,false);
    }

    internal static OperatorReceipt CompleteCiOneShotRead(
        string ticketId, NativeAssertion assertion)
    {
        if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true"
            || Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows")
            throw new InvalidOperationException("CI-Einmalfreigabe verweigert");
        _ = Decode(ticketId,64);
        using var verified = Request("ci_read_complete",new
        {
            ticketId,
            assertion = new
            {
                credentialId = assertion.CredentialId,
                type = assertion.Type,
                clientDataJSON = assertion.ClientDataJSON,
                authenticatorData = assertion.AuthenticatorData,
                signature = assertion.Signature,
            },
        });
        var r = verified.RootElement;
        if (!HasExactFields(r,
            "protocol","op","nonce","status","signature_verified",
            "service_signed","human_approval_verified","claim_written",
            "read_released","published_to_codex",
            "production_authorized","request_id")
            || Str(r,"status") !=
                "ci_exact_one_shot_delivered_no_production_authority"
            || !r.GetProperty("signature_verified").GetBoolean()
            || !r.GetProperty("read_released").GetBoolean()
            || r.GetProperty("human_approval_verified").GetBoolean()
            || r.GetProperty("claim_written").GetBoolean()
            || r.GetProperty("published_to_codex").GetBoolean()
            || r.GetProperty("production_authorized").GetBoolean()
            || !Regex.IsMatch(Str(r,"request_id"),@"\A[0-9a-f]{48}\z"))
            throw new InvalidOperationException(
                "Einmal-Read nicht zugestellt oder Bestätigung ungültig");
        return new OperatorReceipt(true,
            "CI-Einmal-Read-Sendung bestätigt, keine Produktionsfreigabe");
    }
}
