using System.Net;
using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using System.Text.Json.Serialization;
using AgentHub.C9.G3;
using AgentHub.C9.G3.Anchor;
using AgentHub.C9.G3.Audit;
using AgentHub.C9.G3.Witness;
using Microsoft.AspNetCore.Server.Kestrel.Https;

// An off-host audit CAS service; never auto-provision genesis, TLS or a seal.
// The review runner only compiles this service, NEVER starts a listener.
if(Environment.GetEnvironmentVariable("C9_G3_AUDIT_ENABLE")!="REVIEW_ONLY")
    throw new InvalidOperationException("AUDIT_NOT_ENABLED");
string? configPath=Environment.GetEnvironmentVariable("C9_G3_AUDIT_CONFIG_PATH");
if(string.IsNullOrEmpty(configPath) || !Path.IsPathFullyQualified(configPath))
    throw new InvalidOperationException("AUDIT_CONFIG_MISSING");
var options=new JsonSerializerOptions {PropertyNameCaseInsensitive=false,
    UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow};
AuditConfig cfg=JsonSerializer.Deserialize<AuditConfig>(File.ReadAllText(configPath),options)
    ?? throw new InvalidOperationException("AUDIT_CONFIG_INVALID");
if(!WitnessProtocol.IsId(cfg.Scope) || !WitnessProtocol.IsId(cfg.AuditKeyId) ||
   !WitnessProtocol.IsId(cfg.SealKeyId) || !WitnessProtocol.IsId(cfg.RootKeyId) ||
   cfg.Port is < 1024 or > 65535 ||
   !WitnessProtocol.IsHex(cfg.RootSpkiSha256,64) ||
   !WitnessProtocol.IsHex(cfg.SealSpkiSha256,64) ||
   !WitnessProtocol.IsHex(cfg.SealTlsCertificateSha256,64) ||
   !WitnessProtocol.IsHex(cfg.ServerCertificateSha256,64) ||
   !WitnessProtocol.IsHex(cfg.SigningCertificateSha256,64) ||
   !WitnessProtocol.IsHex(cfg.SealClientCertificateSha256,64) ||
   !Path.IsPathFullyQualified(cfg.ExistingJournalPath) ||
   cfg.Clients is null || cfg.Clients.Length<2 ||
   cfg.Clients.Any(c=>!WitnessProtocol.IsHex(c.CertificateSha256,64) ||
       c.Scope!=cfg.Scope || c.Role is not ("reader" or "writer")) ||
   cfg.Clients.Select(c=>c.CertificateSha256).Distinct(StringComparer.Ordinal).Count()!=cfg.Clients.Length ||
   !cfg.Clients.Any(c=>c.Role=="reader") || !cfg.Clients.Any(c=>c.Role=="writer") ||
   !Uri.TryCreate(cfg.SealCurrentUri,UriKind.Absolute,out Uri? sealCurrent) ||
   !Uri.TryCreate(cfg.SealAdvanceUri,UriKind.Absolute,out Uri? sealAdvance))
    throw new InvalidOperationException("AUDIT_UNSAFE_CONFIG");
byte[] rootSpki=ParseSpki(cfg.RootSpkiBase64,cfg.RootSpkiSha256);
byte[] sealSpki=ParseSpki(cfg.SealSpkiBase64,cfg.SealSpkiSha256);
X509Certificate2 server=FindMachine(cfg.ServerCertificateSha256);
X509Certificate2 signer=FindMachine(cfg.SigningCertificateSha256);
X509Certificate2 sealClient=FindMachine(cfg.SealClientCertificateSha256);
if(!server.HasPrivateKey || !signer.HasPrivateKey || !sealClient.HasPrivateKey ||
   server.NotBefore>DateTime.UtcNow || signer.NotBefore>DateTime.UtcNow ||
   sealClient.NotBefore>DateTime.UtcNow || server.NotAfter<=DateTime.UtcNow ||
   signer.NotAfter<=DateTime.UtcNow || sealClient.NotAfter<=DateTime.UtcNow)
    throw new InvalidOperationException("AUDIT_MACHINE_CERT_UNAVAILABLE");
