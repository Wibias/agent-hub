using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AgentHub.C9.G3.Anchor;
using AgentHub.C9.G3.Witness;

namespace AgentHub.C9.G3.Audit;

// The independent storage authority signs ALL head fields, including revocation.
// A seal receipt is evidence of its claimed current state, not proof of WORM
// configuration or independent ownership; those need separate infrastructure review.
public sealed record SealReceiptV1(
    int Version, string SealKeyId, string Scope, long Epoch, long Revision,
    string ManifestSha256, string RootKeyId, string IssuerKeyId,
    string IssuerSpkiSha256, bool Revoked, string ChallengeNonce,
    long IssuedAtUnix, long ExpiresAtUnix, string SignatureBase64);

public static class SealProtocol
{
    private static readonly string[] Fields = [
        "Version","SealKeyId","Scope","Epoch","Revision","ManifestSha256",
        "RootKeyId","IssuerKeyId","IssuerSpkiSha256","Revoked","ChallengeNonce",
        "IssuedAtUnix","ExpiresAtUnix","SignatureBase64"
    ];
    public static byte[] Canonical(SealReceiptV1 r) => Encoding.ASCII.GetBytes(string.Join("\n",new[]{
        "agenthub-c9-g3-independent-seal-v1",r.Version.ToString(CultureInfo.InvariantCulture),
        r.SealKeyId,r.Scope,r.Epoch.ToString(CultureInfo.InvariantCulture),
        r.Revision.ToString(CultureInfo.InvariantCulture),r.ManifestSha256,r.RootKeyId,
        r.IssuerKeyId,r.IssuerSpkiSha256,r.Revoked ? "true" : "false",r.ChallengeNonce,
        r.IssuedAtUnix.ToString(CultureInfo.InvariantCulture),
        r.ExpiresAtUnix.ToString(CultureInfo.InvariantCulture)})+"\n");

    public static AnchorHead? Verify(ReadOnlySpan<byte> json, string scope,
        string nonce, string expectedKeyId, byte[] spki, string expectedPin, long nowUnix)
    {
        if(json.Length is < 200 or > 4096 || !WitnessProtocol.IsId(scope) ||
           !WitnessProtocol.IsHex(nonce,64) || !WitnessProtocol.IsId(expectedKeyId) ||
           spki is null || spki.Length is < 60 or > 256 ||
           !WitnessProtocol.IsHex(expectedPin,64) ||
           !CryptographicOperations.FixedTimeEquals(SHA256.HashData(spki),Convert.FromHexString(expectedPin)))
            return null;
        try
        {
            using JsonDocument document=JsonDocument.Parse(json.ToArray(),new JsonDocumentOptions{
                AllowTrailingCommas=false,CommentHandling=JsonCommentHandling.Disallow,MaxDepth=3
            });
            if(document.RootElement.ValueKind!=JsonValueKind.Object)return null;
            var seen=new HashSet<string>(StringComparer.Ordinal);
            foreach(JsonProperty p in document.RootElement.EnumerateObject())
            {
                if(Array.IndexOf(Fields,p.Name)<0 || !seen.Add(p.Name))return null;
                if(p.Name is "Version" or "Epoch" or "Revision" or "IssuedAtUnix" or "ExpiresAtUnix")
                {
                    if(p.Value.ValueKind!=JsonValueKind.Number || !p.Value.TryGetInt64(out _))return null;
                }
                else if(p.Name=="Revoked")
                {
                    if(p.Value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))return null;
                }
                else if(p.Value.ValueKind!=JsonValueKind.String)return null;
            }
            if(seen.Count!=Fields.Length)return null;
            SealReceiptV1? r=JsonSerializer.Deserialize<SealReceiptV1>(json);
            if(r is null || r.Version!=1 || r.Scope!=scope || r.ChallengeNonce!=nonce ||
               r.SealKeyId!=expectedKeyId || r.Epoch<1 || r.Revision<1 ||
               !WitnessProtocol.IsHex(r.ManifestSha256,64) ||
               !WitnessProtocol.IsId(r.RootKeyId) || !WitnessProtocol.IsId(r.IssuerKeyId) ||
               !WitnessProtocol.IsHex(r.IssuerSpkiSha256,64) ||
               r.IssuedAtUnix<1577836800 || r.IssuedAtUnix>nowUnix+5 ||
               r.IssuedAtUnix<nowUnix-30 || r.ExpiresAtUnix<=nowUnix ||
               r.ExpiresAtUnix<=r.IssuedAtUnix || r.ExpiresAtUnix-r.IssuedAtUnix>30 ||
               r.SignatureBase64 is null || r.SignatureBase64.Length is < 84 or > 112)
                return null;
            byte[] signature=Convert.FromBase64String(r.SignatureBase64);
            if(signature.Length is < 64 or > 80 ||
               Convert.ToBase64String(signature)!=r.SignatureBase64)return null;
            using ECDsa publicKey=ECDsa.Create();
            publicKey.ImportSubjectPublicKeyInfo(spki,out int n);
            if(n!=spki.Length || publicKey.KeySize!=256 ||
               publicKey.ExportParameters(false).Curve.Oid.Value!="1.2.840.10045.3.1.7" ||
               !publicKey.VerifyData(Canonical(r),signature,HashAlgorithmName.SHA256,
                    DSASignatureFormat.Rfc3279DerSequence))return null;
            return new AnchorHead(r.Scope,r.Epoch,r.Revision,r.ManifestSha256,
                r.RootKeyId,r.IssuerKeyId,r.IssuerSpkiSha256,r.Revoked);
        }
        catch(Exception ex) when(ex is JsonException or FormatException or
            CryptographicException or ArgumentException){return null;}
    }
}
