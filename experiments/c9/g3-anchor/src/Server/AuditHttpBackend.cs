using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using AgentHub.C9.G3.Anchor;
using AgentHub.C9.G3.Witness;

internal sealed record AuditAdvanceWireV1(
    int Version, string Purpose, string ChallengeNonce, string TransitionId,
    AnchorHead Expected, AnchorHead Proposed, string SignedManifestBase64);

// This is an authenticated protocol CLIENT. It cannot prove the remote audit
// server actually uses immutable storage. Deployment requires separate audit proof.
internal sealed class AuditHttpBackend : IIndependentAudit, IDisposable
{
    private readonly HttpClient http;
    private readonly Uri currentUri;
    private readonly Uri advanceUri;
    private readonly byte[] auditSpki;
    private readonly string auditPin;
    private readonly string auditKeyId;

    public AuditHttpBackend(Uri current,Uri advance,X509Certificate2 clientCert,
        string tlsServerPin,byte[] spki,string pin,string keyId)
    {
        if(!WitnessProtocol.IsHex(tlsServerPin,64) ||
           !WitnessProtocol.IsHex(pin,64) || !WitnessProtocol.IsId(keyId) ||
           !CryptographicOperations.FixedTimeEquals(SHA256.HashData(spki),Convert.FromHexString(pin)))
            throw new InvalidOperationException("AUDIT_PIN_INVALID");
        if(current.Scheme!="https" || advance.Scheme!="https" ||
           current.Host!=advance.Host || current.Port!=advance.Port ||
           current.AbsolutePath!="/v1/current" || advance.AbsolutePath!="/v1/advance" ||
           !string.IsNullOrEmpty(current.UserInfo) || !string.IsNullOrEmpty(advance.UserInfo) ||
           current.Query!="" || advance.Query!="" || current.Fragment!="" || advance.Fragment!="")
            throw new InvalidOperationException("AUDIT_ENDPOINT_DENIED");
        var h=new HttpClientHandler { AllowAutoRedirect=false,UseProxy=false,CheckCertificateRevocationList=true };
        h.ClientCertificates.Add(clientCert);
        h.ServerCertificateCustomValidationCallback=(_,cert,_,errors)=>
            errors==SslPolicyErrors.None && cert is not null &&
            cert.GetCertHashString(HashAlgorithmName.SHA256).ToLowerInvariant()==tlsServerPin;
        http=new HttpClient(h){Timeout=TimeSpan.FromSeconds(5)};
        currentUri=current;advanceUri=advance;auditSpki=(byte[])spki.Clone();auditPin=pin;auditKeyId=keyId;
    }

    private async Task<VerifiedHead?> PostAndVerifyAsync(Uri uri,object value,
        string scope,string nonce,CancellationToken ct)
    {
        using var req=new HttpRequestMessage(HttpMethod.Post,uri);
        req.Content=new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(value));
        req.Content.Headers.ContentType=new("application/json");
        using var reply=await http.SendAsync(req,HttpCompletionOption.ResponseHeadersRead,ct);
        if(!reply.IsSuccessStatusCode || reply.Content.Headers.ContentLength is > WitnessProtocol.MaxBodyBytes)
            return null;
        await using var stream=await reply.Content.ReadAsStreamAsync(ct);
        byte[] bytes=new byte[WitnessProtocol.MaxBodyBytes+1];int used=0;
        while(used<bytes.Length){int n=await stream.ReadAsync(bytes.AsMemory(used),ct);if(n==0)break;used+=n;}
        if(used>WitnessProtocol.MaxBodyBytes)return null;
        return WitnessProtocol.VerifyAnchor(bytes.AsSpan(0,used),scope,nonce,
            auditKeyId,auditSpki,auditPin,DateTimeOffset.UtcNow.ToUnixTimeSeconds());
    }
    private static string NewNonce()=>Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

    public async Task<AnchorHead?> GetCurrentAsync(string scope,CancellationToken ct)
    {
        string nonce=NewNonce();
        VerifiedHead? h=await PostAndVerifyAsync(currentUri,
            new AnchorQueryV1(1,"G3_AUDIT_READ",scope,nonce),scope,nonce,ct);
        return h is null?null:new AnchorHead(h.Scope,h.Epoch,h.Revision,h.ManifestSha256,
            h.RootKeyId,"audit-projection",new string('0',64),false);
    }

    public async Task<bool> CompareAndAnchorAsync(AnchorHead oldHead,AnchorHead newHead,
        string transitionId,string signedManifestBase64,CancellationToken ct)
    {
        string nonce=NewNonce();
        VerifiedHead? h=await PostAndVerifyAsync(advanceUri,
            new AuditAdvanceWireV1(1,"G3_AUDIT_CAS",nonce,transitionId,
                oldHead,newHead,signedManifestBase64),oldHead.Scope,nonce,ct);
        return h is not null && h.Scope==newHead.Scope && h.Epoch==newHead.Epoch &&
            h.Revision==newHead.Revision && h.ManifestSha256==newHead.ManifestSha256 &&
            h.RootKeyId==newHead.RootKeyId;
    }
    public void Dispose()=>http.Dispose();
}
