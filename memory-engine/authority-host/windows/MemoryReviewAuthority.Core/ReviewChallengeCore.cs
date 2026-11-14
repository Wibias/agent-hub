using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MemoryReviewAuthority.Core;

/// <summary>
/// Checked review meaning. This model is not an authorization or a claim write.
/// A future protected host must derive it independently from the authoritative
/// pending proposal, NOT from untrusted Codex/MCP caller-supplied metadata.
/// </summary>
public sealed record ReviewMeaning(
    string ProjectId,
    string Branch,
    string RevisionSha,
    string ProposalRef,
    string ReviewSnapshotSha256,
    string CanonicalFactSha256,
    string Decision,
    string CanonicalFact);

/// <summary>
/// An existing, independently enrolled credential. The service installation
/// must protect this allowlist; it is not safe in an agent-writable SQLite file.
/// </summary>
public sealed record PinnedCredential(
    string CredentialIdBase64Url,
    string PublicKeyPem,
    string ExpectedOrigin);

public sealed record ChallengeTicket(
    string TicketId,
    string ChallengeBase64Url,
    DateTimeOffset ExpiresUtc,
    ReviewMeaning Meaning);

public sealed record BrowserAssertion(
    string CredentialIdBase64Url,
    string Type,
    string ClientDataJsonBase64Url,
    string AuthenticatorDataBase64Url,
    string SignatureBase64Url);

public sealed record VerificationResult(
    bool Verified,
    string Status,
    bool UserPresent = false,
    bool UserVerified = false,
    uint SignCount = 0,
    bool SignCounterVerifiable = false,
    bool ApprovedReviewDecision = false,
    bool ClaimWritten = false);

/// <summary>
/// In-memory one-time challenge and ES256/UV verification engine.
/// Deliberately DOES NOT implement a Windows service, browser endpoint, FIDO2
/// credential registration, persistent key store or Memory write capability.
/// All challenges are invalidated on a process restart.
/// </summary>
public sealed class ReviewChallengeCore
{
    public const string Protocol = "agenthub-evidence-bound-uv-v1";
    public const int MaxPending = 32;
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(90);

    private readonly object _gate = new();
    private readonly Dictionary<string, Pending> _pending = new(StringComparer.Ordinal);
    private readonly Dictionary<string, uint> _signCounts = new(StringComparer.Ordinal);
    private readonly TimeProvider _clock;

    private sealed record Pending(
        ReviewMeaning Meaning,
        PinnedCredential Credential,
        string Challenge,
        long StartedTick,
        DateTimeOffset ExpiresUtc);

    public ReviewChallengeCore(TimeProvider? clock = null)
    {
        _clock = clock ?? TimeProvider.System;
    }

    public ChallengeTicket Begin(ReviewMeaning meaning, PinnedCredential credential)
    {
        ValidateMeaning(meaning);
        ValidateCredential(credential);
        var nonce = RandomNumberGenerator.GetBytes(32);
        var challenge = ComputeChallenge(meaning, nonce);
        // Ticket ID and nonce are independently random. Neither is a portable
        // signature or any transferable Memory/Claim authorization.
        var id = Encode(RandomNumberGenerator.GetBytes(24));
        lock (_gate)
        {
            RemoveExpired();
            if (_pending.Count >= MaxPending)
                throw new InvalidOperationException("review_challenge_capacity_exceeded");
            if (_pending.Values.Any(p => SameProposal(p.Meaning, meaning)))
                throw new InvalidOperationException("review_challenge_already_pending");
            var now = _clock.GetUtcNow();
            _pending.Add(id, new Pending(
                meaning, credential, challenge, _clock.GetTimestamp(), now.Add(Lifetime)));
            return new ChallengeTicket(id, challenge, now.Add(Lifetime), meaning);
        }
    }

