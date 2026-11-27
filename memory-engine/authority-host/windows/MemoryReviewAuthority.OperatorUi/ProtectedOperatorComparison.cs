using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MemoryReviewAuthority.OperatorUi;

internal sealed record ComparisonClaim(string Ref, string ValueSha256, bool ExactDuplicate, string Value);
internal sealed record ComparisonOffer(string ProjectId, string Branch, string ProposalRef,
    string RevisionSha, string SnapshotSha256, string EvidenceSha256, string ComparisonSha256,
    string Decision, string Kind, string Fact, IReadOnlyList<ComparisonClaim> Claims, bool ConflictIntentAvailable, string ConflictIntentStatus);

internal sealed record ConflictChallenge(string TicketId, string Challenge, string CredentialId,
    string ExpectedOrigin, DateTimeOffset ExpiresUtc);

internal static partial class ProtectedOperatorService
{
    internal static ComparisonOffer InspectComparison(string project, string branch, string proposalRef)
    {
        if (!Scope.IsMatch(project) || branch.Length > 128 || !Scope.IsMatch(branch)
            || !Ref.IsMatch(proposalRef))
            throw new InvalidOperationException("Invalid comparison scope");
        using var signed = Request("comparison_inspect", new { projectId = project, branch, proposalRef });
        return ParseComparisonOffer(signed.RootElement, project, branch, proposalRef);
    }

    private static string ValueHash(string value)
        => Convert.ToHexString(SHA256.HashData(Utf8.GetBytes(value))).ToLowerInvariant();

    // Same normalization as the native Store comparison. Check the
    // signed duplicate label against the independently verified text.
    private static string NormalizeComparisonValue(string value)
        => Regex.Replace(value.Normalize(NormalizationForm.FormKC),
            @"[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+", " ").Trim(' ');

