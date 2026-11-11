using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AgentHub.C9.G3.Witness;

using ECDsa anchor = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa witness = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa attacker = ECDsa.Create(ECCurve.NamedCurves.nistP256);
byte[] anchorSpki = anchor.ExportSubjectPublicKeyInfo();
byte[] witnessSpki = witness.ExportSubjectPublicKeyInfo();
string Pin(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();
const long now = 1794430800;
const string scope = "lab.install.01", anchorId = "anchor-test", witnessId="witness-test", witnessKeyId="witness-sign-test";
string nonce = new('a',64), anchorNonce = new('b',64), hash = new('c',64);
var query = new ReadRequestV1(1, "G3_TRUST_READ", nonce);
byte[] Wire<T>(T value) => JsonSerializer.SerializeToUtf8Bytes(value);
AnchorReceiptV1 SignAnchor(AnchorReceiptV1 a, ECDsa? signer=null)
{
    byte[] signature = (signer??anchor).SignData(WitnessProtocol.AnchorCanonical(a),
        HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence);
    return a with {SignatureBase64=Convert.ToBase64String(signature)};
}
var signedAnchor = SignAnchor(new AnchorReceiptV1(
    1,anchorId,scope,1,7,hash,"root-test",anchorNonce,now-1,now+20,""));
VerifiedHead? CheckAnchor(AnchorReceiptV1 r, string requestNonce= "", string requestScope=scope,
    byte[]? pub=null, string? pin=null, long at=now) =>
    WitnessProtocol.VerifyAnchor(Wire(r),requestScope,
        requestNonce.Length>0?requestNonce:anchorNonce,anchorId,
        pub??anchorSpki,pin??Pin(anchorSpki),at);
int passed=0;
void Check(string name, bool condition)
{
    if (!condition) throw new InvalidOperationException("WITNESS_TEST_FAIL: " + name);
    Console.WriteLine("PASS "+name);
    passed++;
}
var read = WitnessProtocol.ParseRead(Wire(query));
Check("strict read request", read==query);
Check("bad read purpose",WitnessProtocol.ParseRead(Wire(query with {Purpose="G3_TRUST_WRITE"})) is null);
Check("bad read nonce",WitnessProtocol.ParseRead(Wire(query with {ChallengeNonce="ABC"})) is null);
byte[] unknown = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(Wire(query)).Replace(
    ""Version":1", ""Extra":1,"Version":1",StringComparison.Ordinal));
Check("unknown request property", WitnessProtocol.ParseRead(unknown) is null);
byte[] duplicate = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(Wire(query)).Replace(
    ""Version":1", ""Version":1,"Version":1",StringComparison.Ordinal));
Check("duplicate request property",WitnessProtocol.ParseRead(duplicate) is null);
Check("oversized request",WitnessProtocol.ParseRead(new byte[5000]) is null);
var verified = CheckAnchor(signedAnchor);
Check("anchor signed current accepted",verified is {Epoch:1,Revision:7,Scope:scope});
Check("anchor wrong nonce denied",CheckAnchor(signedAnchor,requestNonce:new string('d',64)) is null);
Check("anchor wrong scope denied",CheckAnchor(signedAnchor,requestScope:"another.install") is null);
Check("anchor wrong SPKI pin denied",CheckAnchor(signedAnchor,pin:new string('f',64)) is null);
Check("anchor old revision tamper denied",CheckAnchor(signedAnchor with {Revision=6}) is null);
Check("anchor root tamper denied",CheckAnchor(signedAnchor with {RootKeyId="root-other"}) is null);
Check("anchor forged signer denied",CheckAnchor(SignAnchor(signedAnchor with {SignatureBase64=""},attacker)) is null);
Check("anchor expired denied",CheckAnchor(signedAnchor,at:now+21) is null);
Check("anchor time too far in future denied",CheckAnchor(signedAnchor with {IssuedAtUnix=now+6}) is null);
Check("anchor window too long denied",CheckAnchor(SignAnchor(signedAnchor with {ExpiresAtUnix=now+40,SignatureBase64=""})) is null);
byte[] extraAnchor=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(Wire(signedAnchor)).Replace(
    ""Version":1", ""CanExecuteCommit":true,"Version":1",StringComparison.Ordinal));
Check("extra privilege field denied", WitnessProtocol.VerifyAnchor(extraAnchor,scope,anchorNonce,anchorId,
    anchorSpki,Pin(anchorSpki),now) is null);
var signedWitness = WitnessProtocol.SignHead(verified!, query,witnessId,witnessKeyId,witness,now);
VerifiedHead? CheckWitness(WitnessHeadV1 w, string requestNonce="", long epoch=1,
    string requestScope=scope,byte[]? pub=null,string? pin=null,long at=now) =>
    WitnessProtocol.VerifyWitness(Wire(w),requestScope,
        requestNonce.Length>0?requestNonce:nonce,witnessId,witnessKeyId,
        pub??witnessSpki,pin??Pin(witnessSpki),epoch,at);
Check("witness signs verified anchor only",CheckWitness(signedWitness) is {Revision:7,Epoch:1});
Check("witness wrong nonce denied",CheckWitness(signedWitness,requestNonce:new string('e',64)) is null);
Check("witness wrong scope denied",CheckWitness(signedWitness,requestScope:"other") is null);
Check("witness wrong epoch denied",CheckWitness(signedWitness,epoch:2) is null);
Check("witness signature tampering denied",CheckWitness(signedWitness with {ManifestSha256:new string('a',64)}) is null);
Check("witness pin substitution denied",CheckWitness(signedWitness,pin:new string('f',64)) is null);
Check("witness expiry denied",CheckWitness(signedWitness,at:now+16) is null);
Check("read response cannot grant execution",typeof(WitnessHeadV1).GetProperty("CanExecuteCommit") is null);
Console.WriteLine($"C9_G3_WITNESS_CONTRACT_PASS count={passed} NO_DEPLOYMENT NO_ADVANCE NO_KEYS_PROVISIONED G3_HOLD PRODUCTION_NO_GO");
