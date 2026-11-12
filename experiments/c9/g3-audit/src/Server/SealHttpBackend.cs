using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using AgentHub.C9.G3.Anchor;
using AgentHub.C9.G3.Audit;
using AgentHub.C9.G3.Witness;

internal sealed record SealQueryV1(int Version,string Purpose,string Scope,string ChallengeNonce);
internal sealed record SealCasWireV1(
    int Version,string Purpose,string ChallengeNonce,string TransitionId,
    AnchorHead Expected,AnchorHead Proposed,string SignedManifestBase64);

// Requires an independently deployed immutable store service. It MUST enforce
// monotonic durable CAS itself; this client verifies only signed receipts.
internal sealed class SealHttpBackend : IIndependentImmutableSeal, IDisposable
{
    private readonly HttpClient client;
    private readonly Uri currentUri,advanceUri;
    private readonly byte[] spki;
    private readonly string pin,keyId;

    public SealHttpBackend(Uri current,Uri advance,X509Certificate2 clientCert,
        string tlsPin,byte[] sealSpki,string sealPin,string sealKeyId)
    {
        if(current.Scheme!="https" || advance.Scheme!="https" ||
           current.Host!=advance.Host || current.Port!=advance.Port ||
           current.AbsolutePath!="/v1/current" || advance.AbsolutePath!="/v1/advance" ||
           current.UserInfo!="" || advance.UserInfo!="" ||
           current.Query!="" || advance.Query!="" || current.Fragment!="" || advance.Fragment!="" ||
           !WitnessProtocol.IsHex(tlsPin,64) || !WitnessProtocol.IsHex(sealPin,64) ||
           !WitnessProtocol.IsId(sealKeyId) || !clientCert.HasPrivateKey ||
           !CryptographicOperations.FixedTimeEquals(SHA256.HashData(sealSpki),Convert.FromHexString(sealPin)))
            throw new InvalidOperationException("AUDIT_SEAL_CONFIG_INVALID");
        var handler=new HttpClientHandler {AllowAutoRedirect=false,UseProxy=false,CheckCertificateRevocationList=true};
        handler.ClientCertificates.Add(clientCert);
        handler.ServerCertificateCustomValidationCallback=(_,cert,_,errors)=>
            errors==SslPolicyErrors.None && cert is not null &&
            cert.GetCertHashString(HashAlgorithmName.SHA256).ToLowerInvariant()==tlsPin;
        client=new HttpClient(handler){Timeout=TimeSpan.FromSeconds(5)};
        currentUri=current;advanceUri=advance;
        spki=(byte[])sealSpki.Clone();pin=sealPin;keyId=sealKeyId;
    }

    private static string NewNonce()=>Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    private async Task<AnchorHead?> FetchAsync(Uri uri,object request,string scope,string nonce,CancellationToken ct)
    {
        using var message=new HttpRequestMessage(HttpMethod.Post,uri);
        message.Content=new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(request));
        message.Content.Headers.ContentType=new("application/json");
        using var response=await client.SendAsync(message,HttpCompletionOption.ResponseHeadersRead,ct);
        if(!response.IsSuccessStatusCode || response.Content.Headers.ContentLength is > WitnessProtocol.MaxBodyBytes)
            return null;
        await using var stream=await response.Content.ReadAsStreamAsync(ct);
        byte[] bytes=new byte[WitnessProtocol.MaxBodyBytes+1];int used=0;
        while(used<bytes.Length){int n=await stream.ReadAsync(bytes.AsMemory(used),ct);if(n==0)break;used+=n;}
        if(used>WitnessProtocol.MaxBodyBytes)return null;
        return SealProtocol.Verify(bytes.AsSpan(0,used),scope,nonce,keyId,spki,pin,
            DateTimeOffset.UtcNow.ToUnixTimeSeconds());
    }

    public Task<AnchorHead?> ReadAsync(string scope,CancellationToken ct)
    {
        string nonce=NewNonce();
        return FetchAsync(currentUri,new SealQueryV1(1,"G3_SEAL_READ",scope,nonce),scope,nonce,ct);
    }
    public async Task<bool> CompareAndSealAsync(AnchorHead previous,AnchorHead next,
        string transitionId,string signedManifestBase64,CancellationToken ct)
    {
        string nonce=NewNonce();
        var request=new SealCasWireV1(1,"G3_SEAL_CAS",nonce,transitionId,previous,next,signedManifestBase64);
        AnchorHead? r=await FetchAsync(advanceUri,request,previous.Scope,nonce,ct);
        return r is not null && r==next;
    }
    public void Dispose()=>client.Dispose();
}
