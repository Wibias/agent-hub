using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MemoryReviewAuthority.OperatorUi;

/// <summary>
/// Physical Windows 11 WebAuthn MakeCredential ceremony, invoked ONLY after
/// human review in the sealed installed native UI. The OS creates/holds the
/// private key; only public attested credential bytes go to the protected
/// LocalService for independent validation and a separate possession proof.
/// This does not approve a Memory Claim.
/// </summary>
internal static class NativeWindowsWebAuthnRegistration
{
    private const string PublicKeyType = "public-key";

    [StructLayout(LayoutKind.Sequential)]
    private struct RpEntity
    {
        public uint Version;
        public IntPtr Id;
        public IntPtr Name;
        public IntPtr Icon;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct UserEntity
    {
        public uint Version;
        public uint IdSize;
        public IntPtr Id;
        public IntPtr Name;
        public IntPtr Icon;
        public IntPtr DisplayName;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CoseParameter
    {
        public uint Version;
        public IntPtr CredentialType;
        public int Algorithm;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CoseParameters
    {
        public uint Count;
        public IntPtr Data;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Credentials
    {
        public uint Count;
        public IntPtr Data;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Extensions
    {
        public uint Count;
        public IntPtr Data;
    }

    // Explicit VERSION-1 prefix: Windows reads fields according to Version.
    // Do not dereference newer fields in returned native ABI objects.
    [StructLayout(LayoutKind.Sequential)]
    private struct MakeOptionsV1
    {
        public uint Version;
        public uint TimeoutMs;
        public Credentials Excluded;
        public Extensions Extensions;
        public uint AuthenticatorAttachment;
        public int RequireResidentKey;
        public uint UserVerificationRequirement;
        public uint AttestationPreference;
        public uint Flags;
        public IntPtr CancellationId;
        public IntPtr ExcludeCredentialList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ClientData
    {
        public uint Version;
        public uint JsonSize;
        public IntPtr Json;
        public IntPtr HashAlg;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct AttestationPrefix
    {
        public uint Version;
        public IntPtr FormatType;
        public uint AuthDataSize;
        public IntPtr AuthData;
        public uint AttestationSize;
        public IntPtr Attestation;
        public uint AttestationDecodeType;
        public IntPtr AttestationDecode;
        public uint AttestationObjectSize;
        public IntPtr AttestationObject;
        public uint CredentialIdSize;
        public IntPtr CredentialId;
    }

    [DllImport("webauthn.dll", EntryPoint = "WebAuthNAuthenticatorMakeCredential",
        CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int MakeCredentialNative(
        IntPtr owner, ref RpEntity rp, ref UserEntity user,
        ref CoseParameters cose, ref ClientData client,
        ref MakeOptionsV1 options, out IntPtr result);

    [DllImport("webauthn.dll", ExactSpelling = true)]
    private static extern void WebAuthNFreeCredentialAttestation(IntPtr result);

    [DllImport("webauthn.dll", ExactSpelling = true)]
    private static extern uint WebAuthNGetApiVersionNumber();

    [DllImport("webauthn.dll", ExactSpelling = true)]
    private static extern IntPtr WebAuthNGetErrorName(int result);

    private static string Encode(ReadOnlySpan<byte> input)
        => Convert.ToBase64String(input).TrimEnd('=')
            .Replace('+', '-').Replace('/', '_');

    private static byte[] Decode(string? input)
    {
        if (input is not { Length: 43 }
            || !Regex.IsMatch(input, @"\A[A-Za-z0-9_-]{43}\z",
                RegexOptions.CultureInvariant))
            throw new InvalidOperationException("Ungültige Einschreib-Challenge");
        var normalized = input.Replace('-', '+').Replace('_', '/') + "=";
        var bytes = Convert.FromBase64String(normalized);
        if (bytes.Length != 32 || Encode(bytes) != input)
            throw new InvalidOperationException("Einschreib-Challenge muss 32 Bytes lang sein");
        return bytes;
    }

    private static byte[] ReadBytes(IntPtr ptr, uint size, int max)
    {
        if (ptr == IntPtr.Zero || size is 0 || size > max)
            throw new InvalidOperationException("Native Credential-Daten fehlen oder sind zu groß");
        var bytes = new byte[checked((int)size)];
        Marshal.Copy(ptr, bytes, 0, bytes.Length);
        return bytes;
    }

    internal static NativeRegistrationData MakeCredential(
        IntPtr parent, RegistrationOffer request)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10)
            || !Environment.Is64BitProcess || parent == IntPtr.Zero
            || request.ExpiresUtc <= DateTimeOffset.UtcNow
            || request.ExpectedOrigin != "http://localhost:4328"
            || request.RpId != "localhost")
            throw new InvalidOperationException(
                "Native Einschreibung benötigt einen gültigen Dienstkontext");
        if (WebAuthNGetApiVersionNumber() < 1)
            throw new InvalidOperationException("Windows WebAuthn API nicht vorhanden");
        var challenge = Decode(request.Challenge);
        var userId = Decode(request.UserId);
        var clientJson = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            type = "webauthn.create",
            challenge = Encode(challenge),
            origin = request.ExpectedOrigin,
            crossOrigin = false,
        }));
        IntPtr rpId = IntPtr.Zero, rpName = IntPtr.Zero;
        IntPtr userName = IntPtr.Zero, display = IntPtr.Zero;
        IntPtr keyType = IntPtr.Zero, hashName = IntPtr.Zero;
        IntPtr userPtr = IntPtr.Zero, jsonPtr = IntPtr.Zero;
        IntPtr cosePtr = IntPtr.Zero, output = IntPtr.Zero;
        try
        {
            rpId = Marshal.StringToHGlobalUni(request.RpId);
            rpName = Marshal.StringToHGlobalUni("AgentHub geschützte Erinnerung");
            userName = Marshal.StringToHGlobalUni("agenthub-local-review");
            display = Marshal.StringToHGlobalUni("AgentHub lokale Prüfung");
            keyType = Marshal.StringToHGlobalUni(PublicKeyType);
            hashName = Marshal.StringToHGlobalUni("SHA-256");
            userPtr = Marshal.AllocHGlobal(userId.Length);
            Marshal.Copy(userId, 0, userPtr, userId.Length);
            jsonPtr = Marshal.AllocHGlobal(clientJson.Length);
            Marshal.Copy(clientJson, 0, jsonPtr, clientJson.Length);
            var rp = new RpEntity { Version = 1, Id = rpId, Name = rpName };
            var user = new UserEntity
            {
                Version = 1, IdSize = (uint)userId.Length,
                Id = userPtr, Name = userName, DisplayName = display,
            };
            var algorithm = new CoseParameter
            {
                Version = 1, CredentialType = keyType, Algorithm = -7,
            };
            cosePtr = Marshal.AllocHGlobal(Marshal.SizeOf<CoseParameter>());
            Marshal.StructureToPtr(algorithm, cosePtr, false);
            var cose = new CoseParameters { Count = 1, Data = cosePtr };
            var client = new ClientData
            {
                Version = 1, JsonSize = (uint)clientJson.Length,
                Json = jsonPtr, HashAlg = hashName,
            };
            var options = new MakeOptionsV1
            {
                Version = 1, TimeoutMs = 60_000,
                AuthenticatorAttachment = 0,
                UserVerificationRequirement = 1, // REQUIRED
                AttestationPreference = 1, // NONE; not a hardware attestation
                RequireResidentKey = 0,
            };
            var hr = MakeCredentialNative(parent, ref rp, ref user,
                ref cose, ref client, ref options, out output);
            if (hr < 0 || output == IntPtr.Zero)
            {
                var errorPtr = WebAuthNGetErrorName(hr);
                var error = errorPtr == IntPtr.Zero
                    ? $"0x{hr:x8}" : Marshal.PtrToStringUni(errorPtr) ?? $"0x{hr:x8}";
                throw new InvalidOperationException(
                    "Windows Hello/FIDO2 Einschreibung verweigert: " + error);
            }
            var attestation = Marshal.PtrToStructure<AttestationPrefix>(output);
            var auth = ReadBytes(attestation.AuthData,
                attestation.AuthDataSize, 2048);
            var id = ReadBytes(attestation.CredentialId,
                attestation.CredentialIdSize, 1024);
            return new NativeRegistrationData(
                Encode(clientJson), Encode(auth), Encode(id));
        }
        finally
        {
            if (output != IntPtr.Zero) WebAuthNFreeCredentialAttestation(output);
            if (cosePtr != IntPtr.Zero) Marshal.FreeHGlobal(cosePtr);
            if (jsonPtr != IntPtr.Zero) Marshal.FreeHGlobal(jsonPtr);
            if (userPtr != IntPtr.Zero) Marshal.FreeHGlobal(userPtr);
            if (hashName != IntPtr.Zero) Marshal.FreeHGlobal(hashName);
            if (keyType != IntPtr.Zero) Marshal.FreeHGlobal(keyType);
            if (display != IntPtr.Zero) Marshal.FreeHGlobal(display);
            if (userName != IntPtr.Zero) Marshal.FreeHGlobal(userName);
            if (rpName != IntPtr.Zero) Marshal.FreeHGlobal(rpName);
            if (rpId != IntPtr.Zero) Marshal.FreeHGlobal(rpId);
            CryptographicOperations.ZeroMemory(clientJson);
            CryptographicOperations.ZeroMemory(userId);
        }
    }
}
