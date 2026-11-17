using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MemoryReviewAuthority.Core;

/// <summary>
/// Strict, bounded ES256 credential extraction from native Windows WebAuthn
/// MakeCredential output. This DOES NOT establish hardware attestation,
/// user identity, consent or Claim authority. It must be paired with a new
/// service-owned GetAssertion challenge, the protected native executable,
/// and an explicit human gesture.
/// </summary>
public static class NativeWebAuthnEnrollment
{
    public const string Origin = "http://localhost:4328";
    private const int MaxAuthenticatorBytes = 2048;
    private static readonly byte[] RpHash =
        SHA256.HashData(Encoding.UTF8.GetBytes("localhost"));

    public static PinnedCredential ParseUnverifiedRegistration(
        string? clientDataBase64Url, string? authenticatorDataBase64Url,
        string? credentialIdBase64Url, string? challengeBase64Url)
    {
        var clientBytes = Decode(clientDataBase64Url, 8192);
        using var json = JsonDocument.Parse(clientBytes);
        var root = json.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("native_registration_client_invalid");
        var members = root.EnumerateObject().ToArray();
        if (members.Select(x => x.Name).Distinct(StringComparer.Ordinal).Count() != members.Length
            || root.TryGetProperty("topOrigin", out _)
            || !root.TryGetProperty("type", out var type)
            || type.ValueKind != JsonValueKind.String
            || type.GetString() != "webauthn.create"
            || !root.TryGetProperty("origin", out var origin)
            || origin.ValueKind != JsonValueKind.String
            || origin.GetString() != Origin
            || (root.TryGetProperty("crossOrigin", out var cross)
                && cross.ValueKind != JsonValueKind.False)
            || !root.TryGetProperty("challenge", out var challenge)
            || challenge.ValueKind != JsonValueKind.String
            || !CryptographicOperations.FixedTimeEquals(
                Decode(challenge.GetString(), 64),
                Decode(challengeBase64Url, 64)))
            throw new InvalidOperationException("native_registration_challenge_or_origin_invalid");

        var auth = Decode(authenticatorDataBase64Url, MaxAuthenticatorBytes);
        if (auth.Length is < 55 or > MaxAuthenticatorBytes
            || !CryptographicOperations.FixedTimeEquals(auth.AsSpan(0, 32), RpHash))
            throw new InvalidOperationException("native_registration_rp_invalid");
        var flags = auth[32];
        // UP, UV and attested credential data required. Reject extensions,
        // RFU bits and invalid BS-without-BE flags until specifically audited.
        if ((flags & 0x45) != 0x45 || (flags & 0xa2) != 0
            || ((flags & 0x10) != 0 && (flags & 0x08) == 0))
            throw new InvalidOperationException("native_registration_flags_invalid");
        var idLength = BinaryPrimitives.ReadUInt16BigEndian(auth.AsSpan(53, 2));
        if (idLength is < 16 or > 1024
            || auth.Length < 55 + idLength + 1)
            throw new InvalidOperationException("native_registration_id_length");
        var id = Decode(credentialIdBase64Url, 1024);
        if (!CryptographicOperations.FixedTimeEquals(
            auth.AsSpan(55, idLength), id))
            throw new InvalidOperationException("native_registration_id_mismatch");

        var encodedKey = auth.AsSpan(55 + idLength);
        var reader = new NarrowCoseReader(encodedKey);
        var count = reader.ReadMapLength();
        if (count != 5)
            throw new InvalidOperationException("native_registration_es256_map");
        int? kty = null, alg = null, crv = null;
        byte[]? xCoord = null, yCoord = null;
        var seen = new HashSet<int>();
        for (var i = 0; i < count; i++)
        {
            var key = reader.ReadInt();
            if (!seen.Add(key))
                throw new InvalidOperationException("native_registration_duplicate_cose_key");
            switch (key)
            {
                case 1: kty = reader.ReadInt(); break;
                case 3: alg = reader.ReadInt(); break;
                case -1: crv = reader.ReadInt(); break;
                case -2: xCoord = reader.ReadByteString(32); break;
                case -3: yCoord = reader.ReadByteString(32); break;
                default: throw new InvalidOperationException("native_registration_cose_key_unsupported");
            }
        }
        if (!reader.End || kty != 2 || alg != -7 || crv != 1
            || xCoord?.Length != 32 || yCoord?.Length != 32)
            throw new InvalidOperationException("native_registration_es256_only");

        try
        {
            using var signingKey = ECDsa.Create(new ECParameters
            {
                Curve = ECCurve.NamedCurves.nistP256,
                Q = new ECPoint { X = xCoord, Y = yCoord },
            });
            return new PinnedCredential(Encode(id),
                signingKey.ExportSubjectPublicKeyInfoPem(), Origin);
        }
        catch (CryptographicException)
        {
            throw new InvalidOperationException("native_registration_invalid_curve_point");
        }
    }

