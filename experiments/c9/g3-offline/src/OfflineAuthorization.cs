using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AgentHub.C9.G3;

// Pure, offline verifier. Deliberately has no IO, issuer/signing API, or commit capability.
// Caller-supplied observed identities are NOT proof of Windows authentication.
public sealed record ApprovalTicketV2(
    int Version, string Issuer, string KeyId, string ReleaseSha256,
    string TicketId, string RequestId, string Nonce, string Operation, string TargetId,
    string TargetVolumeId, string TargetFileId, string PayloadSha256, string PreimageSha256,
    string BrokerServiceSid, string ClientServiceSid, long NotBeforeUnix, long ExpiresUnix,
    string SignatureBase64);

public sealed record ObservedIntent(
    string ReleaseSha256, string RequestId, string Operation, string TargetId,
    string TargetVolumeId, string TargetFileId, string PayloadSha256, string PreimageSha256,
    string BrokerServiceSid, string ClientServiceSid,
    bool BrokerTokenChecked, bool ClientTokenChecked, bool ImpersonationReverted);

// The pin MUST be supplied by a separately protected and independently reviewed bootstrap.
// A pin read from the ticket, its directory, or any client-writable file is not trusted.
public sealed record TrustedKeySnapshot(
    string KeyId, byte[] PublicKeySpkiDer, string ExpectedSpkiSha256, bool Revoked);

public readonly record struct OfflineVerdict(
    string Reason, bool SignatureAndScopeVerified, bool CanExecuteCommit)
{
    public static OfflineVerdict Deny(string reason) => new(reason, false, false);
}

