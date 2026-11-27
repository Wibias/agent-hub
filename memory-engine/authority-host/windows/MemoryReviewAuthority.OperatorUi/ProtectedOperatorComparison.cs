using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MemoryReviewAuthority.OperatorUi;

internal sealed record ComparisonClaim(string Ref, string ValueSha256, bool ExactDuplicate, string Value);
internal sealed record ComparisonOffer(string ProjectId, string Branch, string ProposalRef,
    string RevisionSha, string SnapshotSha256, string EvidenceSha256, string ComparisonSha256,
    string Decision, string Kind, string Fact, IReadOnlyList<ComparisonClaim> Claims);

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

    internal static ComparisonOffer ParseComparisonOffer(JsonElement r, string project, string branch, string proposalRef)
    {
        if (Str(r, "status") == "operator_comparison_preview_too_large")
            throw new InvalidOperationException("Comparison exceeds signed transport limit; no partial preview");
        if (!HasExactFields(r, "protocol", "op", "nonce", "status", "service_signed",
            "human_approval_verified", "claim_written", "meaning", "kind", "evidence_sha256",
            "comparison_sha256", "total", "claims")
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
            claims.Add(new ComparisonClaim(reference, hash, row.GetProperty("exact_duplicate").GetBoolean(), value));
        }
        return new ComparisonOffer(project, branch, proposalRef, Str(meaning, "revisionSha"),
            Str(meaning, "reviewSnapshotSha256"), Str(r, "evidence_sha256"), Str(r, "comparison_sha256"),
            Str(meaning, "decision"), Str(r, "kind"), fact, claims.AsReadOnly());
    }

    // Serialize each value as a quoted literal, so embedded newlines or
    // directional/control characters cannot masquerade as UI labels.
    internal static string FormatComparison(ComparisonOffer offer)
    {
        var display = new StringBuilder();
        display.AppendLine("SIGNED COMPARISON / READ ONLY / NO APPROVAL");
        display.AppendLine("Candidate: " + JsonSerializer.Serialize(offer.Fact));
        display.AppendLine();
        display.AppendLine("Complete active Claim comparison (" + offer.Claims.Count + "):");
        foreach (var row in offer.Claims)
        {
            display.AppendLine(row.Ref + (row.ExactDuplicate ? " [EXACT DUPLICATE]" : " [RELATION UNREVIEWED]"));
            display.AppendLine(JsonSerializer.Serialize(row.Value));
            display.AppendLine();
        }
        display.AppendLine("No conflict decision or Claim publication is enabled.");
        return display.ToString();
    }
}
