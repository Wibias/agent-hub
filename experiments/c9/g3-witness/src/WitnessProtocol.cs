using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgentHub.C9.G3.Witness;

// Deliberately pure: no private-key provisioner, database, transport, or write permission.
public sealed record ReadRequestV1(int Version, string Purpose, string ChallengeNonce);
public sealed record AnchorQueryV1(int Version, string Purpose, string Scope, string ChallengeNonce);
public sealed record AnchorReceiptV1(
    int Version, string AnchorKeyId, string Scope, long Epoch, long Revision,
    string ManifestSha256, string RootKeyId, string ChallengeNonce,
    long IssuedAtUnix, long ExpiresAtUnix, string SignatureBase64);
public sealed record WitnessHeadV1(
    int Version, string WitnessId, string WitnessKeyId, string Scope,
    long Epoch, long Revision, string ManifestSha256, string RootKeyId,
    string ChallengeNonce, long IssuedAtUnix, long ExpiresAtUnix, string SignatureBase64);
public sealed record VerifiedHead(
    string Scope, long Epoch, long Revision, string ManifestSha256, string RootKeyId);

public static class WitnessProtocol
{
    public const int MaxBodyBytes = 4096;
    public const long MaxResponseAgeSeconds = 30;
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNameCaseInsensitive = false, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };
    private static readonly string[] ReadFields = ["Version", "Purpose", "ChallengeNonce"];
    private static readonly string[] AnchorFields = [
        "Version", "AnchorKeyId", "Scope", "Epoch", "Revision", "ManifestSha256",
        "RootKeyId", "ChallengeNonce", "IssuedAtUnix", "ExpiresAtUnix", "SignatureBase64"
    ];
    private static readonly string[] HeadFields = [
        "Version", "WitnessId", "WitnessKeyId", "Scope", "Epoch", "Revision",
        "ManifestSha256", "RootKeyId", "ChallengeNonce", "IssuedAtUnix", "ExpiresAtUnix", "SignatureBase64"
    ];

    public static bool IsHex(string? value, int length)
    {
        if (value is null || value.Length != length) return false;
        foreach (char c in value)
            if (!(c is >= '0' and <= '9' or >= 'a' and <= 'f')) return false;
        return true;
    }

    public static bool IsId(string? value, int max = 120)
    {
        if (string.IsNullOrEmpty(value) || value.Length > max) return false;
        foreach (char c in value)
            if (!(c is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' or '.' or '-' or '_' or ':'))
                return false;
        return true;
    }

    private static T? ParseExact<T>(ReadOnlySpan<byte> data, string[] fields)
    {
        if (data.Length is < 30 or > MaxBodyBytes) return default;
        try
        {
            using JsonDocument doc = JsonDocument.Parse(data.ToArray(), new JsonDocumentOptions {
                AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 3
            });
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return default;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (JsonProperty p in doc.RootElement.EnumerateObject())
            {
                if (Array.IndexOf(fields, p.Name) < 0 || !seen.Add(p.Name)) return default;
                if (p.Name is "Version" or "Epoch" or "Revision" or "IssuedAtUnix" or "ExpiresAtUnix")
                {
                    if (p.Value.ValueKind != JsonValueKind.Number || !p.Value.TryGetInt64(out _)) return default;
                }
                else if (p.Value.ValueKind != JsonValueKind.String) return default;
            }
            if (seen.Count != fields.Length) return default;
            return JsonSerializer.Deserialize<T>(data, JsonOptions);
        }
        catch (Exception e) when (e is JsonException or ArgumentException or NotSupportedException)
        {
            return default;
        }
    }

    public static ReadRequestV1? ParseRead(ReadOnlySpan<byte> body)
    {
        ReadRequestV1? r = ParseExact<ReadRequestV1>(body, ReadFields);
        return r is {Version:1, Purpose:"G3_TRUST_READ"} && IsHex(r.ChallengeNonce, 64) ? r : null;
    }

    public static byte[] AnchorCanonical(AnchorReceiptV1 r) => Canonical(
        "agenthub-c9-g3-anchor-head-v1", r.Version.ToString(CultureInfo.InvariantCulture),
        r.AnchorKeyId, r.Scope, r.Epoch.ToString(CultureInfo.InvariantCulture),
        r.Revision.ToString(CultureInfo.InvariantCulture), r.ManifestSha256, r.RootKeyId,
        r.ChallengeNonce, r.IssuedAtUnix.ToString(CultureInfo.InvariantCulture),
        r.ExpiresAtUnix.ToString(CultureInfo.InvariantCulture));

    public static byte[] WitnessCanonical(WitnessHeadV1 r) => Canonical(
        "agenthub-c9-g3-witness-head-v1", r.Version.ToString(CultureInfo.InvariantCulture),
        r.WitnessId, r.WitnessKeyId, r.Scope, r.Epoch.ToString(CultureInfo.InvariantCulture),
        r.Revision.ToString(CultureInfo.InvariantCulture), r.ManifestSha256, r.RootKeyId,
        r.ChallengeNonce, r.IssuedAtUnix.ToString(CultureInfo.InvariantCulture),
        r.ExpiresAtUnix.ToString(CultureInfo.InvariantCulture));

    private static byte[] Canonical(params string[] fields) =>
        Encoding.ASCII.GetBytes(string.Join("\n", fields) + "\n");

    private static bool ValidTime(long issued, long expires, long now) =>
        issued >= 1577836800 && expires <= 4102444800 &&
        issued <= now + 5 && issued >= now - MaxResponseAgeSeconds &&
        expires > now && expires > issued && expires - issued <= MaxResponseAgeSeconds;

    private static bool CheckPin(byte[] spki, string pin) =>
        IsHex(pin,64) && spki.Length is >= 60 and <= 256 &&
        CryptographicOperations.FixedTimeEquals(SHA256.HashData(spki), Convert.FromHexString(pin));

    private static bool VerifySignature(byte[] spki, string base64, byte[] canonical)
    {
        if (base64 is null || base64.Length is < 84 or > 112) return false;
        try
        {
            byte[] signature = Convert.FromBase64String(base64);
            if (signature.Length is < 64 or > 80 || Convert.ToBase64String(signature) != base64) return false;
            using ECDsa key = ECDsa.Create();
            key.ImportSubjectPublicKeyInfo(spki, out int consumed);
            return consumed == spki.Length && key.KeySize == 256 &&
                key.VerifyData(canonical, signature, HashAlgorithmName.SHA256,
                    DSASignatureFormat.Rfc3279DerSequence);
        }
        catch (Exception ex) when (ex is FormatException or CryptographicException or ArgumentException)
        {
            return false;
        }
    }

    public static VerifiedHead? VerifyAnchor(
        ReadOnlySpan<byte> bytes, string scope, string nonce, string expectedAnchorKeyId,
        byte[] anchorSpki, string expectedAnchorSpkiSha256, long nowUnix)
    {
        if (!IsId(scope) || !IsHex(nonce, 64) || !IsId(expectedAnchorKeyId) ||
            anchorSpki is null || !CheckPin(anchorSpki, expectedAnchorSpkiSha256)) return null;
        AnchorReceiptV1? a = ParseExact<AnchorReceiptV1>(bytes, AnchorFields);
        if (a is null || a.Version != 1 || a.Scope != scope ||
            a.AnchorKeyId != expectedAnchorKeyId || a.ChallengeNonce != nonce ||
            a.Epoch < 1 || a.Revision < 1 || !IsHex(a.ManifestSha256, 64) ||
            !IsId(a.RootKeyId) || !ValidTime(a.IssuedAtUnix, a.ExpiresAtUnix, nowUnix) ||
            !VerifySignature(anchorSpki, a.SignatureBase64, AnchorCanonical(a))) return null;
        return new VerifiedHead(a.Scope, a.Epoch, a.Revision, a.ManifestSha256, a.RootKeyId);
    }

    public static WitnessHeadV1 SignHead(
        VerifiedHead authoritative, ReadRequestV1 request, string witnessId,
        string witnessKeyId, ECDsa signingKey, long nowUnix)
    {
        if (ParseRead(JsonSerializer.SerializeToUtf8Bytes(request)) is null ||
            !IsId(authoritative.Scope) || authoritative.Epoch < 1 || authoritative.Revision < 1 ||
            !IsHex(authoritative.ManifestSha256, 64) || !IsId(authoritative.RootKeyId) ||
            !IsId(witnessId) || !IsId(witnessKeyId) || signingKey.KeySize != 256 ||
            nowUnix < 1577836800 || nowUnix > 4102444770)
            throw new ArgumentException("WITNESS_SIGN_DENIED");
        var unsigned = new WitnessHeadV1(1, witnessId, witnessKeyId,
            authoritative.Scope, authoritative.Epoch, authoritative.Revision,
            authoritative.ManifestSha256, authoritative.RootKeyId, request.ChallengeNonce,
            nowUnix, nowUnix + 15, "");
        byte[] sig = signingKey.SignData(WitnessCanonical(unsigned), HashAlgorithmName.SHA256,
            DSASignatureFormat.Rfc3279DerSequence);
        return unsigned with {SignatureBase64 = Convert.ToBase64String(sig)};
    }

    public static VerifiedHead? VerifyWitness(
        ReadOnlySpan<byte> bytes, string scope, string nonce, string witnessId,
        string witnessKeyId, byte[] witnessSpki, string expectedWitnessSpkiSha256,
        long expectedEpoch, long nowUnix)
    {
        if (!IsId(scope) || !IsHex(nonce, 64) || !IsId(witnessId) || !IsId(witnessKeyId) ||
            witnessSpki is null || !CheckPin(witnessSpki, expectedWitnessSpkiSha256)) return null;
        WitnessHeadV1? w = ParseExact<WitnessHeadV1>(bytes, HeadFields);
        if (w is null || w.Version != 1 || w.WitnessId != witnessId ||
            w.WitnessKeyId != witnessKeyId || w.Scope != scope || w.ChallengeNonce != nonce ||
            w.Epoch != expectedEpoch || w.Revision < 1 || !IsHex(w.ManifestSha256, 64) ||
            !IsId(w.RootKeyId) || !ValidTime(w.IssuedAtUnix, w.ExpiresAtUnix, nowUnix) ||
            !VerifySignature(witnessSpki, w.SignatureBase64, WitnessCanonical(w))) return null;
        return new VerifiedHead(w.Scope, w.Epoch, w.Revision, w.ManifestSha256, w.RootKeyId);
    }
}
