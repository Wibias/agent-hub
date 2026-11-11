using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AgentHub.C9.G3;

// Disposable test issuer. This code is NEVER included in the verifier library or broker.
using ECDsa signer = ECDsa.Create(ECCurve.NamedCurves.nistP256);
byte[] spki = signer.ExportSubjectPublicKeyInfo();
string pin = Convert.ToHexString(SHA256.HashData(spki)).ToLowerInvariant();
TrustedKeySnapshot trust = new("offline-test-issuer", spki, pin, false);
const long now = 1794430800;
string hash1 = new('a', 64), hash2 = new('b', 64);
var ticket = new ApprovalTicketV2(
    2, "IndependentIssuer-v2", trust.KeyId, hash1,
    new string('c', 32), new string('d', 32), new string('e', 32),
    "replace-v1", "hooks-v1", new string('1',16), new string('2',32),
    hash2, new string('3',64),
    "S-1-5-80-100-200-300-400-500", "S-1-5-80-501-502-503-504-505", now-10, now+100, "");
var observed = new ObservedIntent(ticket.ReleaseSha256, ticket.RequestId, ticket.Operation,
    ticket.TargetId, ticket.TargetVolumeId, ticket.TargetFileId, ticket.PayloadSha256,
    ticket.PreimageSha256, ticket.BrokerServiceSid, ticket.ClientServiceSid, true, true, true);
ApprovalTicketV2 Signed(ApprovalTicketV2 t)
{
    byte[] signature = signer.SignData(OfflineAuthorization.CanonicalBytes(t),
        HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
    return t with { SignatureBase64 = Convert.ToBase64String(signature) };
}
byte[] Wire(ApprovalTicketV2 t) => JsonSerializer.SerializeToUtf8Bytes(t);
var good = Signed(ticket);
OfflineVerdict Verify(ApprovalTicketV2 t, ObservedIntent? o=null, TrustedKeySnapshot? k=null, long when=now) =>
    OfflineAuthorization.Verify(Wire(t), o ?? observed, k ?? trust, ticket.Issuer, when);
int count = 0;
void Check(string title, bool ok)
{
    if (!ok) throw new Exception("G3_TEST_FAIL " + title);
    Console.WriteLine("PASS " + title);
    count++;
}
void Denies(string title, OfflineVerdict result) => Check(title, !result.SignatureAndScopeVerified && !result.CanExecuteCommit);
Check("positive offline signature only", Verify(good) is {SignatureAndScopeVerified:true,CanExecuteCommit:false});
Denies("missing trust", OfflineAuthorization.Verify(Wire(good), observed, null, ticket.Issuer, now));
Denies("key revoked", Verify(good, k:trust with {Revoked=true}));
Denies("public key pin swap", Verify(good, k:trust with {ExpectedSpkiSha256=new string('f',64)}));
Denies("wrong key identifier", Verify(good, k:trust with {KeyId="other-key"}));
Denies("wrong payload", Verify(good, o: observed with {PayloadSha256=hash1}));
Denies("wrong release", Verify(good, o:observed with {ReleaseSha256=hash2}));
Denies("wrong volume", Verify(good, o:observed with {TargetVolumeId=new string('0',16)}));
Denies("wrong file ID", Verify(good, o:observed with {TargetFileId=new string('0',32)}));
Denies("wrong request ID", Verify(good, o:observed with {RequestId=new string('0',32)}));
Denies("unverified peer token", Verify(good, o:observed with {ClientTokenChecked=false}));
Denies("impersonation not reverted", Verify(good, o:observed with {ImpersonationReverted=false}));
Denies("expired", Verify(good, when:now+100));
Denies("not yet valid", Verify(good, when:now-11));
Denies("overlong ticket validity", Verify(Signed(ticket with {ExpiresUnix=now+301})));
Denies("forged payload signature", Verify(good with {PayloadSha256=hash1}));
Denies("invalid signature base64", Verify(good with {SignatureBase64="!"}));
byte[] duplicate = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(Wire(good)).Replace("\"Version\":2,", "\"Version\":2,\"Version\":2,", StringComparison.Ordinal));
Denies("duplicate JSON key", OfflineAuthorization.Verify(duplicate, observed, trust, ticket.Issuer, now));
byte[] extra = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(Wire(good)).Replace("\"Version\":2,", "\"Version\":2,\"CanExecuteCommit\":true,", StringComparison.Ordinal));
Denies("unknown JSON property", OfflineAuthorization.Verify(extra, observed, trust, ticket.Issuer, now));
Denies("oversize ticket", OfflineAuthorization.Verify(new byte[5000], observed, trust, ticket.Issuer, now));
Denies("legacy version", Verify(Signed(ticket with {Version=1})));
Denies("missing required property", OfflineAuthorization.Verify(Encoding.UTF8.GetBytes("{}"), observed, trust, ticket.Issuer, now));
Check("repeat signature never becomes execution grant", Verify(good) is {CanExecuteCommit:false});
Console.WriteLine($"C9_G3_OFFLINE_TESTS_PASS count={count} production=NO_GO gates=0/7");
