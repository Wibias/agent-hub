using System;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Text;
using AgentHub.C9.G3;

// No registry writes, enrollment, issuer provisioning, or service operations.
// All security descriptors are ephemeral in-memory test data.
int tests = 0;
void Check(string name, bool ok)
{
    if (!ok) throw new Exception("C9_WINDOWS_TRUSTSTORE_TEST_FAILED " + name);
    Console.WriteLine("PASS " + name);
    tests++;
}
byte[] Descriptor(string sddl)
{
    var sd = new RawSecurityDescriptor(sddl);
    byte[] b = new byte[sd.BinaryLength];
    sd.GetBinaryForm(b, 0);
    return b;
}
const string secure = "O:SYG:SYD:P(A;;KA;;;SY)(A;;KA;;;BA)";
Check("strict SYSTEM and Administrators ACL accepted", WindowsTrustStore.IsProtectedSecurityDescriptor(Descriptor(secure)));
Check("missing DACL rejected", !WindowsTrustStore.IsProtectedSecurityDescriptor(Descriptor("O:SYG:SY")));
Check("inherited DACL rejected", !WindowsTrustStore.IsProtectedSecurityDescriptor(Descriptor("O:SYG:SYD:(A;;KA;;;SY)(A;;KA;;;BA)")));
Check("untrusted owner rejected", !WindowsTrustStore.IsProtectedSecurityDescriptor(Descriptor("O:BUG:SYD:P(A;;KA;;;SY)(A;;KA;;;BA)")));
Check("Users write ACE rejected", !WindowsTrustStore.IsProtectedSecurityDescriptor(Descriptor(secure + "(A;;KW;;;BU)")));
Check("Everyone read ACE rejected", !WindowsTrustStore.IsProtectedSecurityDescriptor(Descriptor(secure + "(A;;KR;;;WD)")));
Check("Authenticated users read ACE rejected", !WindowsTrustStore.IsProtectedSecurityDescriptor(Descriptor(secure + "(A;;KR;;;AU)")));
Check("Admins must have full control", !WindowsTrustStore.IsProtectedSecurityDescriptor(Descriptor("O:SYG:SYD:P(A;;KA;;;SY)(A;;KR;;;BA)")));
Check("SYSTEM must have full control", !WindowsTrustStore.IsProtectedSecurityDescriptor(Descriptor("O:SYG:SYD:P(A;;KR;;;SY)(A;;KA;;;BA)")));
Check("unexpected deny ACE rejected", !WindowsTrustStore.IsProtectedSecurityDescriptor(Descriptor(secure + "(D;;KW;;;BU)")));
Check("duplicate admin ACE rejected", !WindowsTrustStore.IsProtectedSecurityDescriptor(Descriptor("O:SYG:SYD:P(A;;KA;;;SY)(A;;KA;;;BA)(A;;KA;;;BA)")));
Check("garbled descriptor rejected", !WindowsTrustStore.IsProtectedSecurityDescriptor(new byte[]{1,2,3}));

using ECDsa ephemeralRoot = ECDsa.Create(ECCurve.NamedCurves.nistP256);
byte[] pub = ephemeralRoot.ExportSubjectPublicKeyInfo();
string Sha(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();
var root = new RootKeyPin("test-root", pub, Sha(pub));
var witness = new ProtectedTrustCheckpoint(5, new string('a', 64));
var local = new RegistryTrustValues(root.RootKeyId, Convert.ToBase64String(pub), root.ExpectedSpkiSha256, witness.Revision, witness.ManifestSha256);
bool Valid(RegistryTrustValues? r= null, RootKeyPin? p = null, ProtectedTrustCheckpoint? w = null) =>
    WindowsTrustStore.MatchesExternalWitness(r??local, p??root, w??witness);
Check("matching independently supplied root and revision accepted", Valid());
Check("missing externally pinned root rejected", !WindowsTrustStore.MatchesExternalWitness(local, null, witness));
Check("missing external checkpoint rejected", !WindowsTrustStore.MatchesExternalWitness(local, root, null));
Check("old registry revision denied", !Valid(r:local with {Revision=4}));
Check("future registry revision denied until witness advances", !Valid(r:local with {Revision=6}));
Check("same revision different checkpoint hash denied", !Valid(r:local with {ManifestSha256=new string('b',64)}));
Check("malformed local hash denied", !Valid(r:local with {ManifestSha256=new string('A',64)}));
Check("root ID substitution denied", !Valid(r:local with {RootKeyId="substituted"}));
Check("SPKI digest substitution denied", !Valid(r:local with {RootSpkiSha256=new string('b',64)}));
Check("bad public key base64 denied", !Valid(r:local with {RootSpkiBase64="!"}));
Check("uncanonical base64 denied", !Valid(r:local with {RootSpkiBase64=local.RootSpkiBase64+"\n"}));
using ECDsa attacker = ECDsa.Create(ECCurve.NamedCurves.nistP256);
Check("different root key at same claimed pin denied", !Valid(r:local with {RootSpkiBase64=Convert.ToBase64String(attacker.ExportSubjectPublicKeyInfo())}));
Check("independently pinned root SHA substitution denied", !Valid(p:root with {ExpectedSpkiSha256=new string('b',64)}));
Check("replayed witness with advanced registry rejected", !Valid(r:local with {Revision=6},w:new ProtectedTrustCheckpoint(5,witness.ManifestSha256)));
Check("exact empty or absent values denied", !Valid(r:local with {RootKeyId=""}));
Check("rollback of both local values is not sufficient", !Valid(r:local with {Revision=4,ManifestSha256=new string('f',64)}));

// The production key does not exist in the ephemeral runner. Do not create it.
var missingWitness = WindowsTrustStore.VerifyReadOnly(Array.Empty<byte>(), root, null, 1794430800);
Check("missing out-of-band witness prevents any registry trust", missingWitness is {CanExecuteCommit:false,AnchorAndCheckpointMatch:false,ManifestVerified:false});
var absentOrMismatched = WindowsTrustStore.VerifyReadOnly(Array.Empty<byte>(), root, witness, 1794430800);
Check("no provisioned matching store or signed manifest means deny", absentOrMismatched is {CanExecuteCommit:false,ManifestVerified:false});
Console.WriteLine($"C9_G3_WINDOWS_STORE_TESTS_PASS count={tests} NO_REGISTRY_WRITE NO_SCM NO_KEY_ENROLLMENT G3_HOLD PRODUCTION_NO_GO");
