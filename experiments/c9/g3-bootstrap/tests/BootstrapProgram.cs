using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AgentHub.C9.G3;

// Disposal-only test identities. No production root or issuer keys are created.
using ECDsa rootSigner = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa issuerSigner = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa secondIssuer = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa attacker = ECDsa.Create(ECCurve.NamedCurves.nistP256);
const long now = 1794430800;
static string Digest(byte[] content) => Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
static byte[] Wire(SignedTrustManifestV1 manifest) => JsonSerializer.SerializeToUtf8Bytes(manifest);
RootKeyPin root = new("offline-root-v1", rootSigner.ExportSubjectPublicKeyInfo(),
    Digest(rootSigner.ExportSubjectPublicKeyInfo()));
SignedTrustManifestV1 Create(long revision, ECDsa issuer, string keyId, string keyState = "active")
{
    byte[] issuerSpki = issuer.ExportSubjectPublicKeyInfo();
    return new SignedTrustManifestV1(1, root.RootKeyId, revision, keyId,
        Convert.ToBase64String(issuerSpki), Digest(issuerSpki), keyState,
        now-10, now+3600, "");
}
SignedTrustManifestV1 Sign(SignedTrustManifestV1 unsigned, ECDsa? signer = null)
{
    ECDsa key = signer ?? rootSigner;
    byte[] sig = key.SignData(TrustBootstrap.CanonicalBytes(unsigned),
        HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
    return unsigned with { SignatureBase64 = Convert.ToBase64String(sig) };
}
ProtectedTrustCheckpoint Checkpoint(SignedTrustManifestV1 manifest) =>
    new(manifest.Revision, TrustBootstrap.ManifestSha256(manifest));
TrustBootstrapVerdict Verify(SignedTrustManifestV1 m,
    RootKeyPin? r = null, ProtectedTrustCheckpoint? w = null, long at = now) =>
    TrustBootstrap.Verify(Wire(m), r ?? root, w ?? Checkpoint(m), at);
int passed = 0;
void Check(string name, bool ok)
{
    if (!ok) throw new Exception("G3_BOOTSTRAP_TEST_FAIL " + name);
    Console.WriteLine("PASS " + name);
    passed++;
}
void Deny(string name, TrustBootstrapVerdict r) =>
    Check(name, !r.ManifestVerified && r.VerifiedIssuer is null && !r.CanExecuteCommit);

SignedTrustManifestV1 m1 = Sign(Create(1, issuerSigner, "test-issuer-A"));
var baseline = Verify(m1);
Check("verified active issuer does not grant execution", baseline is {
    ManifestVerified: true, CanExecuteCommit: false,
    VerifiedIssuer: {Revoked:false, KeyId:"test-issuer-A"}
});
Deny("missing root", TrustBootstrap.Verify(Wire(m1), null, Checkpoint(m1), now));
Deny("missing independently supplied checkpoint", TrustBootstrap.Verify(Wire(m1), root, null, now));
Deny("root fingerprint substitution", Verify(m1, r:root with {ExpectedSpkiSha256=new string('a',64)}));
Deny("root key ID substitution", Verify(m1, r:root with {RootKeyId="different-root"}));
Deny("wrong trust revision", Verify(m1, w:Checkpoint(m1) with {Revision=2}));
Deny("checkpoint hash substitution", Verify(m1, w:Checkpoint(m1) with {ManifestSha256=new string('b',64)}));
Deny("issuer pin substitution", Verify(m1 with {IssuerSpkiSha256=new string('c',64)}));
Deny("issuer key ID tampering", Verify(m1 with {IssuerKeyId="other-issuer"}));
Deny("root signature forged", Verify(Sign(Create(1, issuerSigner, "test-issuer-A"), attacker)));
Deny("root key cannot enroll as issuer", Verify(Sign(Create(1, rootSigner, "different-issuer"))));
Deny("root and issuer identities cannot coincide", Verify(Sign(Create(1, issuerSigner, root.RootKeyId))));
Deny("unsupported key status", Verify(Sign(Create(1, issuerSigner, "test-issuer-A", "suspended"))));
Deny("expired trust snapshot", Verify(m1, at:now+3600));
Deny("not yet valid trust snapshot", Verify(m1, at:now-11));
Deny("excessively long validity", Verify(Sign(Create(1, issuerSigner, "test-issuer-A") with {ExpiresUnix=now+31*86400})));
Deny("corrupted signature", Verify(m1 with {SignatureBase64="AAAA"}));
Deny("invalid issuer base64", Verify(m1 with {IssuerPublicKeySpkiBase64="invalid!!"}));
byte[] duplicated = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(Wire(m1)).Replace(
    "\"Version\":1,", "\"Version\":1,\"Version\":1,", StringComparison.Ordinal));
