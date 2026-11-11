using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace AgentHub.C9.G3;

// Read-only Windows anchor consumer. No registry creation, enrollment, signing, or service APIs.
// A local registry revision is NOT a monotonic witness. A separately authenticated
// exact checkpoint is mandatory; the caller must establish its origin and freshness.
public sealed record RegistryTrustValues(
    string RootKeyId, string RootSpkiBase64, string RootSpkiSha256,
    long Revision, string ManifestSha256);

public readonly record struct WindowsTrustStoreVerdict(
    string Reason, bool AnchorAndCheckpointMatch, bool ManifestVerified,
    TrustedKeySnapshot? VerifiedIssuer, bool CanExecuteCommit)
{
    public static WindowsTrustStoreVerdict Deny(string reason) =>
        new(reason, false, false, null, false);
}

public static class WindowsTrustStore
{
    public const string RegistryPath = @"SOFTWARE\AgentHub\C9\G3\Trust";
    private const int ErrorInsufficientBuffer = 122;
    private const uint OwnerAndDaclSecurityInformation = 0x00000001 | 0x00000004;
    private const int RegistryFullControlMask = 0x000F003F;
    private static readonly SecurityIdentifier SystemSid = new("S-1-5-18");
    private static readonly SecurityIdentifier AdministratorsSid = new("S-1-5-32-544");
    private static readonly HashSet<string> ValueNames = new(StringComparer.Ordinal) {
        "RootKeyId", "RootSpkiBase64", "RootSpkiSha256", "Revision", "ManifestSha256"
    };

    [DllImport("advapi32.dll", ExactSpelling = true)]
    private static extern int RegGetKeySecurity(
        SafeRegistryHandle hKey, uint securityInformation,
        byte[]? securityDescriptor, ref uint securityDescriptorLength);