    internal static ComparisonOffer ParseComparisonOffer(JsonElement r, string project, string branch, string proposalRef)
    {
        if (Str(r, "status") == "operator_comparison_preview_too_large")
            throw new InvalidOperationException("Comparison exceeds signed transport limit; no partial preview");
        if (!HasExactFields(r, "protocol", "op", "nonce", "status", "service_signed",
            "human_approval_verified", "claim_written", "meaning", "kind", "evidence_sha256",
            "comparison_sha256", "total", "claims", "conflict_intent_available", "conflict_intent_status")
            || Str(r, "status") != "operator_comparison_preview_no_approval"
            || Str(r, "protocol") != Protocol || Str(r, "op") != "comparison_inspect"
            || !r.GetProperty("service_signed").GetBoolean()
            || r.GetProperty("human_approval_verified").GetBoolean()
            || r.GetProperty("claim_written").GetBoolean()
            || !ValidReviewKind(Str(r, "kind"))
            || !Hex64.IsMatch(Str(r, "evidence_sha256"))
            || !Hex64.IsMatch(Str(r, "comparison_sha256")))
            throw new InvalidOperationException("Invalid signed comparison offer");
        var meaning = r.GetProperty("meaning");
        ValidateExactOperatorMeaning(meaning, project, branch, proposalRef);
        var fact = Str(meaning, "canonicalFact");
        var list = r.GetProperty("claims");
        var count = r.GetProperty("total").GetInt32();
        if (count is < 1 or > 200 || list.ValueKind != JsonValueKind.Array || list.GetArrayLength() != count)
            throw new InvalidOperationException("Incomplete signed comparison");
        var normalizedFact = NormalizeComparisonValue(fact);
        var claims = new List<ComparisonClaim>();
        var refs = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in list.EnumerateArray())
        {
            if (!HasExactFields(row, "claim_ref", "value_sha256", "exact_duplicate", "value"))
                throw new InvalidOperationException("Invalid comparison row");
            var reference = Str(row, "claim_ref");
            var value = Str(row, "value");
            var hash = Str(row, "value_sha256");
            if (!Regex.IsMatch(reference, @"\A@[0-9a-f]{10}\z") || !refs.Add(reference)
                || value.Length > 65536 || ValueHash(value) != hash)
                throw new InvalidOperationException("Invalid comparison value or reference");
            var exactDuplicate = NormalizeComparisonValue(value) == normalizedFact;
            if (row.GetProperty("exact_duplicate").GetBoolean() != exactDuplicate)
                throw new InvalidOperationException("Inconsistent comparison duplicate label");
            claims.Add(new ComparisonClaim(reference, hash, exactDuplicate, value));
        }
        var intentAvailable = r.GetProperty("conflict_intent_available").GetBoolean();
        var intentStatus = Str(r,"conflict_intent_status");
        if (intentStatus is not ("not_recorded" or "recorded_exact_snapshot" or "recorded_different_snapshot")
            || (intentAvailable && intentStatus != "not_recorded")
            || (intentAvailable && Str(meaning,"decision") == "confirm" && claims.Any(c => c.ExactDuplicate)))
            throw new InvalidOperationException("Inconsistent conflict intent availability");
        return new ComparisonOffer(project, branch, proposalRef, Str(meaning, "revisionSha"),
            Str(meaning, "reviewSnapshotSha256"), Str(r, "evidence_sha256"), Str(r, "comparison_sha256"),
            Str(meaning, "decision"), Str(r, "kind"), fact, claims.AsReadOnly(),
            intentAvailable, intentStatus);
    }

    internal static ConflictChallenge BeginConflict(ComparisonOffer offer)
    {
        if (!offer.ConflictIntentAvailable) throw new InvalidOperationException("Conflict intent unavailable");
        using var signed = Request("conflict_begin",new {
            projectId=offer.ProjectId, branch=offer.Branch, proposalRef=offer.ProposalRef,
            snapshotSha256=offer.SnapshotSha256, comparisonSha256=offer.ComparisonSha256,
        });
        return ParseConflictChallenge(signed.RootElement,offer);
    }

    internal static ConflictChallenge ParseConflictChallenge(JsonElement r, ComparisonOffer offer)
    {
        if (!offer.ConflictIntentAvailable
            || !HasExactFields(r,"protocol","op","nonce","status","service_signed","human_approval_verified",
                "claim_written","canonical_freshness_verified","comparison_sha256","meaning",
                "ticket_id","challenge","expires_utc","credential_id","expected_origin")
            || Str(r,"status")!="conflict_review_challenge_no_claim"
            || Str(r,"protocol")!=Protocol || Str(r,"op")!="conflict_begin"
            || !r.GetProperty("service_signed").GetBoolean()
            || r.GetProperty("human_approval_verified").GetBoolean() || r.GetProperty("claim_written").GetBoolean()
            || r.GetProperty("canonical_freshness_verified").GetBoolean()
            || Str(r,"comparison_sha256")!=offer.ComparisonSha256)
            throw new InvalidOperationException("Invalid conflict challenge");
        var m=r.GetProperty("meaning");
        ValidateExactOperatorMeaning(m,offer.ProjectId,offer.Branch,offer.ProposalRef);
        if (Str(m,"revisionSha")!=offer.RevisionSha || Str(m,"reviewSnapshotSha256")!=offer.SnapshotSha256
            || Str(m,"decision")!=offer.Decision || Str(m,"canonicalFact")!=offer.Fact
            || (offer.Decision=="confirm" && offer.Claims.Any(c=>c.ExactDuplicate)))
            throw new InvalidOperationException("Conflict meaning changed");
        var origin=Str(r,"expected_origin");
        if (!Uri.TryCreate(origin,UriKind.Absolute,out var uri) || uri.Host!="localhost"
            || uri.Scheme!=Uri.UriSchemeHttp || uri.GetLeftPart(UriPartial.Authority)!=origin
            || Decode(Str(r,"ticket_id"),64).Length!=24 || Decode(Str(r,"challenge"),64).Length!=32
            || Decode(Str(r,"credential_id"),1024).Length==0
            || !DateTimeOffset.TryParse(Str(r,"expires_utc"),out var expires)
            || expires<=DateTimeOffset.UtcNow || expires>DateTimeOffset.UtcNow.AddMinutes(2))
            throw new InvalidOperationException("Invalid conflict challenge parameters");
        return new(Str(r,"ticket_id"),Str(r,"challenge"),Str(r,"credential_id"),origin,expires);
    }

    internal static bool CompleteConflict(ComparisonOffer offer, ConflictChallenge challenge, NativeAssertion assertion)
    {
        using var signed=Request("conflict_complete",new {
            ticketId=challenge.TicketId,
            assertion=new {credentialId=assertion.CredentialId,type=assertion.Type,
                clientDataJSON=assertion.ClientDataJSON,authenticatorData=assertion.AuthenticatorData,signature=assertion.Signature},
        });
        return ParseConflictReceipt(signed.RootElement,offer);
    }

    internal static bool ParseConflictReceipt(JsonElement r, ComparisonOffer offer)
    {
        if (!HasExactFields(r,"protocol","op","nonce","status","service_signed","human_approval_verified",
            "claim_written","canonical_freshness_verified","signature_verified","receipt")
            || Str(r,"protocol")!=Protocol || Str(r,"op")!="conflict_complete"
            || !r.GetProperty("service_signed").GetBoolean()
            || r.GetProperty("human_approval_verified").GetBoolean() || r.GetProperty("claim_written").GetBoolean()
            || r.GetProperty("canonical_freshness_verified").GetBoolean()
            || !r.GetProperty("signature_verified").GetBoolean()
            || Str(r,"status")!="conflict_review_intent_recorded_no_claim") return false;
        var receipt=r.GetProperty("receipt");
        return HasExactFields(receipt,"projectId","branch","proposalRef","snapshot_sha256","comparison_sha256","decision")
            && Str(receipt,"projectId")==offer.ProjectId && Str(receipt,"branch")==offer.Branch
            && Str(receipt,"proposalRef")==offer.ProposalRef && Str(receipt,"snapshot_sha256")==offer.SnapshotSha256
            && Str(receipt,"comparison_sha256")==offer.ComparisonSha256 && Str(receipt,"decision")==offer.Decision;
    }

    // Serialize each value as a quoted literal, so embedded newlines or
    // directional/control characters cannot masquerade as UI labels.
    internal static string FormatComparison(ComparisonOffer offer)
    {
        var display = new StringBuilder();
        display.AppendLine("SIGNED COMPARISON / READ ONLY / NO APPROVAL");
        display.AppendLine("Source: operator-pinned historical snapshot; original evidence UNVERIFIED.");
        display.AppendLine("Current canonical database freshness NOT verified.");
        display.AppendLine("Candidate: " + JsonSerializer.Serialize(offer.Fact));
        display.AppendLine();
        display.AppendLine("Complete active Claim comparison (" + offer.Claims.Count + "):");
        foreach (var row in offer.Claims)
        {
            display.AppendLine(row.Ref + (row.ExactDuplicate ? " [EXACT DUPLICATE]" : " [RELATION UNREVIEWED]"));
            display.AppendLine(JsonSerializer.Serialize(row.Value));
            display.AppendLine();
        }
        display.AppendLine(offer.ConflictIntentStatus switch
        {
            "recorded_exact_snapshot" => "Intent already recorded for this exact snapshot. No Claim.",
            "recorded_different_snapshot" => "Prior intent for different snapshot. New decision blocked. No Claim.",
            _ => "No recorded conflict intent for this proposal.",
        });
        display.AppendLine(offer.ConflictIntentAvailable
            ? "Existing native credential available. Review INTENT only; no Claim publication."
            : "No conflict decision or Claim publication is enabled.");
        return display.ToString();
    }
}
