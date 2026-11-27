using System.Security.Cryptography;

namespace MemoryReviewAuthority.LabService;

// Called only after the host has established the restricted SCM identity
// and the protected state directory. No read pipe is needed to own a signer.
internal static class ServiceSigningIdentity
{
    internal static ECDsa OpenOrCreate(string stateRoot)
    {
        var privatePath = Path.Combine(stateRoot, "review-service-signing-key.pk8");
        var publicPath = Path.Combine(stateRoot, "review-service-signing-key.pub.pem");
        var signer = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        try
        {
            var hasPrivate = File.Exists(privatePath);
            var hasPublic = File.Exists(publicPath);
            if (hasPrivate != hasPublic)
                throw new InvalidOperationException("service_signing_identity_incomplete");
            if (hasPrivate)
            {
                foreach (var path in new[] { privatePath, publicPath })
                    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0
                        || new FileInfo(path).Length is < 64 or > 4096)
                        throw new InvalidOperationException("service_signing_identity_invalid");
                var bytes = File.ReadAllBytes(privatePath);
                try
                {
                    signer.ImportPkcs8PrivateKey(bytes, out var read);
                    if (read != bytes.Length
                        || signer.ExportParameters(false).Curve.Oid.Value != "1.2.840.10045.3.1.7"
                        || File.ReadAllText(publicPath) != signer.ExportSubjectPublicKeyInfoPem())
                        throw new InvalidOperationException("service_public_pin_changed");
                }
                finally { CryptographicOperations.ZeroMemory(bytes); }
            }
            else
            {
                using (var file = new FileStream(privatePath, FileMode.CreateNew,
                    FileAccess.Write, FileShare.None))
                {
                    var bytes = signer.ExportPkcs8PrivateKey();
                    try { file.Write(bytes); file.Flush(flushToDisk: true); }
                    finally { CryptographicOperations.ZeroMemory(bytes); }
                }
                using var pin = new FileStream(publicPath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                using var writer = new StreamWriter(pin);
                writer.Write(signer.ExportSubjectPublicKeyInfoPem());
                writer.Flush();
                pin.Flush(flushToDisk: true);
            }
            return signer;
        }
        catch { signer.Dispose(); throw; }
    }
}
