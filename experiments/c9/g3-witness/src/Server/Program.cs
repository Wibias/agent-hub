using System.Net;
using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using AgentHub.C9.G3.Witness;
using Microsoft.AspNetCore.Server.Kestrel.Https;

// Review-only network service: fail closed without independently provisioned certificates
// and independently anchored state source. NEVER loads or creates private keys from files.
string? configPath = Environment.GetEnvironmentVariable("C9_WITNESS_CONFIG_PATH");
if (string.IsNullOrEmpty(configPath) || !Path.IsPathFullyQualified(configPath))
    throw new InvalidOperationException("C9_WITNESS_DENY_MISSING_EXTERNAL_CONFIGURATION");
ServiceConfig cfg = JsonSerializer.Deserialize<ServiceConfig>(File.ReadAllText(configPath),
    new JsonSerializerOptions { PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow })
    ?? throw new InvalidOperationException("C9_WITNESS_DENY_BAD_CONFIG");
if (!WitnessProtocol.IsId(cfg.WitnessId) || !WitnessProtocol.IsId(cfg.WitnessKeyId) ||
    !WitnessProtocol.IsId(cfg.AnchorKeyId) || !WitnessProtocol.IsHex(cfg.AnchorSpkiSha256, 64) ||
    !WitnessProtocol.IsHex(cfg.AnchorTlsCertificateSha256, 64) ||
    !WitnessProtocol.IsHex(cfg.HttpsCertificateSha256, 64) ||
    !WitnessProtocol.IsHex(cfg.SigningCertificateSha256, 64) ||
    !WitnessProtocol.IsHex(cfg.AnchorClientCertificateSha256, 64) ||
    cfg.Port is < 1024 or > 65535 || cfg.Clients is null || cfg.Clients.Count == 0 ||
    cfg.Clients.Count != cfg.Clients.Select(c => c.CertificateSha256).Distinct(StringComparer.Ordinal).Count() ||
    cfg.Clients.Any(c => !WitnessProtocol.IsHex(c.CertificateSha256, 64) ||
                         !WitnessProtocol.IsId(c.Scope) || c.Role != "reader") ||
    cfg.AnchorUri is null || !Uri.TryCreate(cfg.AnchorUri, UriKind.Absolute, out Uri? anchorUri) ||
    anchorUri.Scheme != "https" || !string.IsNullOrEmpty(anchorUri.UserInfo) ||
    anchorUri.Fragment.Length > 0 || anchorUri.Query.Length > 0 ||
    anchorUri.AbsolutePath != "/v1/current")
    throw new InvalidOperationException("C9_WITNESS_DENY_UNSAFE_CONFIG");

byte[] anchorSpki;
try { anchorSpki = Convert.FromBase64String(cfg.AnchorSpkiBase64); }
catch (FormatException) { throw new InvalidOperationException("C9_WITNESS_DENY_BAD_ANCHOR_KEY"); }
if (Convert.ToHexString(SHA256.HashData(anchorSpki)).ToLowerInvariant() != cfg.AnchorSpkiSha256)
    throw new InvalidOperationException("C9_WITNESS_DENY_ANCHOR_KEY_PIN_MISMATCH");
using (ECDsa anchorKey = ECDsa.Create())
{
    anchorKey.ImportSubjectPublicKeyInfo(anchorSpki, out int consumed);
    if (consumed != anchorSpki.Length || anchorKey.KeySize != 256)
        throw new InvalidOperationException("C9_WITNESS_DENY_ANCHOR_KEY_CURVE");
}

X509Certificate2 httpsCert = FindMachineCertificate(cfg.HttpsCertificateSha256);
X509Certificate2 signingCert = FindMachineCertificate(cfg.SigningCertificateSha256);
X509Certificate2 anchorClientCert = FindMachineCertificate(cfg.AnchorClientCertificateSha256);
if (!httpsCert.HasPrivateKey || !signingCert.HasPrivateKey || !anchorClientCert.HasPrivateKey ||
    httpsCert.NotAfter <= DateTime.UtcNow || signingCert.NotAfter <= DateTime.UtcNow ||
    anchorClientCert.NotAfter <= DateTime.UtcNow)
    throw new InvalidOperationException("C9_WITNESS_DENY_CERT_UNAVAILABLE");
using ECDsa signingKey = signingCert.GetECDsaPrivateKey()
    ?? throw new InvalidOperationException("C9_WITNESS_DENY_NO_ECDSA_SIGNER");
if (signingKey.KeySize != 256) throw new InvalidOperationException("C9_WITNESS_DENY_SIGNING_CURVE");
var permissions = cfg.Clients.ToDictionary(c=>c.CertificateSha256, c=>c, StringComparer.Ordinal);

using var anchorHandler = new HttpClientHandler { AllowAutoRedirect = false, CheckCertificateRevocationList = true };
anchorHandler.ClientCertificates.Add(anchorClientCert);
anchorHandler.ServerCertificateCustomValidationCallback = (_, cert, _, errors) =>
    errors == SslPolicyErrors.None && cert is not null &&
    cert.GetCertHashString(HashAlgorithmName.SHA256).ToLowerInvariant() == cfg.AnchorTlsCertificateSha256;
