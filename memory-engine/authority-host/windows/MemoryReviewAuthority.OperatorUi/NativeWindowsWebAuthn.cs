using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MemoryReviewAuthority.OperatorUi;

/// <summary>
/// Calls the actual native Windows WebAuthn API, not a browser or an agent
/// simulator. The operating system selects Windows Hello / FIDO2 device.
/// All unsafe native allocations are scoped to the one user-initiated call.
/// API options use v1 ABI so they work on older supported Windows 11 builds.
/// </summary>
internal static class NativeWindowsWebAuthn
{
    private const string RpId = "localhost";
    private const string CredentialType = "public-key";
    private const string HashAlgorithm = "SHA-256";

    [StructLayout(LayoutKind.Sequential)]
    private struct ClientData
    {
        public uint Version;
        public uint JsonSize;
        public IntPtr Json;
        public IntPtr HashAlg;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Credential
    {
        public uint Version;
        public uint IdSize;
        public IntPtr Id;
        public IntPtr Type;
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

    [StructLayout(LayoutKind.Sequential)]
    private struct GetAssertionOptions
    {
        public uint Version;
        public uint TimeoutMs;
        public Credentials CredentialList;
        public Extensions Extensions;
        public uint AuthenticatorAttachment;
        public uint UserVerificationRequirement;
        public uint Flags;
        public IntPtr U2fAppId;
        public IntPtr UsedU2fAppId;
        public IntPtr CancellationId;
        public IntPtr AllowCredentialList;
        public uint LargeBlobOperation;
        public uint LargeBlobSize;
        public IntPtr LargeBlob;
        public IntPtr HmacSecretSaltValues;
        public int BrowserPrivateMode;
        public IntPtr LinkedDevice;
        public int AutoFill;
        public uint JsonExtSize;
        public IntPtr JsonExt;
        public uint CredentialHintsCount;
        public IntPtr CredentialHints;
        public IntPtr RemoteWebOrigin;
        public uint RequestOptionsJsonSize;
        public IntPtr RequestOptionsJson;
        public uint AuthenticatorIdSize;
        public IntPtr AuthenticatorId;
    }

    // Only the version-1 PREFIX is read. Newer Windows may append fields.
    [StructLayout(LayoutKind.Sequential)]
    private struct AssertionHeader
    {
        public uint Version;
        public uint AuthenticatorDataSize;
        public IntPtr AuthenticatorData;
        public uint SignatureSize;
        public IntPtr Signature;
        public Credential Credential;
    }

    [DllImport("webauthn.dll", ExactSpelling = true)]
    private static extern uint WebAuthNGetApiVersionNumber();

    [DllImport("webauthn.dll", EntryPoint = "WebAuthNAuthenticatorGetAssertion",
        CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int GetAssertionNative(
        IntPtr window, [MarshalAs(UnmanagedType.LPWStr)] string rpId,
        ref ClientData clientData,
        ref GetAssertionOptions options,
        out IntPtr assertion);

    [DllImport("webauthn.dll", ExactSpelling = true)]
    private static extern void WebAuthNFreeAssertion(IntPtr assertion);

    [DllImport("webauthn.dll", ExactSpelling = true)]
    private static extern IntPtr WebAuthNGetErrorName(int result);

    private static byte[] ReadBytes(IntPtr ptr, uint length, int max)
    {
        if (ptr == IntPtr.Zero || length is 0 || length > max)
            throw new InvalidOperationException("Windows Hello gab ungültige Daten zurück");
        var bytes = new byte[checked((int)length)];
        Marshal.Copy(ptr, bytes, 0, bytes.Length);
        return bytes;
    }

    private static string Encode(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=')
            .Replace('+', '-').Replace('/', '_');

    private static byte[] DecodeCredential(string value)
    {
        if (value.Length is < 16 or > 2048
            || !Regex.IsMatch(value, @"\A[A-Za-z0-9_-]+\z"))
            throw new InvalidOperationException("Credential-ID ungültig");
        var base64 = value.Replace('-', '+').Replace('_', '/');
        var id = Convert.FromBase64String(
            base64.PadRight((base64.Length + 3) / 4 * 4, '='));
        if (id.Length is < 16 or > 1024 || Encode(id) != value)
            throw new InvalidOperationException("Credential-ID nichtkanonisch");
        return id;
    }

    internal static NativeAssertion GetAssertion(IntPtr ownerWindow, ServiceOffer offer)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10)
            || !Environment.Is64BitProcess || ownerWindow == IntPtr.Zero
            || offer.ExpiresUtc <= DateTimeOffset.UtcNow
            || offer.ExpectedOrigin is not ("http://localhost:4328" or "http://localhost:4317"))
        {
            // No dynamically supplied origin is trusted for a different RP.
            throw new InvalidOperationException(
                "Windows-Hello-Kontext, Ursprung oder Challenge ungültig");
        }
        if (WebAuthNGetApiVersionNumber() < 1)
            throw new InvalidOperationException("Windows-WebAuthn API nicht vorhanden");

        var credentialId = DecodeCredential(offer.CredentialId);
        var clientJson = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            type = "webauthn.get",
            challenge = offer.Challenge,
            origin = offer.ExpectedOrigin,
            crossOrigin = false,
        }));
        IntPtr jsonPtr = IntPtr.Zero, keyIdPtr = IntPtr.Zero;
        IntPtr credTypePtr = IntPtr.Zero, hashPtr = IntPtr.Zero;
        IntPtr credPtr = IntPtr.Zero, outputPtr = IntPtr.Zero;
        try
        {
            jsonPtr = Marshal.AllocHGlobal(clientJson.Length);
            Marshal.Copy(clientJson, 0, jsonPtr, clientJson.Length);
            keyIdPtr = Marshal.AllocHGlobal(credentialId.Length);
            Marshal.Copy(credentialId, 0, keyIdPtr, credentialId.Length);
            credTypePtr = Marshal.StringToHGlobalUni(CredentialType);
            hashPtr = Marshal.StringToHGlobalUni(HashAlgorithm);
            var credential = new Credential
            {
                Version = 1, IdSize = (uint)credentialId.Length,
                Id = keyIdPtr, Type = credTypePtr,
            };
            credPtr = Marshal.AllocHGlobal(Marshal.SizeOf<Credential>());
            Marshal.StructureToPtr(credential, credPtr, false);
            var client = new ClientData
            {
                Version = 1, JsonSize = (uint)clientJson.Length,
                Json = jsonPtr, HashAlg = hashPtr,
            };
            var opts = new GetAssertionOptions
            {
                Version = 1,
                TimeoutMs = 60_000,
                CredentialList = new Credentials
                {
                    Count = 1, Data = credPtr,
                },
                UserVerificationRequirement = 1, // REQUIRED, not preferred
                AuthenticatorAttachment = 0,     // Windows Hello or FIDO2
                Flags = 0,
            };
            var hr = GetAssertionNative(ownerWindow, RpId,
                ref client, ref opts, out outputPtr);
            if (hr < 0 || outputPtr == IntPtr.Zero)
            {
                var ptr = WebAuthNGetErrorName(hr);
                var code = ptr == IntPtr.Zero
                    ? $"0x{hr:x8}" : Marshal.PtrToStringUni(ptr) ?? $"0x{hr:x8}";
                throw new InvalidOperationException(
                    "Windows Hello/FIDO2 verweigert oder abgebrochen: " + code);
            }
            var header = Marshal.PtrToStructure<AssertionHeader>(outputPtr);
            var returnedId = ReadBytes(header.Credential.Id,
                header.Credential.IdSize, 1024);
            if (!CryptographicOperations.FixedTimeEquals(returnedId, credentialId))
                throw new InvalidOperationException(
                    "Windows Hello gab eine andere Credential-ID zurück");
            var auth = ReadBytes(header.AuthenticatorData,
                header.AuthenticatorDataSize, 1024);
            var signature = ReadBytes(header.Signature, header.SignatureSize, 256);
            return new NativeAssertion(
                offer.CredentialId, CredentialType,
                Encode(clientJson), Encode(auth), Encode(signature));
        }
        finally
        {
            if (outputPtr != IntPtr.Zero)
                WebAuthNFreeAssertion(outputPtr);
            if (credPtr != IntPtr.Zero)
                Marshal.FreeHGlobal(credPtr);
            if (credTypePtr != IntPtr.Zero)
                Marshal.FreeHGlobal(credTypePtr);
            if (hashPtr != IntPtr.Zero)
                Marshal.FreeHGlobal(hashPtr);
            if (keyIdPtr != IntPtr.Zero)
                Marshal.FreeHGlobal(keyIdPtr);
            if (jsonPtr != IntPtr.Zero)
                Marshal.FreeHGlobal(jsonPtr);
            CryptographicOperations.ZeroMemory(clientJson);
        }
    }
}
