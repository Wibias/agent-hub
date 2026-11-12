using System.Net;
using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using System.Text.Json.Serialization;
using AgentHub.C9.G3;
using AgentHub.C9.G3.Anchor;
using AgentHub.C9.G3.Witness;
using Microsoft.AspNetCore.Server.Kestrel.Https;

// Explicitly review-only: no config, keys, journal, client mTLS or independent
// audit backend means NO LISTENER. Nothing is auto-created or enrolled.
if(Environment.GetEnvironmentVariable("C9_G3_ANCHOR_ENABLE")!="REVIEW_ONLY")
    throw new InvalidOperationException("ANCHOR_NOT_ENABLED");
string? path=Environment.GetEnvironmentVariable("C9_G3_ANCHOR_CONFIG_PATH");
if(string.IsNullOrEmpty(path) || !Path.IsPathFullyQualified(path))
    throw new InvalidOperationException("ANCHOR_CONFIG_MISSING");
var jsonOptions=new JsonSerializerOptions{PropertyNameCaseInsensitive=false,
    UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow};
AnchorServerConfig cfg=JsonSerializer.Deserialize<AnchorServerConfig>(File.ReadAllText(path),jsonOptions)
    ?? throw new InvalidOperationException("ANCHOR_CONFIG_INVALID");
if(!WitnessProtocol.IsId(cfg.AnchorKeyId) || !WitnessProtocol.IsId(cfg.AuditKeyId) ||
   !WitnessProtocol.IsId(cfg.Scope) || cfg.Port is < 1024 or > 65535 ||
   !WitnessProtocol.IsHex(cfg.RootSpkiSha256,64) ||
   !WitnessProtocol.IsHex(cfg.AuditSpkiSha256,64) ||
   !WitnessProtocol.IsHex(cfg.AuditTlsCertificateSha256,64) ||
   !WitnessProtocol.IsHex(cfg.ServerCertificateSha256,64) ||
   !WitnessProtocol.IsHex(cfg.SigningCertificateSha256,64) ||
   !WitnessProtocol.IsHex(cfg.AuditClientCertificateSha256,64) ||
   cfg.Clients is null || cfg.Clients.Length<2 ||
   cfg.Clients.Select(c=>c.CertificateSha256).Distinct(StringComparer.Ordinal).Count()!=cfg.Clients.Length ||
   cfg.Clients.Any(c=>!WitnessProtocol.IsHex(c.CertificateSha256,64) || c.Scope!=cfg.Scope ||
                      c.Role is not ("reader" or "owner")) ||
   !cfg.Clients.Any(c=>c.Role=="reader") || !cfg.Clients.Any(c=>c.Role=="owner") ||
   !Path.IsPathFullyQualified(cfg.ExistingJournalPath) ||
   !Uri.TryCreate(cfg.AuditCurrentUri,UriKind.Absolute,out Uri? auditCurrent) ||
   !Uri.TryCreate(cfg.AuditAdvanceUri,UriKind.Absolute,out Uri? auditAdvance))
    throw new InvalidOperationException("ANCHOR_CONFIG_DENIED");
byte[] rootSpki=StrictSpki(cfg.RootSpkiBase64,cfg.RootSpkiSha256);
byte[] auditSpki=StrictSpki(cfg.AuditSpkiBase64,cfg.AuditSpkiSha256);
X509Certificate2 serverCert=FindCertificate(cfg.ServerCertificateSha256);
X509Certificate2 signerCert=FindCertificate(cfg.SigningCertificateSha256);
X509Certificate2 auditClientCert=FindCertificate(cfg.AuditClientCertificateSha256);
if(!serverCert.HasPrivateKey || !signerCert.HasPrivateKey || !auditClientCert.HasPrivateKey ||
   serverCert.NotAfter<=DateTime.UtcNow || signerCert.NotAfter<=DateTime.UtcNow ||
   auditClientCert.NotAfter<=DateTime.UtcNow)
    throw new InvalidOperationException("ANCHOR_MACHINE_CERT_UNAVAILABLE");