public static class OfflineAuthorization
{
    private static readonly HashSet<string> Fields = new(StringComparer.Ordinal) {
        "Version", "Issuer", "KeyId", "ReleaseSha256", "TicketId", "RequestId", "Nonce",
        "Operation", "TargetId", "TargetVolumeId", "TargetFileId", "PayloadSha256",
        "PreimageSha256", "BrokerServiceSid", "ClientServiceSid", "NotBeforeUnix",
        "ExpiresUnix", "SignatureBase64"
    };
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow
    };

    private static bool Hex(string? s, int length)
    {
        if (s is null || s.Length != length) return false;
        foreach (char c in s) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        return true;
    }

    private static bool Identifier(string? s, int maxLength)
    {
        if (string.IsNullOrEmpty(s) || s.Length > maxLength) return false;
        foreach (char c in s)
            if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                (c >= '0' && c <= '9') || c is '-' or '_' or '.')) return false;
        return true;
    }

    private static bool Sid(string? s)
    {
        if (s is null || s.Length is < 9 or > 180 || !s.StartsWith("S-1-5-", StringComparison.Ordinal)) return false;
        foreach (char c in s) if (!(c is >= '0' and <= '9' or '-')) return false;
        return true;
    }

    private static ApprovalTicketV2? ParseStrict(ReadOnlySpan<byte> json)
    {
        if (json.Length is < 150 or > 4096) return null;
        using JsonDocument doc = JsonDocument.Parse(json.ToArray(), new JsonDocumentOptions {
            AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 3
        });
        if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (JsonProperty p in doc.RootElement.EnumerateObject())
        {
            if (!Fields.Contains(p.Name) || !seen.Add(p.Name)) return null;
            if (p.Name is "Version" or "NotBeforeUnix" or "ExpiresUnix")
            {
                if (p.Value.ValueKind != JsonValueKind.Number || !p.Value.TryGetInt64(out _)) return null;
            }
            else if (p.Value.ValueKind != JsonValueKind.String) return null;
        }
        if (seen.Count != Fields.Count) return null;
        return JsonSerializer.Deserialize<ApprovalTicketV2>(json, JsonOptions);
    }

    // Signing input is fixed-order ASCII, domain-separated and terminated with LF.
    // Only call on grammar-validated tickets. This method does NOT authorize execution.
    public static byte[] CanonicalBytes(ApprovalTicketV2 t)
    {
        string[] f = {
            "agenthub-c9-approval-v2", t.Version.ToString(CultureInfo.InvariantCulture),
            t.Issuer, t.KeyId, t.ReleaseSha256, t.TicketId, t.RequestId, t.Nonce,
            t.Operation, t.TargetId, t.TargetVolumeId, t.TargetFileId,
            t.PayloadSha256, t.PreimageSha256, t.BrokerServiceSid, t.ClientServiceSid,
            t.NotBeforeUnix.ToString(CultureInfo.InvariantCulture),
            t.ExpiresUnix.ToString(CultureInfo.InvariantCulture)
        };
        return Encoding.ASCII.GetBytes(string.Join("\n", f) + "\n");
    }

    public static OfflineVerdict Verify(
        ReadOnlySpan<byte> approvalJson, ObservedIntent? observed,
        TrustedKeySnapshot? trusted, string expectedIssuer, long nowUnix)
    {
        // A positive result attests only the supplied cryptographic and context data.
        // Replay, file-handle identity, real token provenance, and trust bootstrap are external.
        if (observed is null || trusted is null) return OfflineVerdict.Deny("MISSING_TRUST_OR_CONTEXT");
        if (!observed.BrokerTokenChecked || !observed.ClientTokenChecked || !observed.ImpersonationReverted)
            return OfflineVerdict.Deny("TOKEN_PROOF_REQUIRED");
        if (trusted.Revoked) return OfflineVerdict.Deny("KEY_REVOKED");
        if (!Identifier(expectedIssuer, 80) || !Identifier(trusted.KeyId, 80) ||
            !Hex(trusted.ExpectedSpkiSha256, 64) || trusted.PublicKeySpkiDer is null ||
            trusted.PublicKeySpkiDer.Length is < 60 or > 256)
            return OfflineVerdict.Deny("TRUST_BOOTSTRAP_INVALID");
        string observedPin = Convert.ToHexString(SHA256.HashData(trusted.PublicKeySpkiDer)).ToLowerInvariant();
        if (!string.Equals(observedPin, trusted.ExpectedSpkiSha256, StringComparison.Ordinal))
            return OfflineVerdict.Deny("TRUST_PIN_MISMATCH");
        try
        {
            ApprovalTicketV2? ticket = ParseStrict(approvalJson);
            if (ticket is null) return OfflineVerdict.Deny("TICKET_SCHEMA_DENIED");
            if (ticket.Version != 2 || ticket.Issuer != expectedIssuer || ticket.KeyId != trusted.KeyId ||
                !Identifier(ticket.Issuer, 80) || !Identifier(ticket.KeyId, 80) ||
                !Identifier(ticket.Operation, 80) || !Identifier(ticket.TargetId, 80) ||
                !Sid(ticket.BrokerServiceSid) || !Sid(ticket.ClientServiceSid) ||
                !Hex(ticket.TicketId, 32) || !Hex(ticket.RequestId, 32) || !Hex(ticket.Nonce, 32) ||
                !Hex(ticket.ReleaseSha256, 64) || !Hex(ticket.TargetVolumeId, 16) ||
                !Hex(ticket.TargetFileId, 32) || !Hex(ticket.PayloadSha256, 64) ||
                !Hex(ticket.PreimageSha256, 64))
                return OfflineVerdict.Deny("TICKET_SCOPE_OR_GRAMMAR_DENIED");
            if (ticket.ReleaseSha256 != observed.ReleaseSha256 || ticket.RequestId != observed.RequestId ||
                ticket.Operation != observed.Operation || ticket.TargetId != observed.TargetId ||
                ticket.TargetVolumeId != observed.TargetVolumeId || ticket.TargetFileId != observed.TargetFileId ||
                ticket.PayloadSha256 != observed.PayloadSha256 || ticket.PreimageSha256 != observed.PreimageSha256 ||
                ticket.BrokerServiceSid != observed.BrokerServiceSid ||
                ticket.ClientServiceSid != observed.ClientServiceSid)
                return OfflineVerdict.Deny("REQUEST_SCOPE_MISMATCH");
            if (ticket.NotBeforeUnix < 1577836800 || ticket.ExpiresUnix > 4102444800 ||
                ticket.ExpiresUnix <= ticket.NotBeforeUnix ||
                ticket.ExpiresUnix - ticket.NotBeforeUnix > 300 ||
                nowUnix < ticket.NotBeforeUnix || nowUnix >= ticket.ExpiresUnix)
                return OfflineVerdict.Deny("TIME_WINDOW_DENIED");
            if (ticket.SignatureBase64 is null || ticket.SignatureBase64.Length is < 80 or > 112)
                return OfflineVerdict.Deny("SIGNATURE_FORMAT_DENIED");
            byte[] sig = Convert.FromBase64String(ticket.SignatureBase64);
            if (sig.Length is < 64 or > 80 || Convert.ToBase64String(sig) != ticket.SignatureBase64)
                return OfflineVerdict.Deny("SIGNATURE_FORMAT_DENIED");
            using ECDsa ecdsa = ECDsa.Create();
            ecdsa.ImportSubjectPublicKeyInfo(trusted.PublicKeySpkiDer, out int consumed);
            if (consumed != trusted.PublicKeySpkiDer.Length || ecdsa.KeySize != 256 ||
                !ecdsa.VerifyData(CanonicalBytes(ticket), sig, HashAlgorithmName.SHA256,
                    DSASignatureFormat.Rfc3279DerSequence))
                return OfflineVerdict.Deny("SIGNATURE_INVALID");
            return new OfflineVerdict("SIGNATURE_AND_SCOPE_VERIFIED_OFFLINE_ONLY", true, false);
        }
        catch (Exception ex) when (ex is JsonException or FormatException or CryptographicException or ArgumentException)
        {
            return OfflineVerdict.Deny("MALFORMED_OR_INVALID_SIGNATURE");
        }
    }
}
