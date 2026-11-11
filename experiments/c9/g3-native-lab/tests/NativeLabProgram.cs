using System;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Text.Json;
using AgentHub.C9.G3;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

// Lab only: HKLM mutations require an empty AgentHub subtree on a disposable hosted runner.
if (!OperatingSystem.IsWindows() || !Environment.Is64BitProcess ||
    Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
    Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
    Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows" ||
    Environment.GetEnvironmentVariable("GITHUB_REPOSITORY") != "Wibias/agent-hub" ||
    Environment.GetEnvironmentVariable("AGENTHUB_C9_G3_HKLM_LAB") != "DISPOSABLE_RUNNER_ONLY")
    throw new InvalidOperationException("C9_NATIVE_LAB_DENY_UNTRUSTED_EXECUTION_ENVIRONMENT");

const string parent = @"SOFTWARE\AgentHub";
const string leaf = @"SOFTWARE\AgentHub\C9\G3\Trust";
const string secure = "O:BAG:BAD:P(A;;KA;;;SY)(A;;KA;;;BA)";
const string loose = "O:BAG:BAD:P(A;;KA;;;SY)(A;;KA;;;BA)(A;;KR;;;AU)";
string marker = "C9-G3-DISPOSABLE-" + Guid.NewGuid().ToString("N");
int count = 0;
void Check(string label, bool success)
{
    if (!success) throw new InvalidOperationException("C9_NATIVE_LAB_FAIL " + label);
    count++;
    Console.WriteLine("PASS " + label);
}