Deny("duplicate JSON member", TrustBootstrap.Verify(duplicated, root, Checkpoint(m1), now));
byte[] unknown = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(Wire(m1)).Replace(
    "\"Version\":1,", "\"Version\":1,\"CanExecuteCommit\":true,", StringComparison.Ordinal));
Deny("unknown privilege property", TrustBootstrap.Verify(unknown, root, Checkpoint(m1), now));
Deny("oversized payload", TrustBootstrap.Verify(new byte[4100], root, Checkpoint(m1), now));
Deny("unsupported schema version", Verify(Sign(Create(1, issuerSigner, "test-issuer-A") with {Version=2})));

// Rotation and revocation: authorization changes ONLY when a separately trusted
// current checkpoint is updated. These tests never write such a checkpoint.
SignedTrustManifestV1 m2 = Sign(Create(2, secondIssuer, "test-issuer-B"));
var rotated = Verify(m2);
Check("root-signed rotation recognized offline", rotated is {
    ManifestVerified:true,CanExecuteCommit:false,VerifiedIssuer:{Revoked:false,KeyId:"test-issuer-B"}
});
Deny("old key snapshot rejected against rotated checkpoint", Verify(m1, w:Checkpoint(m2)));
Deny("new key snapshot rejected against old checkpoint", Verify(m2, w:Checkpoint(m1)));
SignedTrustManifestV1 m3 = Sign(Create(3, secondIssuer, "test-issuer-B", "revoked"));
var revoked = Verify(m3);
Check("root-signed key revocation recognized offline", revoked is {
    ManifestVerified:true, CanExecuteCommit:false, VerifiedIssuer:{Revoked:true,KeyId:"test-issuer-B"}
});
Deny("rotation snapshot rejected after revocation checkpoint", Verify(m2, w:Checkpoint(m3)));
Deny("missing/stale pin never falls back to embedded signature", TrustBootstrap.Verify(Wire(m2),root,new ProtectedTrustCheckpoint(0,new string('0',64)),now));
// A real signed approval remains verifiable under the rotated key but must fail
// after the independently trusted checkpoint switches to the revoked manifest.
string shaA = new('a', 64), shaB = new('b', 64);
var ticket = new ApprovalTicketV2(2, "TestIssuer", "test-issuer-B", shaA,
    new string('c', 32), new string('d', 32), new string('e', 32),
    "replace-v1", "hooks-v1", new string('1',16), new string('2',32),
    shaB, new string('3',64),
    "S-1-5-80-100-200-300-400-500", "S-1-5-80-501-502-503-504-505",
    now-10, now+100, "");
byte[] signedTicket = secondIssuer.SignData(OfflineAuthorization.CanonicalBytes(ticket),
    HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
ticket = ticket with { SignatureBase64 = Convert.ToBase64String(signedTicket) };
byte[] ticketBytes = JsonSerializer.SerializeToUtf8Bytes(ticket);
var observed = new ObservedIntent(ticket.ReleaseSha256, ticket.RequestId, ticket.Operation,
    ticket.TargetId, ticket.TargetVolumeId, ticket.TargetFileId, ticket.PayloadSha256,
    ticket.PreimageSha256, ticket.BrokerServiceSid, ticket.ClientServiceSid, true, true, true);
var activeTicket = OfflineAuthorization.Verify(ticketBytes, observed, rotated.VerifiedIssuer,
    ticket.Issuer, now);
Check("rotated issuer validates signed ticket offline without commit permission",
    activeTicket is {SignatureAndScopeVerified:true,CanExecuteCommit:false});
var revokedTicket = OfflineAuthorization.Verify(ticketBytes, observed, revoked.VerifiedIssuer,
    ticket.Issuer, now);
Check("revoked issuer rejects previously valid ticket", revokedTicket is {
    SignatureAndScopeVerified:false,CanExecuteCommit:false,Reason:"KEY_REVOKED"});
Console.WriteLine($"C9_G3_BOOTSTRAP_TESTS_PASS count={passed} NO_KEY_ENROLLED NO_SCM G3_HOLD PRODUCTION_NO_GO");