    private static byte[] Decode(string? value, int max)
    {
        if (string.IsNullOrEmpty(value) || value.Length > max * 2
            || value.Any(c => !((c is >= 'A' and <= 'Z')
                || (c is >= 'a' and <= 'z') || (c is >= '0' and <= '9')
                || c is '-' or '_')))
            throw new InvalidOperationException("native_registration_encoding_invalid");
        var padded = value.Replace('-', '+').Replace('_', '/');
        var bytes = Convert.FromBase64String(
            padded.PadRight((padded.Length + 3) / 4 * 4, '='));
        if (bytes.Length is 0 || bytes.Length > max || Encode(bytes) != value)
            throw new InvalidOperationException("native_registration_encoding_invalid");
        return bytes;
    }

    private static string Encode(ReadOnlySpan<byte> value)
        => Convert.ToBase64String(value).TrimEnd('=')
            .Replace('+', '-').Replace('/', '_');

    // Minimal definite-length CBOR reader. Only the ES256 COSE key map is
    // accepted, not general-purpose CBOR tags, arrays or indefinite strings.
    private ref struct NarrowCoseReader
    {
        private ReadOnlySpan<byte> _bytes;
        private int _position;
        public NarrowCoseReader(ReadOnlySpan<byte> bytes) => _bytes = bytes;
        public bool End => _position == _bytes.Length;

        private byte Next()
        {
            if (_position >= _bytes.Length)
                throw new InvalidOperationException("native_registration_cbor_truncated");
            return _bytes[_position++];
        }
        private (int Major, uint Length) Header()
        {
            var prefix = Next();
            var major = prefix >> 5;
            var more = prefix & 31;
            uint size = more switch
            {
                <= 23 => (uint)more,
                24 => Next(),
                25 => (uint)((Next() << 8) | Next()),
                26 => ((uint)Next() << 24) | ((uint)Next() << 16)
                    | ((uint)Next() << 8) | Next(),
                _ => throw new InvalidOperationException(
                    "native_registration_cbor_encoding_unsupported"),
            };
            if (size > 2048)
                throw new InvalidOperationException("native_registration_cbor_oversized");
            return (major, size);
        }
        public int ReadMapLength()
        {
            var (major, count) = Header();
            if (major != 5 || count > 8)
                throw new InvalidOperationException("native_registration_cbor_map_invalid");
            return checked((int)count);
        }
        public int ReadInt()
        {
            var (major, number) = Header();
            if (major is not (0 or 1) || number > int.MaxValue)
                throw new InvalidOperationException("native_registration_cbor_integer_invalid");
            return major == 0 ? (int)number : -1 - (int)number;
        }
        public byte[] ReadByteString(int expectedBytes)
        {
            var (major, size) = Header();
            if (major != 2 || size != expectedBytes
                || _position + size > _bytes.Length)
                throw new InvalidOperationException("native_registration_cbor_bytes_invalid");
            var result = _bytes.Slice(_position, checked((int)size)).ToArray();
            _position += checked((int)size);
            return result;
        }
    }
}