using var anchorHttp = new HttpClient(anchorHandler) { Timeout = TimeSpan.FromSeconds(5) };

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.Limits.MaxRequestBodySize = WitnessProtocol.MaxBodyBytes;
    kestrel.Listen(IPAddress.Any, cfg.Port, endpoint=>endpoint.UseHttps(options=>
    {
        options.ServerCertificate = httpsCert;
        options.ClientCertificateMode = ClientCertificateMode.RequireCertificate;
        options.CheckCertificateRevocation = true;
        options.SslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13;
        options.ClientCertificateValidation = (cert, _, error) =>
            cert is not null && error == SslPolicyErrors.None &&
            permissions.ContainsKey(cert.GetCertHashString(HashAlgorithmName.SHA256).ToLowerInvariant());
    }));
});
builder.WebHost.UseSetting("https_port", cfg.Port.ToString(System.Globalization.CultureInfo.InvariantCulture));
var app = builder.Build();
app.MapPost("/v1/current", async (HttpContext context) =>
{
    string? clientPin = context.Connection.ClientCertificate?
        .GetCertHashString(HashAlgorithmName.SHA256).ToLowerInvariant();
    if (clientPin is null || !permissions.TryGetValue(clientPin, out ClientIdentity? identity))
        return Results.StatusCode(StatusCodes.Status403Forbidden);
    if (context.Request.ContentLength is null or > WitnessProtocol.MaxBodyBytes ||
        context.Request.ContentType is null ||
        !context.Request.ContentType.StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
        return Results.BadRequest();
    byte[] body = new byte[checked((int)context.Request.ContentLength.Value)];
    try { await context.Request.Body.ReadExactlyAsync(body, context.RequestAborted); }
    catch (Exception e) when (e is IOException or OperationCanceledException)
    { return Results.StatusCode(StatusCodes.Status503ServiceUnavailable); }
    ReadRequestV1? request = WitnessProtocol.ParseRead(body);
    if (request is null) return Results.BadRequest();

    // No locally asserted head or checkpoint is ever authoritative.
    string anchorNonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    byte[] query = JsonSerializer.SerializeToUtf8Bytes(new AnchorQueryV1(
        1, "G3_ANCHOR_READ", identity.Scope, anchorNonce));
    try
    {
        using var requestMessage = new HttpRequestMessage(HttpMethod.Post, anchorUri) {
            Content = new ByteArrayContent(query)
        };
        requestMessage.Content.Headers.ContentType = new("application/json");
        using var response = await anchorHttp.SendAsync(requestMessage,
            HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
        if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength is > WitnessProtocol.MaxBodyBytes)
            return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        await using var incoming = await response.Content.ReadAsStreamAsync(context.RequestAborted);
        byte[] anchorBody = new byte[WitnessProtocol.MaxBodyBytes + 1];
        int total = 0;
        while (total < anchorBody.Length)
        {
            int n = await incoming.ReadAsync(anchorBody.AsMemory(total),context.RequestAborted);
            if (n == 0) break;
            total += n;
        }
        if (total > WitnessProtocol.MaxBodyBytes)
            return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        VerifiedHead? anchor = WitnessProtocol.VerifyAnchor(anchorBody.AsSpan(0,total),
            identity.Scope, anchorNonce, cfg.AnchorKeyId, anchorSpki, cfg.AnchorSpkiSha256, now);
        if (anchor is null) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        WitnessHeadV1 signed;
        lock (signingKey)
        {
            signed = WitnessProtocol.SignHead(anchor, request,
                cfg.WitnessId, cfg.WitnessKeyId, signingKey, now);
        }
        context.Response.Headers.CacheControl = "no-store";
        return Results.Json(signed);
    }
    catch (Exception e) when (e is HttpRequestException or IOException or
        TaskCanceledException or OperationCanceledException or CryptographicException or InvalidOperationException)
    {
        return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    }
});
// Intentionally NO AdvanceHead, enrollment, reset, admin or restore endpoint.
app.Run();

static X509Certificate2 FindMachineCertificate(string sha256)
{
    using var store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
    store.Open(OpenFlags.ReadOnly);
    foreach (X509Certificate2 certificate in store.Certificates)
        if (certificate.GetCertHashString(HashAlgorithmName.SHA256).ToLowerInvariant() == sha256)
            return certificate;
    throw new InvalidOperationException("C9_WITNESS_DENY_MACHINE_CERT_NOT_FOUND");
}

internal sealed record ClientIdentity(string CertificateSha256, string Scope, string Role);
internal sealed record ServiceConfig(
    string WitnessId, string WitnessKeyId, int Port,
    string HttpsCertificateSha256, string SigningCertificateSha256,
    string AnchorUri, string AnchorKeyId, string AnchorSpkiBase64,
    string AnchorSpkiSha256, string AnchorTlsCertificateSha256,
    string AnchorClientCertificateSha256, List<ClientIdentity> Clients);