using ECDsa signingKey=signer.GetECDsaPrivateKey()
    ?? throw new InvalidOperationException("AUDIT_SIGNER_UNAVAILABLE");
if(signingKey.KeySize!=256)throw new InvalidOperationException("AUDIT_SIGNER_CURVE_DENIED");
using var journal=new AnchorJournal(cfg.ExistingJournalPath);
if(journal.Read().Scope!=cfg.Scope || journal.Read().RootKeyId!=cfg.RootKeyId)
    throw new InvalidOperationException("AUDIT_JOURNAL_GENESIS_MISMATCH");
using var seal=new SealHttpBackend(sealCurrent!,sealAdvance!,sealClient,
    cfg.SealTlsCertificateSha256,sealSpki,cfg.SealSpkiSha256,cfg.SealKeyId);
var engine=new AuditEngine(journal,seal,new RootKeyPin(cfg.RootKeyId,rootSpki,
    cfg.RootSpkiSha256),cfg.AuditKeyId,signingKey);
var clients=cfg.Clients.ToDictionary(c=>c.CertificateSha256,c=>c,StringComparer.Ordinal);
var builder=WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(k=>{
    k.Limits.MaxRequestBodySize=8192;
    k.Listen(IPAddress.Any,cfg.Port,listener=>listener.UseHttps(https=>{
        https.ServerCertificate=server;
        https.ClientCertificateMode=ClientCertificateMode.RequireCertificate;
        https.SslProtocols=SslProtocols.Tls12|SslProtocols.Tls13;
        https.CheckCertificateRevocation=true;
        https.ClientCertificateValidation=(cert,_,errors)=>cert is not null &&
            errors==SslPolicyErrors.None &&
            clients.ContainsKey(cert.GetCertHashString(HashAlgorithmName.SHA256).ToLowerInvariant());
    }));
});
var app=builder.Build();
app.MapPost("/v1/current",async (HttpContext ctx)=>{
    ClientRole? role=GetRole(ctx);
    if(role is null)return Results.StatusCode(403);
    byte[]? bytes=await ReadBody(ctx,4096);
    if(bytes is null)return Results.BadRequest();
    AnchorQueryV1? query=ParseExact<AnchorQueryV1>(bytes,
        ["Version","Purpose","Scope","ChallengeNonce"]);
    if(query is null || query.Scope!=role.Scope || query.Version!=1 ||
       query.Purpose!="G3_AUDIT_READ" || !WitnessProtocol.IsHex(query.ChallengeNonce,64))
        return Results.BadRequest();
    AnchorReceiptV1? response=await engine.GetCurrentAsync(query,
        DateTimeOffset.UtcNow.ToUnixTimeSeconds(),ctx.RequestAborted);
    if(response is null)return Results.StatusCode(503);
    ctx.Response.Headers.CacheControl="no-store";
    return Results.Json(response);
});
app.MapPost("/v1/advance",async (HttpContext ctx)=>{
    ClientRole? role=GetRole(ctx);
    if(role is not {Role:"writer"})return Results.StatusCode(403);
    byte[]? bytes=await ReadBody(ctx,8192);
    if(bytes is null)return Results.BadRequest();
    AuditAdvanceWireV1? request=ParseExact<AuditAdvanceWireV1>(bytes,
        ["Version","Purpose","ChallengeNonce","TransitionId","Expected","Proposed","SignedManifestBase64"]);
    if(request is null || request.Expected is null || request.Proposed is null ||
       request.Expected.Scope!=role.Scope || request.Proposed.Scope!=role.Scope)
        return Results.BadRequest();
    AnchorReceiptV1? result=await engine.CompareAndAnchorAsync(request,
        DateTimeOffset.UtcNow.ToUnixTimeSeconds(),ctx.RequestAborted);
    if(result is null)return Results.StatusCode(503);
    ctx.Response.Headers.CacheControl="no-store";
    return Results.Json(result);
});
// No genesis/enrollment/recovery/force-update endpoint.
app.Run();

