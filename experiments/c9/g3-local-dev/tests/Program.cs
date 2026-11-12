using System.Security.Cryptography;
using System.Text.Json;
using AgentHub.C9.G3;
using AgentHub.C9.G3.Anchor;
using AgentHub.C9.G3.Audit;
using AgentHub.C9.G3.LocalDev;
using AgentHub.C9.G3.Witness;

// Isolated, disposable, in-process integration of the REAL G3 engines and durable journals.
// NO mTLS network listener, broker, production signer, WORM, or write authorization.
const string scope = "g3-local-lab";
const long maxTime = 4102444700;
long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
if (now is < 1577836800 or > maxTime) throw new Exception("INVALID_TEST_CLOCK");
static string Hash(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
using ECDsa rootSigner = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa issuerA = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa issuerB = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa auditSigner = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa anchorSigner = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa witnessSigner = ECDsa.Create(ECCurve.NamedCurves.nistP256);
RootKeyPin root = new("lab-root", rootSigner.ExportSubjectPublicKeyInfo(),
    Hash(rootSigner.ExportSubjectPublicKeyInfo()));
SignedTrustManifestV1 Manifest(long revision, ECDsa issuer, string id, string status = "active")
{
    byte[] spki = issuer.ExportSubjectPublicKeyInfo();
    var unsigned = new SignedTrustManifestV1(1, root.RootKeyId, revision, id,
        Convert.ToBase64String(spki), Hash(spki), status, now - 5, now + 3600, "");
    byte[] sig = rootSigner.SignData(TrustBootstrap.CanonicalBytes(unsigned),
        HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
    return unsigned with { SignatureBase64 = Convert.ToBase64String(sig) };
}
AnchorHead Head(SignedTrustManifestV1 m) => new(scope, 1, m.Revision,
    TrustBootstrap.ManifestSha256(m), root.RootKeyId, m.IssuerKeyId,
    m.IssuerSpkiSha256, m.KeyState == "revoked");
AdvanceRequestV1 Next(AnchorHead old, SignedTrustManifestV1 m, string id, string reason) =>
    new(1, scope, id, old.Epoch, old.Revision, old.ManifestSha256,
        Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(m)), reason, "lab-approval");
AnchorQueryV1 Query() => new(1, "G3_ANCHOR_READ", scope,
    Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant());
int passed = 0;
void Check(string title, bool condition)
{
    if (!condition) throw new Exception("G3_DEV_INTEGRATION_FAILED: " + title);
    passed++;
    Console.WriteLine("PASS " + title);
}

var genesis = Manifest(1, issuerA, "lab-issuer-A");
var rotation = Manifest(2, issuerB, "lab-issuer-B");
var revocation = Manifest(3, issuerB, "lab-issuer-B", "revoked");
var revokedReuse = Manifest(4, issuerB, "lab-issuer-B");
string directory = Path.Combine(Path.GetTempPath(), "agenthub-g3-local-dev-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(directory);
string sealPath = Path.Combine(directory, "seal.dev.journal");
string auditPath = Path.Combine(directory, "audit.dev.journal");
string anchorPath = Path.Combine(directory, "anchor.dev.journal");
byte[] initial = AnchorJournal.EncodeGenesisForOfflineProvisioner(Head(genesis));
try
{
    foreach (string path in new[] { sealPath, auditPath, anchorPath })
        File.WriteAllBytes(path, initial);

    // The production Audit service must never be able to instantiate this test-only adapter.
    Environment.SetEnvironmentVariable("C9_G3_INSECURE_LOCAL_LAB", null);
    bool denied = false;
    try { using var unavailable = new LocalDevSeal(sealPath); }
    catch (InvalidOperationException ex) when (ex.Message == "DEV_SEAL_NOT_AUTHORIZED") { denied = true; }
    Check("local seal requires explicit unsafe test marker", denied);
    Environment.SetEnvironmentVariable("C9_G3_INSECURE_LOCAL_LAB", "EXPLICIT_TEST_ONLY");

    byte[] sealGenesisBackup = File.ReadAllBytes(sealPath);
    using (var seal = new LocalDevSeal(sealPath))
    using (var auditLog = new AnchorJournal(auditPath))
    using (var anchorLog = new AnchorJournal(anchorPath))
    {
        var audit = new AuditEngine(auditLog, seal, root, "lab-audit", auditSigner);
        var bridge = new DevAuditBridge(audit, auditLog, auditSigner.ExportSubjectPublicKeyInfo());
        var anchor = new AnchorEngine(anchorLog, bridge, root, "lab-anchor", anchorSigner);

        var question = Query();
        var receipt = await anchor.GetCurrentAsync(question, now, CancellationToken.None);
        var verified = receipt is null ? null : WitnessProtocol.VerifyAnchor(
            JsonSerializer.SerializeToUtf8Bytes(receipt), scope, question.ChallengeNonce,
            "lab-anchor", anchorSigner.ExportSubjectPublicKeyInfo(),
            Hash(anchorSigner.ExportSubjectPublicKeyInfo()), now);
        Check("genesis reaches signed anchor verification", verified is { Revision: 1 });
        var readRequest = new ReadRequestV1(1, "G3_TRUST_READ", question.ChallengeNonce);
        WitnessHeadV1? signedWitness = verified is null ? null :
            WitnessProtocol.SignHead(verified, readRequest, "lab-witness", "lab-witness-key", witnessSigner, now);
        Check("anchor head reaches genuine witness signature verifier",
            signedWitness is not null && WitnessProtocol.VerifyWitness(
                JsonSerializer.SerializeToUtf8Bytes(signedWitness), scope, question.ChallengeNonce,
                "lab-witness", "lab-witness-key", witnessSigner.ExportSubjectPublicKeyInfo(),
                Hash(witnessSigner.ExportSubjectPublicKeyInfo()), 1, now) is { Revision: 1 });

        var updated = await anchor.AdvanceHeadAsync(
            Next(Head(genesis), rotation, new string('a', 32), "rotate"), now, CancellationToken.None);
        Check("rotation moves local seal audit and anchor journals", updated.Committed &&
            seal.ReadAsync(scope, CancellationToken.None).Result == Head(rotation) &&
            auditLog.Read() == Head(rotation) && anchorLog.Read() == Head(rotation));
        Check("obsolete CAS revision is denied", !(await anchor.AdvanceHeadAsync(
            Next(Head(genesis), rotation, new string('b', 32), "rotate"), now, CancellationToken.None)).Committed);

        var revoked = await anchor.AdvanceHeadAsync(
            Next(Head(rotation), revocation, new string('c', 32), "revoke"), now, CancellationToken.None);
        Check("revocation persists to all journals", revoked.Committed &&
            auditLog.Read() == Head(revocation) && anchorLog.Read() == Head(revocation));
        Check("revoked issuer cannot be restored by normal rotation", !(await anchor.AdvanceHeadAsync(
            Next(Head(revocation), revokedReuse, new string('d', 32), "rotate"), now, CancellationToken.None)).Committed);
    }

    byte[] currentSeal = File.ReadAllBytes(sealPath);
    using (var restartedSeal = new LocalDevSeal(sealPath))
    using (var restartedAudit = new AnchorJournal(auditPath))
    using (var restartedAnchor = new AnchorJournal(anchorPath))
    {
        var audit = new AuditEngine(restartedAudit, restartedSeal, root, "lab-audit", auditSigner);
        var bridge = new DevAuditBridge(audit, restartedAudit, auditSigner.ExportSubjectPublicKeyInfo());
        var anchor = new AnchorEngine(restartedAnchor, bridge, root, "lab-anchor", anchorSigner);
        Check("three durable journals survive reopen after revocation",
            restartedSeal.ReadAsync(scope, CancellationToken.None).Result == Head(revocation) &&
            restartedAudit.Read() == Head(revocation) && restartedAnchor.Read() == Head(revocation));
        Check("restarted anchor still signs current revoked head", (await anchor.GetCurrentAsync(
            Query(), now, CancellationToken.None))?.Revision == 3);
        Check("restarted seal preserves revoked key tombstones", !(await anchor.AdvanceHeadAsync(
            Next(Head(revocation), revokedReuse, new string('e', 32), "rotate"), now, CancellationToken.None)).Committed);
    }

    // Simulated rollback of *only one* disk. This is detection, NOT resistance to
    // an attacker restoring all three files. Do not use as WORM acceptance evidence.
    File.WriteAllBytes(sealPath, sealGenesisBackup);
    using (var rolledSeal = new LocalDevSeal(sealPath))
    using (var localAudit = new AnchorJournal(auditPath))
    using (var localAnchor = new AnchorJournal(anchorPath))
    {
        var audit = new AuditEngine(localAudit, rolledSeal, root, "lab-audit", auditSigner);
        var bridge = new DevAuditBridge(audit, localAudit, auditSigner.ExportSubjectPublicKeyInfo());
        var anchor = new AnchorEngine(localAnchor, bridge, root, "lab-anchor", anchorSigner);
        Check("single-file seal rollback denies audit read", await audit.GetCurrentAsync(
            new AnchorQueryV1(1, "G3_AUDIT_READ", scope, new string('f', 64)),
            now, CancellationToken.None) is null);
        Check("single-file seal rollback denies anchor read", await anchor.GetCurrentAsync(
            Query(), now, CancellationToken.None) is null);
    }
    File.WriteAllBytes(sealPath, currentSeal);
    File.AppendAllText(sealPath, "truncated-entry");
    bool torn = false;
    try { using var damaged = new LocalDevSeal(sealPath); }
    catch (InvalidOperationException) { torn = true; }
    Check("torn persistent seal journal rejects restart", torn);

    Console.WriteLine($"C9_G3_LOCAL_DEV_PASS count={passed} WORM=ABSENT " +
        "TRUST=TEST_ONLY GATES=0/7 G3_HOLD PRODUCTION_NO_GO");
}
finally
{
    Environment.SetEnvironmentVariable("C9_G3_INSECURE_LOCAL_LAB", null);
    Directory.Delete(directory, recursive: true);
}

// Deliberately test-only bridge. The production adapter validates independently
// signed remote receipts and cannot be replaced by this in-process shortcut.
internal sealed class DevAuditBridge(
    AuditEngine audit, IAnchorJournal journal, byte[] auditSpki) : IIndependentAudit
{
    private readonly string auditPin = Convert.ToHexString(SHA256.HashData(auditSpki)).ToLowerInvariant();

    private static bool Matches(VerifiedHead v, AnchorHead h) =>
        v.Scope == h.Scope && v.Epoch == h.Epoch && v.Revision == h.Revision &&
        v.ManifestSha256 == h.ManifestSha256 && v.RootKeyId == h.RootKeyId;

    public async Task<AnchorHead?> GetCurrentAsync(string scope, CancellationToken ct)
    {
        string nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        AnchorReceiptV1? receipt = await audit.GetCurrentAsync(
            new AnchorQueryV1(1, "G3_AUDIT_READ", scope, nonce), now, ct);
        if (receipt is null) return null;
        VerifiedHead? valid = WitnessProtocol.VerifyAnchor(JsonSerializer.SerializeToUtf8Bytes(receipt),
            scope, nonce, "lab-audit", auditSpki, auditPin, now);
        if (valid is null) return null;
        AnchorHead current = journal.Read();
        return Matches(valid, current) ? current : null;
    }

    public async Task<bool> CompareAndAnchorAsync(AnchorHead oldHead, AnchorHead newHead,
        string transitionId, string signedManifestBase64, CancellationToken ct)
    {
        string nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        AnchorReceiptV1? receipt = await audit.CompareAndAnchorAsync(
            new AuditAdvanceWireV1(1, "G3_AUDIT_CAS", nonce, transitionId,
                oldHead, newHead, signedManifestBase64), now, ct);
        if (receipt is null) return false;
        VerifiedHead? valid = WitnessProtocol.VerifyAnchor(JsonSerializer.SerializeToUtf8Bytes(receipt),
            oldHead.Scope, nonce, "lab-audit", auditSpki, auditPin, now);
        return valid is not null && Matches(valid, newHead) && journal.Read() == newHead;
    }
}