    /// <summary>
    /// Consumes the challenge BEFORE any verification, including an invalid
    /// response. No second attempt is permitted. Host approval still requires
    /// protected enrollment, caller isolation and a separate atomic DB gate.
    /// </summary>
    public VerificationResult VerifyAndConsume(
        string ticketId, ReviewMeaning expectedMeaning, BrowserAssertion assertion)
    {
        if (string.IsNullOrWhiteSpace(ticketId) || expectedMeaning is null || assertion is null)
            return Denied("invalid_request");

        Pending? pending;
        lock (_gate)
        {
            if (!_pending.Remove(ticketId, out pending))
                return Denied("ticket_missing_or_consumed");
        }
        // This comparison deliberately includes fact text as well as hashes.
        if (pending is null || pending.Meaning != expectedMeaning)
            return Denied("meaning_changed");
        if (_clock.GetElapsedTime(pending.StartedTick) >= Lifetime
            || _clock.GetUtcNow() >= pending.ExpiresUtc)
            return Denied("ticket_expired");
        try
        {
            var verified = CheckAssertion(pending.Credential, pending.Challenge, assertion);
            if (!verified.Verified) return verified;
            var id = pending.Credential.CredentialIdBase64Url;
            lock (_gate)
            {
                _signCounts.TryGetValue(id, out var previous);
                // Counter=0 is legal, but never treated as replay protection.
                if (previous > 0 && verified.SignCount > 0 && verified.SignCount <= previous)
                    return Denied("sign_counter_replay");
                if (verified.SignCount > previous)
                    _signCounts[id] = verified.SignCount;
                return verified with
                {
                    Verified = true,
                    Status = "verified_not_authorized",
                    ApprovedReviewDecision = false,
                    ClaimWritten = false,
                    SignCounterVerifiable = previous > 0 && verified.SignCount > 0,
                };
            }
        }
        catch (Exception error) when (error is ArgumentException
            or FormatException or JsonException or CryptographicException
            or InvalidOperationException or KeyNotFoundException)
        {
            return Denied("assertion_invalid");
        }
    }

    private static VerificationResult CheckAssertion(
        PinnedCredential pinned, string challenge, BrowserAssertion assertion)
    {
        if (assertion.Type != "public-key")
            return Denied("credential_type");
        var receivedId = Decode(assertion.CredentialIdBase64Url, 1024);
        var expectedId = Decode(pinned.CredentialIdBase64Url, 1024);
        if (!CryptographicOperations.FixedTimeEquals(receivedId, expectedId))
            return Denied("credential_mismatch");
        var client = Decode(assertion.ClientDataJsonBase64Url, 8192);
        using var json = JsonDocument.Parse(client);
        if (json.RootElement.ValueKind != JsonValueKind.Object)
            return Denied("client_data_invalid");
        var fields = json.RootElement.EnumerateObject().ToArray();
        if (fields.Select(field => field.Name).Distinct(StringComparer.Ordinal).Count() != fields.Length)
            return Denied("client_duplicate_field");
        if (json.RootElement.GetProperty("type").GetString() != "webauthn.get"
            || json.RootElement.GetProperty("origin").GetString() != pinned.ExpectedOrigin
            || json.RootElement.TryGetProperty("topOrigin", out _)
            || (json.RootElement.TryGetProperty("crossOrigin", out var crossOrigin)
                && crossOrigin.ValueKind != JsonValueKind.False))
            return Denied("client_origin_or_type");
        var receivedChallenge = Decode(json.RootElement.GetProperty("challenge").GetString(), 64);
        var expectedChallenge = Decode(challenge, 64);
        if (!CryptographicOperations.FixedTimeEquals(receivedChallenge, expectedChallenge))
            return Denied("challenge_mismatch");

        var authData = Decode(assertion.AuthenticatorDataBase64Url, 1024);
        if (authData.Length != 37)
            return Denied("authenticator_data_length");
        if (!CryptographicOperations.FixedTimeEquals(
            authData.AsSpan(0, 32), SHA256.HashData(Encoding.UTF8.GetBytes("localhost"))))
            return Denied("rp_id_mismatch");
        var flags = authData[32];
        if ((flags & 0x01) == 0 || (flags & 0x04) == 0
            || (flags & 0xe2) != 0 || ((flags & 0x10) != 0 && (flags & 0x08) == 0))
            return Denied("authenticator_flags");
        var signCount = BinaryPrimitives.ReadUInt32BigEndian(authData.AsSpan(33, 4));
        using var key = ECDsa.Create();
        key.ImportFromPem(pinned.PublicKeyPem);
        var curveOid = key.ExportParameters(false).Curve.Oid.Value;
        if (curveOid != "1.2.840.10045.3.1.7")
            return Denied("credential_curve");
        var signedData = new byte[authData.Length + 32];
        authData.CopyTo(signedData, 0);
        SHA256.HashData(client).CopyTo(signedData, authData.Length);
        var signature = Decode(assertion.SignatureBase64Url, 256);
        if (!key.VerifyData(signedData, signature,
            HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence))
            return Denied("signature_invalid");
        return new VerificationResult(
            true, "verified_not_authorized", true, true, signCount,
            false, false, false);
    }