using ECDsa signingKey=signerCert.GetECDsaPrivateKey()
    ?? throw new InvalidOperationException("ANCHOR_SIGNING_KEY_UNAVAILABLE");
if(signingKey.KeySize!=256)throw new InvalidOperationException("ANCHOR_SIGNER_CURVE_DENIED");
using var journal=new AnchorJournal(cfg.ExistingJournalPath);
if(journal.Read().Scope!=cfg.Scope || journal.Read().RootKeyId!=cfg.RootKeyId)
    throw new InvalidOperationException("ANCHOR_GENESIS_MISMATCH");
using var audit=new AuditHttpBackend(auditCurrent!,auditAdvance!,auditClientCert,
    cfg.AuditTlsCertificateSha256,auditSpki,cfg.AuditSpkiSha256,cfg.AuditKeyId);
var engine=new AnchorEngine(journal,audit,new RootKeyPin(cfg.RootKeyId,rootSpki,
    cfg.RootSpkiSha256),cfg.AnchorKeyId,signingKey);
var permissions=cfg.Clients.ToDictionary(c=>c.CertificateSha256,c=>c,StringComparer.Ordinal);
var builder=WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(k=>{
    k.Limits.MaxRequestBodySize=8192;
    k.Listen(IPAddress.Any,cfg.Port,endpoint=>endpoint.UseHttps(o=>{
        o.ServerCertificate=serverCert;
        o.ClientCertificateMode=ClientCertificateMode.RequireCertificate;
        o.SslProtocols=SslProtocols.Tls12|SslProtocols.Tls13;
        o.CheckCertificateRevocation=true;
        o.ClientCertificateValidation=(cert,_,errors)=>cert is not null &&
            errors==SslPolicyErrors.None &&
            permissions.ContainsKey(cert.GetCertHashString(HashAlgorithmName.SHA256).ToLowerInvariant());
    }));
});
var app=builder.Build();
app.MapPost("/v1/current",async (HttpContext ctx)=>{
    ClientRole? role=Role(ctx);
    if(role is null)return Results.StatusCode(403);
    byte[]? body=await ReadBody(ctx,4096);
    if(body is null)return Results.BadRequest();
    AnchorQueryV1? query=ParseExact<AnchorQueryV1>(body,
        ["Version","Purpose","Scope","ChallengeNonce"]);
    if(query is null || query.Version!=1 || query.Purpose!="G3_ANCHOR_READ" ||
       query.Scope!=role.Scope || !WitnessProtocol.IsHex(query.ChallengeNonce,64))
        return Results.BadRequest();
    AnchorReceiptV1? receipt=await engine.GetCurrentAsync(query,
        DateTimeOffset.UtcNow.ToUnixTimeSeconds(),ctx.RequestAborted);
    if(receipt is null)return Results.StatusCode(503);
    ctx.Response.Headers.CacheControl="no-store";
    return Results.Json(receipt);
});
app.MapPost("/v1/advance",async (HttpContext ctx)=>{
    ClientRole? role=Role(ctx);
    if(role is not {Role:"owner"})return Results.StatusCode(403);
    byte[]? body=await ReadBody(ctx,8192);
    if(body is null)return Results.BadRequest();
    AdvanceRequestV1? request=ParseExact<AdvanceRequestV1>(body,
        ["Version","Scope","TransitionId","ExpectedEpoch","ExpectedRevision",
         "ExpectedManifestSha256","SignedManifestBase64","Reason","OwnerApprovalReference"]);
    if(request is null || request.Scope!=role.Scope)return Results.BadRequest();
    AdvanceOutcome result=await engine.AdvanceHeadAsync(request,
        DateTimeOffset.UtcNow.ToUnixTimeSeconds(),ctx.RequestAborted);
    if(!result.Committed)return Results.StatusCode(503); // never claim a definite deny after audit uncertainty
    ctx.Response.Headers.CacheControl="no-store";
    return Results.Json(result);
});
// No enrollment, reset-epoch, private-key export, force revision or local recovery route.
app.Run();