ClientRole? GetRole(HttpContext ctx){
    string? hash=ctx.Connection.ClientCertificate?.GetCertHashString(HashAlgorithmName.SHA256).ToLowerInvariant();
    return hash is not null && clients.TryGetValue(hash,out ClientRole? role)?role:null;
}
static async Task<byte[]?> ReadBody(HttpContext ctx,int max){
    if(ctx.Request.ContentLength is null or < 30 || ctx.Request.ContentLength>max ||
       ctx.Request.ContentType is null ||
       !ctx.Request.ContentType.StartsWith("application/json",StringComparison.OrdinalIgnoreCase))return null;
    byte[] bytes=new byte[checked((int)ctx.Request.ContentLength.Value)];
    try{await ctx.Request.Body.ReadExactlyAsync(bytes,ctx.RequestAborted);return bytes;}
    catch(Exception ex) when(ex is IOException or OperationCanceledException){return null;}
}
static T? ParseExact<T>(byte[] bytes,string[] fields){
    try{
        using JsonDocument d=JsonDocument.Parse(bytes,new JsonDocumentOptions{MaxDepth=5,
            AllowTrailingCommas=false,CommentHandling=JsonCommentHandling.Disallow});
        if(d.RootElement.ValueKind!=JsonValueKind.Object)return default;
        var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(JsonProperty p in d.RootElement.EnumerateObject()){
            if(Array.IndexOf(fields,p.Name)<0 || !seen.Add(p.Name))return default;
            if(p.Name=="Version"){
                if(p.Value.ValueKind!=JsonValueKind.Number || !p.Value.TryGetInt64(out _))return default;
            }else if(p.Name is "Expected" or "Proposed"){
                if(p.Value.ValueKind!=JsonValueKind.Object)return default;
            }else if(p.Value.ValueKind!=JsonValueKind.String)return default;
        }
        if(seen.Count!=fields.Length)return default;
        return JsonSerializer.Deserialize<T>(bytes,new JsonSerializerOptions{
            PropertyNameCaseInsensitive=false,UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow});
    }catch(Exception ex) when(ex is JsonException or ArgumentException){return default;}
}
static byte[] ParseSpki(string b64,string pin){
    byte[] bytes;
    try{bytes=Convert.FromBase64String(b64);}catch(FormatException){throw new InvalidOperationException("AUDIT_SPKI_FORMAT");}
    if(bytes.Length is < 60 or > 256 || Convert.ToBase64String(bytes)!=b64 ||
       !CryptographicOperations.FixedTimeEquals(SHA256.HashData(bytes),Convert.FromHexString(pin)))
        throw new InvalidOperationException("AUDIT_SPKI_PIN");
    using ECDsa key=ECDsa.Create();key.ImportSubjectPublicKeyInfo(bytes,out int n);
    if(n!=bytes.Length || key.KeySize!=256)throw new InvalidOperationException("AUDIT_SPKI_CURVE");
    return bytes;
}
static X509Certificate2 FindMachine(string sha){
    using var store=new X509Store(StoreName.My,StoreLocation.LocalMachine);
    store.Open(OpenFlags.ReadOnly);
    foreach(X509Certificate2 cert in store.Certificates)
        if(cert.GetCertHashString(HashAlgorithmName.SHA256).ToLowerInvariant()==sha)return cert;
    throw new InvalidOperationException("AUDIT_CERT_NOT_FOUND");
}
internal sealed record ClientRole(string CertificateSha256,string Scope,string Role);
internal sealed record AuditConfig(
    string AuditKeyId,string RootKeyId,string RootSpkiBase64,string RootSpkiSha256,
    string Scope,int Port,string ExistingJournalPath,
    string ServerCertificateSha256,string SigningCertificateSha256,
    string SealClientCertificateSha256,string SealTlsCertificateSha256,
    string SealSpkiBase64,string SealSpkiSha256,string SealKeyId,
    string SealCurrentUri,string SealAdvanceUri,ClientRole[] Clients);