using RegistryKey hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
using (RegistryKey? existing = hklm.OpenSubKey(parent, writable:false))
{
    if (existing is not null)
        throw new InvalidOperationException("C9_NATIVE_LAB_DENY_PREEXISTING_AGENTHUB_HKLM_BRANCH");
}
using ECDsa rootSigner = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa issuerA = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa issuerB = ECDsa.Create(ECCurve.NamedCurves.nistP256);
static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
byte[] rootSpki = rootSigner.ExportSubjectPublicKeyInfo();
var rootPin = new RootKeyPin("c9-native-lab-root", rootSpki, Sha(rootSpki));
long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
SignedTrustManifestV1 Create(long revision, ECDsa issuer, string issuerId)
{
    byte[] pub = issuer.ExportSubjectPublicKeyInfo();
    var unsigned = new SignedTrustManifestV1(1, rootPin.RootKeyId, revision, issuerId,
        Convert.ToBase64String(pub), Sha(pub), "active", now - 30, now + 3600, "");
    byte[] signature = rootSigner.SignData(TrustBootstrap.CanonicalBytes(unsigned),
        HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
    return unsigned with { SignatureBase64 = Convert.ToBase64String(signature) };
}
SignedTrustManifestV1 v1 = Create(1, issuerA, "native-lab-issuer-a");
SignedTrustManifestV1 v2 = Create(2, issuerB, "native-lab-issuer-b");
static ProtectedTrustCheckpoint Witness(SignedTrustManifestV1 m) =>
    new(m.Revision, TrustBootstrap.ManifestSha256(m));
static byte[] Wire(SignedTrustManifestV1 m) => JsonSerializer.SerializeToUtf8Bytes(m);
ProtectedTrustCheckpoint witness1 = Witness(v1);
ProtectedTrustCheckpoint witness2 = Witness(v2);
RegistryKey? writable = null;
bool created = false;
try
{
    using (RegistryKey? root = hklm.CreateSubKey(parent, writable: true))
    {
        if (root is null) throw new InvalidOperationException("C9_NATIVE_LAB_CREATE_ROOT_FAILED");
        created = true;
        root.SetValue("LabMarker", marker, RegistryValueKind.String);
    }
    RegistryKey key = hklm.CreateSubKey(leaf, writable:true)
        ?? throw new InvalidOperationException("C9_NATIVE_LAB_CREATE_LEAF_FAILED");
    writable = key;
    void ApplyManifest(SignedTrustManifestV1 m)
    {
        key.SetValue("RootKeyId",rootPin.RootKeyId, RegistryValueKind.String);
        key.SetValue("RootSpkiBase64", Convert.ToBase64String(rootPin.PublicKeySpkiDer), RegistryValueKind.String);
        key.SetValue("RootSpkiSha256",rootPin.ExpectedSpkiSha256,RegistryValueKind.String);
        key.SetValue("Revision",m.Revision,RegistryValueKind.QWord);
        key.SetValue("ManifestSha256",TrustBootstrap.ManifestSha256(m), RegistryValueKind.String);
        key.Flush();
    }
    WindowsTrustStoreVerdict Verify(SignedTrustManifestV1 m, RootKeyPin? pinned, ProtectedTrustCheckpoint? witness) =>
        WindowsTrustStore.VerifyReadOnly(Wire(m), pinned, witness, now);

    ApplyManifest(v1);
    NativeRegistryAcl.Set(hklm.Handle, leaf, secure);
    var valid1 = Verify(v1, rootPin, witness1);
    Check("real HKLM Registry64 signed manifest and strict ACL accepted",
        valid1 is { AnchorAndCheckpointMatch:true, ManifestVerified:true, CanExecuteCommit:false,
            VerifiedIssuer:{ KeyId:"native-lab-issuer-a", Revoked:false } });
    Check("missing external checkpoint fails closed",
        Verify(v1, rootPin, null) is { CanExecuteCommit:false, AnchorAndCheckpointMatch:false });
    Check("missing external root fails closed",
        Verify(v1, null, witness1) is { CanExecuteCommit:false, AnchorAndCheckpointMatch:false });

    ApplyManifest(v2);
    Check("native registry advances to revision 2 only with matching witness",
        Verify(v2, rootPin, witness2) is { AnchorAndCheckpointMatch:true, ManifestVerified:true,
            VerifiedIssuer:{ KeyId:"native-lab-issuer-b" }, CanExecuteCommit:false });
    Check("old witness rejected after local revision advances",
        Verify(v2, rootPin, witness1) is { AnchorAndCheckpointMatch:false, CanExecuteCommit:false });
    ApplyManifest(v1);
    Check("rollback of both local revision and hash rejected against newer witness",
        Verify(v1, rootPin, witness2) is { AnchorAndCheckpointMatch:false, CanExecuteCommit:false });
    ApplyManifest(v2);
    Check("current witness still accepts recovered revision 2",
        Verify(v2, rootPin, witness2) is { AnchorAndCheckpointMatch:true, ManifestVerified:true, CanExecuteCommit:false });

    try
    {
        NativeRegistryAcl.Set(hklm.Handle, leaf, loose);
        Check("real HKLM Authenticated Users read ACE is rejected",
            Verify(v2, rootPin, witness2) is { AnchorAndCheckpointMatch:false, CanExecuteCommit:false, Reason:"REGISTRY_ACL_DENIED" });
    }
    finally { NativeRegistryAcl.Set(hklm.Handle, leaf, secure); }
    Check("restored secure ACL accepted",
        Verify(v2, rootPin, witness2) is { AnchorAndCheckpointMatch:true, ManifestVerified:true, CanExecuteCommit:false });
    try
    {
        key.SetValue("ExtraUntrusted", "deny", RegistryValueKind.String);
        Check("extra native registry value rejected",
            Verify(v2, rootPin, witness2) is { AnchorAndCheckpointMatch:false, CanExecuteCommit:false });
    }
    finally { key.DeleteValue("ExtraUntrusted", throwOnMissingValue:false); }
    Check("restored typed values accepted",
        Verify(v2, rootPin, witness2) is { AnchorAndCheckpointMatch:true, ManifestVerified:true, CanExecuteCommit:false });
    Console.WriteLine($"C9_G3_NATIVE_HKLM_LAB_TESTS_PASS count={count} WITNESS=SIMULATED_IN_PROCESS G3_HOLD PRODUCTION_NO_GO");
}
finally
{
    writable?.Dispose();
    if (created)
    {
        using RegistryKey? owned = hklm.OpenSubKey(parent, writable:false);
        bool mine = owned is not null &&
            owned.GetValueKind("LabMarker") == RegistryValueKind.String &&
            string.Equals(owned.GetValue("LabMarker") as string, marker, StringComparison.Ordinal) &&
            owned.GetSubKeyNames() is ["C9"] && owned.GetValueNames() is ["LabMarker"];
        owned?.Dispose();
        if (!mine) throw new InvalidOperationException("C9_NATIVE_LAB_CLEANUP_DENIED_MARKER_OR_TREE_CHANGED");
        hklm.DeleteSubKeyTree(parent, throwOnMissingSubKey:false);
        using RegistryKey? after = hklm.OpenSubKey(parent, writable:false);
        if (after is not null) throw new InvalidOperationException("C9_NATIVE_LAB_CLEANUP_FAILED");
        Console.WriteLine("C9_G3_NATIVE_HKLM_LAB_CLEANUP_PASS");
    }
}

internal static class NativeRegistryAcl
{
    private const uint OwnerAndDaclSecurityInformation = 0x00000001 | 0x00000004;
    private const uint KeyAllAccess = 0x000F003F;
    private const uint KeyWow64_64Key = 0x00000100;
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, EntryPoint="RegOpenKeyExW", ExactSpelling=true)]
    private static extern int RegOpenKeyEx(
        SafeRegistryHandle baseHandle, string subKey, uint options,
        uint access, out SafeRegistryHandle handle);
    [DllImport("advapi32.dll", ExactSpelling=true)]
    private static extern int RegSetKeySecurity(
        SafeRegistryHandle handle, uint securityInformation, byte[] descriptor);

    internal static void Set(SafeRegistryHandle baseHandle, string path, string sddl)
    {
        // RegistryKey.CreateSubKey's writable handle does not imply WRITE_DAC/WRITE_OWNER.
        int openError = RegOpenKeyEx(baseHandle, path, 0,
            KeyAllAccess | KeyWow64_64Key, out SafeRegistryHandle aclHandle);
        if (openError != 0) throw new InvalidOperationException("C9_NATIVE_LAB_OPEN_SECURITY_HANDLE_FAILED_WIN32_" + openError);
        using (aclHandle)
        {
            RawSecurityDescriptor sd = new(sddl);
            byte[] bytes = new byte[sd.BinaryLength];
            sd.GetBinaryForm(bytes, 0);
            int error = RegSetKeySecurity(aclHandle, OwnerAndDaclSecurityInformation, bytes);
            if (error != 0) throw new InvalidOperationException("C9_NATIVE_LAB_SET_SECURITY_FAILED_WIN32_" + error);
        }
    }
}