ClientRole? Role(HttpContext context){
    string? pin=context.Connection.ClientCertificate?
        .GetCertHashString(HashAlgorithmName.SHA256).ToLowerInvariant();
    return pin is not null && permissions.TryGetValue(pin,out ClientRole? role)?role:null;
}
static async Task<byte[]?> ReadBody(HttpContext c,int max){
    if(c.Request.ContentLength is null or < 30 || c.Request.ContentLength>max ||
       c.Request.ContentType is null ||
       !c.Request.ContentType.StartsWith("application/json",StringComparison.OrdinalIgnoreCase))return null;
    byte[] data=new byte[checked((int)c.Request.ContentLength.Value)];
    try{await c.Request.Body.ReadExactlyAsync(data,c.RequestAborted);return data;}
    catch(Exception e) when(e is IOException or OperationCanceledException){return null;}
}
static T? ParseExact<T>(byte[] bytes,string[] expected){
    try{
        using JsonDocument d=JsonDocument.Parse(bytes,new JsonDocumentOptions{MaxDepth=4});
        if(d.RootElement.ValueKind!=JsonValueKind.Object)return default;
        var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(var p in d.RootElement.EnumerateObject()){
            if(Array.IndexOf(expected,p.Name)<0 || !seen.Add(p.Name))return default;
            if(p.Name is "Version" or "ExpectedEpoch" or "ExpectedRevision"){
                if(p.Value.ValueKind!=JsonValueKind.Number || !p.Value.TryGetInt64(out _))return default;
            }else if(p.Value.ValueKind!=JsonValueKind.String)return default;
        }
        if(seen.Count!=expected.Length)return default;
        return JsonSerializer.Deserialize<T>(bytes,new JsonSerializerOptions{
            PropertyNameCaseInsensitive=false,UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow});
    }catch(Exception e) when(e is JsonException or ArgumentException){return default;}
}
static byte[] StrictSpki(string b64,string pin){
    byte[] der;
    try{der=Convert.FromBase64String(b64);}catch(FormatException){throw new InvalidOperationException("ANCHOR_SPKI_ENCODING_DENIED");}
    if(der.Length is < 60 or > 256 || Convert.ToBase64String(der)!=b64 ||
        !CryptographicOperations.FixedTimeEquals(SHA256.HashData(der),Convert.FromHexString(pin)))
        throw new InvalidOperationException("ANCHOR_SPKI_PIN_DENIED");
    using ECDsa k=ECDsa.Create();k.ImportSubjectPublicKeyInfo(der,out int n);
    if(n!=der.Length || k.KeySize!=256)throw new InvalidOperationException("ANCHOR_SPKI_CURVE_DENIED");
    return der;
}
static X509Certificate2 FindCertificate(string pin){
    using var store=new X509Store(StoreName.My,StoreLocation.LocalMachine);
    store.Open(OpenFlags.ReadOnly);
    foreach(X509Certificate2 c in store.Certificates)
        if(c.GetCertHashString(HashAlgorithmName.SHA256).ToLowerInvariant()==pin)return c;
    throw new InvalidOperationException("ANCHOR_MACHINE_CERT_NOT_FOUND");
}
internal sealed record ClientRole(string CertificateSha256,string Scope,string Role);
internal sealed record AnchorServerConfig(
    string AnchorKeyId,string RootKeyId,string RootSpkiBase64,string RootSpkiSha256,
    string Scope,int Port,string ExistingJournalPath,
    string ServerCertificateSha256,string SigningCertificateSha256,
    string AuditClientCertificateSha256,string AuditTlsCertificateSha256,
    string AuditSpkiBase64,string AuditSpkiSha256,string AuditKeyId,
    string AuditCurrentUri,string AuditAdvanceUri,ClientRole[] Clients);