    public static string ComputeChallenge(ReviewMeaning meaning, ReadOnlySpan<byte> nonce)
    {
        ValidateMeaning(meaning);
        if (nonce.Length < 32 || nonce.Length > 64)
            throw new ArgumentOutOfRangeException(nameof(nonce), "host nonce must be 32-64 bytes");
        var parts = new[]
        {
            Protocol, meaning.ProjectId, meaning.Branch, meaning.RevisionSha,
            meaning.ProposalRef, meaning.ReviewSnapshotSha256,
            meaning.CanonicalFactSha256, meaning.Decision,
        };
        // Cross-language compatible with JSON.stringify() in the current
        // Node verifier. Scope identifiers are restricted to plain ASCII.
        var json = JsonSerializer.Serialize(parts, new JsonSerializerOptions
        {
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        });
        var prefix = Encoding.UTF8.GetBytes(json);
        var bytes = new byte[prefix.Length + 1 + nonce.Length];
        prefix.CopyTo(bytes, 0);
        nonce.CopyTo(bytes.AsSpan(prefix.Length + 1));
        return Encode(SHA256.HashData(bytes));
    }

    private static void ValidateMeaning(ReviewMeaning m)
    {
        if (m is null
            || !AsciiScope(m.ProjectId, 256) || !AsciiScope(m.Branch, 128)
            || !Regex.IsMatch(m.RevisionSha ?? "", "^[0-9a-f]{40}$", RegexOptions.CultureInvariant)
            || !Regex.IsMatch(m.ProposalRef ?? "", "^E~[0-9a-f]{10}$", RegexOptions.CultureInvariant)
            || !Regex.IsMatch(m.ReviewSnapshotSha256 ?? "", "^[0-9a-f]{64}$", RegexOptions.CultureInvariant)
            || !Regex.IsMatch(m.CanonicalFactSha256 ?? "", "^[0-9a-f]{64}$", RegexOptions.CultureInvariant)
            || m.Decision is not ("confirm" or "reject")
            || string.IsNullOrWhiteSpace(m.CanonicalFact)
            || m.CanonicalFact.Length > 4000
            || !string.Equals(
                Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(m.CanonicalFact))).ToLowerInvariant(),
                m.CanonicalFactSha256, StringComparison.Ordinal))
            throw new ArgumentException("invalid_exact_review_meaning");
    }

    private static bool AsciiScope(string value, int max)
        => !string.IsNullOrWhiteSpace(value) && value.Length <= max
            && Regex.IsMatch(value, @"^[A-Za-z0-9._:/~-]+$", RegexOptions.CultureInvariant);

    private static void ValidateCredential(PinnedCredential c)
    {
        if (c is null || string.IsNullOrWhiteSpace(c.PublicKeyPem))
            throw new ArgumentException("pinned_credential_required");
        _ = Decode(c.CredentialIdBase64Url, 1024);
        if (!Uri.TryCreate(c.ExpectedOrigin, UriKind.Absolute, out var uri)
            || uri.Host != "localhost" || uri.HostNameType != UriHostNameType.Dns
            || uri.Scheme is not ("http" or "https")
            || uri.GetLeftPart(UriPartial.Authority) != c.ExpectedOrigin
            || uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)
            || !string.IsNullOrEmpty(uri.UserInfo))
            throw new ArgumentException("local_origin_required");
    }

    private static byte[] Decode(string? input, int maxBytes)
    {
        if (input is null || input.Length == 0 || input.Length > maxBytes * 2
            || !Regex.IsMatch(input, "^[A-Za-z0-9_-]+$", RegexOptions.CultureInvariant))
            throw new FormatException("noncanonical_base64url");
        var normalized = input.Replace('-', '+').Replace('_', '/');
        normalized = normalized.PadRight((normalized.Length + 3) / 4 * 4, '=');
        var result = Convert.FromBase64String(normalized);
        if (result.Length is 0 || result.Length > maxBytes || Encode(result) != input)
            throw new FormatException("noncanonical_base64url");
        return result;
    }

    private static string Encode(ReadOnlySpan<byte> data)
        => Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static bool SameProposal(ReviewMeaning a, ReviewMeaning b)
        => a.ProjectId == b.ProjectId && a.Branch == b.Branch
            && a.ProposalRef == b.ProposalRef;

    private void RemoveExpired()
    {
        foreach (var id in _pending.Where(pair =>
            _clock.GetElapsedTime(pair.Value.StartedTick) >= Lifetime
            || _clock.GetUtcNow() >= pair.Value.ExpiresUtc).Select(pair => pair.Key).ToArray())
            _pending.Remove(id);
    }

    private static VerificationResult Denied(string code)
        => new(false, code);
}
