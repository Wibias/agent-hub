using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AgentHub.C9.G3;

// This is a stateless, offline verifier. It cannot enroll keys, change a trusted
// checkpoint, sign an approval, access SCM, or authorize a file mutation.
public sealed record RootKeyPin(string RootKeyId, byte[] PublicKeySpkiDer, string ExpectedSpkiSha256);

// MUST come from a separate protected, monotonic authority. This type does NOT
// authenticate its own origin or guarantee that the caller supplied the latest revision.
public sealed record ProtectedTrustCheckpoint(long Revision, string ManifestSha256);

public sealed record SignedTrustManifestV1(
    int Version, string RootKeyId, long Revision, string IssuerKeyId,
    string IssuerPublicKeySpkiBase64, string IssuerSpkiSha256, string KeyState,
    long NotBeforeUnix, long ExpiresUnix, string SignatureBase64);

public readonly record struct TrustBootstrapVerdict(
    string Reason, bool ManifestVerified, TrustedKeySnapshot? VerifiedIssuer,
    bool CanExecuteCommit)
{
    public static TrustBootstrapVerdict Deny(string reason) => new(reason, false, null, false);
}

public static class TrustBootstrap
{
    private const int MaxManifestBytes = 4096;
    private const long MaximumManifestValiditySeconds = 30 * 24 * 60 * 60;
    private const string P256Oid = "1.2.840.10045.3.1.7";
    private static readonly HashSet<string> Fields = new(StringComparer.Ordinal) {
        "Version", "RootKeyId", "Revision", "IssuerKeyId", "IssuerPublicKeySpkiBase64",
        "IssuerSpkiSha256", "KeyState", "NotBeforeUnix", "ExpiresUnix", "SignatureBase64"
    };
    private static readonly JsonSerializerOptions StrictJson = new() {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow
    };

    private static bool IsHex(string? value, int length)
    {
        if (value is null || value.Length != length) return false;
        foreach (char ch in value)
            if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'))) return false;
        return true;
    }

    private static bool IsIdentifier(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 80) return false;
        foreach (char ch in value)
            if (!((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
                  (ch >= '0' && ch <= '9') || ch is '-' or '_' or '.')) return false;
        return true;
    }

    private static bool TryCanonicalBase64(string? value, int minBytes, int maxBytes, out byte[] bytes)
    {
        bytes = Array.Empty<byte>();
        if (value is null || value.Length > 512 || value.Length < 8) return false;
        try
        {
            byte[] parsed = Convert.FromBase64String(value);
            if (parsed.Length < minBytes || parsed.Length > maxBytes ||
                Convert.ToBase64String(parsed) != value) return false;
            bytes = parsed;
            return true;
        }
        catch (FormatException) { return false; }
    }

    private static SignedTrustManifestV1? ParseStrict(ReadOnlySpan<byte> json)
    {
        if (json.Length is < 300 or > MaxManifestBytes) return null;
        using JsonDocument doc = JsonDocument.Parse(json.ToArray(), new JsonDocumentOptions {
            AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 3
        });
        if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
        HashSet<string> seen = new(StringComparer.Ordinal);
        foreach (JsonProperty property in doc.RootElement.EnumerateObject())
        {
            if (!Fields.Contains(property.Name) || !seen.Add(property.Name)) return null;
            if (property.Name == "Version")
            {
                if (property.Value.ValueKind != JsonValueKind.Number ||
                    !property.Value.TryGetInt32(out _)) return null;
            }
            else if (property.Name is "Revision" or "NotBeforeUnix" or "ExpiresUnix")
            {
                if (property.Value.ValueKind != JsonValueKind.Number ||
                    !property.Value.TryGetInt64(out _)) return null;
            }
            else if (property.Value.ValueKind != JsonValueKind.String) return null;
        }
        if (seen.Count != Fields.Count) return null;
        return JsonSerializer.Deserialize<SignedTrustManifestV1>(json, StrictJson);
    }

    // Pure canonicalization of trusted, grammar-checked fields. Used by test signer only.
    // A digest computed from these bytes is not an independent trust checkpoint.
    public static byte[] CanonicalBytes(SignedTrustManifestV1 manifest)
    {
        string[] fields = {
            "agenthub-c9-trust-manifest-v1", manifest.Version.ToString(CultureInfo.InvariantCulture),
            manifest.RootKeyId, manifest.Revision.ToString(CultureInfo.InvariantCulture),
            manifest.IssuerKeyId, manifest.IssuerPublicKeySpkiBase64, manifest.IssuerSpkiSha256,
            manifest.KeyState, manifest.NotBeforeUnix.ToString(CultureInfo.InvariantCulture),
            manifest.ExpiresUnix.ToString(CultureInfo.InvariantCulture)
        };
        return Encoding.ASCII.GetBytes(string.Join("\n", fields) + "\n");
    }

    public static string ManifestSha256(SignedTrustManifestV1 manifest) =>
        Convert.ToHexString(SHA256.HashData(CanonicalBytes(manifest))).ToLowerInvariant();