    // Strict, intentionally narrow ACL contract for the dedicated review-only key.
    // Only SYSTEM and built-in Administrators may be explicit full-control ACEs.
    // No user, interactive, authenticated-users or service SID grants are accepted.
    // This deliberately does not enroll a broker service into the trust boundary.
    public static bool IsProtectedSecurityDescriptor(ReadOnlySpan<byte> raw)
    {
        if (raw.Length is < 40 or > 8192) return false;
        try
        {
            var security = new RawSecurityDescriptor(raw.ToArray(), 0);
            if (security.Owner is null ||
                !(security.Owner.Equals(SystemSid) || security.Owner.Equals(AdministratorsSid)) ||
                (security.ControlFlags & ControlFlags.DiscretionaryAclPresent) == 0 ||
                (security.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0 ||
                security.DiscretionaryAcl is null || security.DiscretionaryAcl.Count != 2)
                return false;

            bool hasSystem = false, hasAdministrators = false;
            foreach (GenericAce ace in security.DiscretionaryAcl)
            {
                if (ace is not CommonAce entry || entry.AceQualifier != AceQualifier.AccessAllowed ||
                    entry.AceFlags != AceFlags.None || entry.SecurityIdentifier is null ||
                    entry.AccessMask != RegistryFullControlMask)
                    return false;
                if (entry.SecurityIdentifier.Equals(SystemSid))
                {
                    if (hasSystem) return false;
                    hasSystem = true;
                }
                else if (entry.SecurityIdentifier.Equals(AdministratorsSid))
                {
                    if (hasAdministrators) return false;
                    hasAdministrators = true;
                }
                else return false;
            }
            return hasSystem && hasAdministrators;
        }
        catch (Exception e) when (e is ArgumentException or InvalidOperationException)
        {
            return false;
        }
    }

    private static byte[]? ReadKeyDescriptor(SafeRegistryHandle handle)
    {
        uint required = 0;
        int status = RegGetKeySecurity(handle, OwnerAndDaclSecurityInformation, null, ref required);
        if (status != ErrorInsufficientBuffer || required is < 40 or > 8192) return null;
        byte[] data = new byte[checked((int)required)];
        status = RegGetKeySecurity(handle, OwnerAndDaclSecurityInformation, data, ref required);
        if (status != 0 || required != data.Length) return null;
        return data;
    }

    private static RegistryTrustValues? ReadTypedValues(RegistryKey key)
    {
        var names = key.GetValueNames();
        if (names.Length != ValueNames.Count) return null;
        foreach (string name in names) if (!ValueNames.Contains(name)) return null;
        foreach (string name in ValueNames)
        {
            RegistryValueKind expected = name == "Revision"
                ? RegistryValueKind.QWord : RegistryValueKind.String;
            if (key.GetValueKind(name) != expected) return null;
        }
        return new RegistryTrustValues(
            (string)key.GetValue("RootKeyId")!,
            (string)key.GetValue("RootSpkiBase64")!,
            (string)key.GetValue("RootSpkiSha256")!,
            (long)key.GetValue("Revision")!,
            (string)key.GetValue("ManifestSha256")!);
    }

    private static bool IsHex64(string? value)
    {
        if (value is null || value.Length != 64) return false;
        foreach (char c in value)
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        return true;
    }

    // Pure value-level contract. This function never treats a registry value as
    // evidence that its own external trust pin or checkpoint is authentic.
    public static bool MatchesExternalWitness(
        RegistryTrustValues? local, RootKeyPin? externalRoot,
        ProtectedTrustCheckpoint? externalCheckpoint)
    {
        if (local is null || externalRoot is null || externalCheckpoint is null ||
            local.RootKeyId != externalRoot.RootKeyId ||
            local.Revision < 1 || local.Revision != externalCheckpoint.Revision ||
            !IsHex64(local.RootSpkiSha256) || !IsHex64(local.ManifestSha256) ||
            !IsHex64(externalRoot.ExpectedSpkiSha256) ||
            !IsHex64(externalCheckpoint.ManifestSha256) ||
            local.RootSpkiSha256 != externalRoot.ExpectedSpkiSha256 ||
            local.ManifestSha256 != externalCheckpoint.ManifestSha256 ||
            externalRoot.PublicKeySpkiDer is null ||
            externalRoot.PublicKeySpkiDer.Length is < 60 or > 256 ||
            local.RootSpkiBase64 is null || local.RootSpkiBase64.Length is < 80 or > 344)
            return false;
        try
        {
            byte[] decoded = Convert.FromBase64String(local.RootSpkiBase64);
            if (Convert.ToBase64String(decoded) != local.RootSpkiBase64 ||
                !CryptographicOperations.FixedTimeEquals(decoded, externalRoot.PublicKeySpkiDer))
                return false;
            string digest = Convert.ToHexString(SHA256.HashData(decoded)).ToLowerInvariant();
            return digest == externalRoot.ExpectedSpkiSha256;
        }
        catch (FormatException) { return false; }
    }

    // The only OS integration. The hardcoded HKLM Registry64 path is NEVER
    // created or modified. A failure is always a rejection, never a fallback.
    public static WindowsTrustStoreVerdict VerifyReadOnly(
        ReadOnlySpan<byte> signedManifest, RootKeyPin? externallyPinnedRoot,
        ProtectedTrustCheckpoint? externallyAuthenticatedCheckpoint, long nowUnix)
    {
        if (!OperatingSystem.IsWindows() || !Environment.Is64BitProcess)
            return WindowsTrustStoreVerdict.Deny("WINDOWS_X64_REQUIRED");
        if (externallyPinnedRoot is null || externallyAuthenticatedCheckpoint is null)
            return WindowsTrustStoreVerdict.Deny("EXTERNAL_WITNESS_REQUIRED");
        try
        {
            using RegistryKey hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
            using RegistryKey? key = hklm.OpenSubKey(RegistryPath, writable: false);
            if (key is null) return WindowsTrustStoreVerdict.Deny("PROTECTED_STORE_NOT_ENROLLED");
            if (key.SubKeyCount != 0) return WindowsTrustStoreVerdict.Deny("UNEXPECTED_SUBKEY");

            byte[]? before = ReadKeyDescriptor(key.Handle);
            if (before is null || !IsProtectedSecurityDescriptor(before))
                return WindowsTrustStoreVerdict.Deny("REGISTRY_ACL_DENIED");
            RegistryTrustValues? first = ReadTypedValues(key);
            RegistryTrustValues? second = ReadTypedValues(key);
            byte[]? after = ReadKeyDescriptor(key.Handle);
            if (first is null || second is null || first != second ||
                after is null || !before.AsSpan().SequenceEqual(after) ||
                !IsProtectedSecurityDescriptor(after))
                return WindowsTrustStoreVerdict.Deny("TRUST_STORE_CHANGED_OR_INVALID");
            if (!MatchesExternalWitness(first, externallyPinnedRoot, externallyAuthenticatedCheckpoint))
                return WindowsTrustStoreVerdict.Deny("EXTERNAL_CHECKPOINT_OR_ROOT_MISMATCH");

            TrustBootstrapVerdict manifest = TrustBootstrap.Verify(
                signedManifest, externallyPinnedRoot, externallyAuthenticatedCheckpoint, nowUnix);
            if (!manifest.ManifestVerified || manifest.VerifiedIssuer is null || manifest.CanExecuteCommit)
                return WindowsTrustStoreVerdict.Deny("SIGNED_MANIFEST_DENIED");
            return new WindowsTrustStoreVerdict("PROTECTED_STORE_AND_MANIFEST_VERIFIED_REVIEW_ONLY",
                true, true, manifest.VerifiedIssuer, false);
        }
        catch (Exception e) when (e is UnauthorizedAccessException or IOException or SecurityException or
                                   ArgumentException or InvalidOperationException or PlatformNotSupportedException or
                                   System.ComponentModel.Win32Exception)
        {
            return WindowsTrustStoreVerdict.Deny("REGISTRY_READ_DENIED");
        }
    }
}