    private static bool IsP256PublicKey(ECDsa key)
    {
        return key.KeySize == 256 &&
            string.Equals(key.ExportParameters(false).Curve.Oid.Value, P256Oid, StringComparison.Ordinal);
    }

    public static TrustBootstrapVerdict Verify(
        ReadOnlySpan<byte> manifestJson, RootKeyPin? root,
        ProtectedTrustCheckpoint? checkpoint, long nowUnix)
    {
        // No default root, no locally inferred checkpoint, no trusted on-disk path.
        if (root is null || checkpoint is null) return TrustBootstrapVerdict.Deny("ROOT_OR_CHECKPOINT_MISSING");
        if (!IsIdentifier(root.RootKeyId) || !IsHex(root.ExpectedSpkiSha256, 64) ||
            root.PublicKeySpkiDer is null || root.PublicKeySpkiDer.Length is < 60 or > 256 ||
            !IsHex(checkpoint.ManifestSha256, 64) || checkpoint.Revision < 1)
            return TrustBootstrapVerdict.Deny("TRUST_INPUT_INVALID");
        if (Convert.ToHexString(SHA256.HashData(root.PublicKeySpkiDer)).ToLowerInvariant() !=
            root.ExpectedSpkiSha256)
            return TrustBootstrapVerdict.Deny("ROOT_PIN_MISMATCH");

        try
        {
            SignedTrustManifestV1? manifest = ParseStrict(manifestJson);
            if (manifest is null) return TrustBootstrapVerdict.Deny("MANIFEST_SCHEMA_DENIED");
            if (manifest.Version != 1 || manifest.RootKeyId != root.RootKeyId ||
                manifest.Revision != checkpoint.Revision || !IsIdentifier(manifest.IssuerKeyId) ||
                manifest.IssuerKeyId == root.RootKeyId || !IsHex(manifest.IssuerSpkiSha256, 64) ||
                manifest.KeyState is not ("active" or "revoked"))
                return TrustBootstrapVerdict.Deny("IDENTITY_OR_REVISION_DENIED");
            if (manifest.NotBeforeUnix < 1577836800 || manifest.ExpiresUnix > 4102444800 ||
                manifest.ExpiresUnix <= manifest.NotBeforeUnix ||
                manifest.ExpiresUnix - manifest.NotBeforeUnix > MaximumManifestValiditySeconds ||
                nowUnix < manifest.NotBeforeUnix || nowUnix >= manifest.ExpiresUnix)
                return TrustBootstrapVerdict.Deny("MANIFEST_TIME_WINDOW_DENIED");
            byte[] canonical = CanonicalBytes(manifest);
            string hash = Convert.ToHexString(SHA256.HashData(canonical)).ToLowerInvariant();
            if (hash != checkpoint.ManifestSha256)
                return TrustBootstrapVerdict.Deny("CHECKPOINT_HASH_MISMATCH");
            if (!TryCanonicalBase64(manifest.IssuerPublicKeySpkiBase64, 60, 256,
                    out byte[] issuerSpki) ||
                Convert.ToHexString(SHA256.HashData(issuerSpki)).ToLowerInvariant() !=
                    manifest.IssuerSpkiSha256 ||
                manifest.IssuerSpkiSha256 == root.ExpectedSpkiSha256)
                return TrustBootstrapVerdict.Deny("ISSUER_KEY_OR_PIN_INVALID");
            if (!TryCanonicalBase64(manifest.SignatureBase64, 64, 80, out byte[] signature))
                return TrustBootstrapVerdict.Deny("ROOT_SIGNATURE_FORMAT_DENIED");

            using ECDsa rootVerifier = ECDsa.Create();
            rootVerifier.ImportSubjectPublicKeyInfo(root.PublicKeySpkiDer, out int rootConsumed);
            using ECDsa issuerVerifier = ECDsa.Create();
            issuerVerifier.ImportSubjectPublicKeyInfo(issuerSpki, out int issuerConsumed);
            if (rootConsumed != root.PublicKeySpkiDer.Length ||
                issuerConsumed != issuerSpki.Length ||
                !IsP256PublicKey(rootVerifier) || !IsP256PublicKey(issuerVerifier))
                return TrustBootstrapVerdict.Deny("UNSUPPORTED_KEY_CURVE");
            if (!rootVerifier.VerifyData(canonical, signature, HashAlgorithmName.SHA256,
                    DSASignatureFormat.Rfc3279DerSequence))
                return TrustBootstrapVerdict.Deny("ROOT_SIGNATURE_INVALID");

            // Even an active verified issuer cannot execute anything; no writes or key enrollment.
            var issuer = new TrustedKeySnapshot(manifest.IssuerKeyId,
                (byte[])issuerSpki.Clone(), manifest.IssuerSpkiSha256,
                Revoked: manifest.KeyState == "revoked");
            return new TrustBootstrapVerdict("TRUST_MANIFEST_VERIFIED_OFFLINE_ONLY",
                true, issuer, false);
        }
        catch (Exception ex) when (ex is JsonException or ArgumentException or CryptographicException or FormatException)
        {
            return TrustBootstrapVerdict.Deny("INVALID_MANIFEST_OR_KEY");
        }
    }
}
