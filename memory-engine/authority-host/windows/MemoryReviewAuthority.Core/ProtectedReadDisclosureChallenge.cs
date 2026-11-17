using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MemoryReviewAuthority.Core;

/// <summary>
/// Exact intended disclosure, NOT verified recipient authority.
/// Every scope and fingerprint must be independently derived by a future
/// trusted host, and the protected UI must display the original facts.
/// A hash claimed by an MCP client is never identity or user consent.
/// </summary>
public sealed record ReadDisclosureMeaning(
    string ProjectId,
    string Branch,
    string RevisionSha,
    string PrincipalSid,
    string RequestId,
    string QuerySha256,
    string ResultSetSha256,
    string RecipientSessionSha256);

public sealed record ReadDisclosureTicket(
    string TicketId,
    string ChallengeBase64Url,
    DateTimeOffset ExpiresUtc,
    ReadDisclosureMeaning Meaning);

public sealed partial class ReviewChallengeCore
{
    // This must never be interchangeable with ownership, reaffirmation,
    // Claim publication or generic review approval.
    public const string ProtectedReadDisclosureProtocol =
        "agenthub-protected-read-disclosure-uv-v1";

    private sealed record PendingReadDisclosure(
        ReadDisclosureMeaning Meaning,
        PinnedCredential Credential,
        string Challenge,
        long StartedTick,
        DateTimeOffset ExpiresUtc);

    private readonly Dictionary<string, PendingReadDisclosure> _readDisclosurePending =
        new(StringComparer.Ordinal);

    /// <summary>
    /// Offline proof of a *separate* user gesture only. The returned ticket
    /// grants zero access. No service, IPC or memory projection calls this.
    /// </summary>
    public ReadDisclosureTicket BeginProtectedReadDisclosure(
        ReadDisclosureMeaning meaning, PinnedCredential credential)
    {
        ValidateReadDisclosureMeaning(meaning);
        ValidateCredential(credential);
        var challenge = ComputeProtectedReadDisclosureChallenge(
            meaning, RandomNumberGenerator.GetBytes(32));
        var id = Encode(RandomNumberGenerator.GetBytes(24));
        lock (_gate)
        {
            RemoveExpired();
            RemoveExpiredReadDisclosures();
            if (_pending.Count + _readDisclosurePending.Count >= MaxPending)
                throw new InvalidOperationException("read_disclosure_challenge_capacity_exceeded");
            if (_readDisclosurePending.Values.Any(p =>
                p.Meaning.RequestId == meaning.RequestId))
                throw new InvalidOperationException("read_disclosure_request_already_pending");
            var now = _clock.GetUtcNow();
            var expiry = now.Add(Lifetime);
            _readDisclosurePending.Add(id,
                new PendingReadDisclosure(meaning, credential, challenge,
                    _clock.GetTimestamp(), expiry));
            return new ReadDisclosureTicket(id,challenge,expiry,meaning);
        }
    }

    /// <summary>
    /// Consumes even a failed or wrong-scope attempt. Verified means only
    /// the native authenticator signed this precise challenge with UP+UV.
    /// This does NOT authorize transmission, create a durable grant,
    /// authenticate a PID, or prove that the operator saw the real query.
    /// </summary>
    public VerificationResult VerifyProtectedReadDisclosureAndConsume(
        string ticketId, ReadDisclosureMeaning expected, BrowserAssertion assertion)
    {
        if (string.IsNullOrWhiteSpace(ticketId) || expected is null
            || assertion is null)
            return Denied("read_disclosure_invalid_request");
        PendingReadDisclosure? pending;
        lock (_gate)
        {
            if (!_readDisclosurePending.Remove(ticketId, out pending))
                return Denied("read_disclosure_ticket_missing_or_consumed");
        }
        if (pending is null || pending.Meaning != expected)
            return Denied("read_disclosure_scope_changed");
        if (_clock.GetElapsedTime(pending.StartedTick) >= Lifetime
            || _clock.GetUtcNow() >= pending.ExpiresUtc)
            return Denied("read_disclosure_expired");
        try
        {
            var proof = CheckAssertion(
                pending.Credential,pending.Challenge,assertion);
            if (!proof.Verified) return proof;
            lock (_gate)
            {
                var id = pending.Credential.CredentialIdBase64Url;
                _signCounts.TryGetValue(id,out var previous);
                if (previous > 0 && proof.SignCount > 0
                    && proof.SignCount <= previous)
                    return Denied("sign_counter_replay");
                if (proof.SignCount > previous)
                    _signCounts[id] = proof.SignCount;
                return proof with
                {
                    Verified = true,
                    Status = "verified_read_disclosure_intent_only",
                    ApprovedReviewDecision = false,
                    ClaimWritten = false,
                    SignCounterVerifiable = previous > 0 && proof.SignCount > 0,
                };
            }
        }
        catch (Exception error) when (error is ArgumentException
            or FormatException or JsonException or CryptographicException
            or InvalidOperationException or KeyNotFoundException)
        {
            return Denied("read_disclosure_assertion_invalid");
        }
    }

    /// <summary>
    /// Canonical 32-byte hash over a domain-separated exact, versioned field
    /// array plus a distinct 32..64-byte service nonce. No project, recipient
    /// or query byte is accepted as independently trusted by this method.
    /// </summary>
    public static string ComputeProtectedReadDisclosureChallenge(
        ReadDisclosureMeaning meaning, ReadOnlySpan<byte> nonce)
    {
        ValidateReadDisclosureMeaning(meaning);
        if (nonce.Length is < 32 or > 64)
            throw new ArgumentOutOfRangeException(nameof(nonce));
        var fields = new[]
        {
            ProtectedReadDisclosureProtocol,
            meaning.ProjectId,meaning.Branch,meaning.RevisionSha,
            meaning.PrincipalSid,meaning.RequestId,meaning.QuerySha256,
            meaning.ResultSetSha256,meaning.RecipientSessionSha256,
            "single-disclosure-intent-only",
        };
        var encoded = JsonSerializer.Serialize(fields,new JsonSerializerOptions
        {
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        });
        var prefix = Encoding.UTF8.GetBytes(encoded);
        var bytes = new byte[prefix.Length + 1 + nonce.Length];
        prefix.CopyTo(bytes,0);
        nonce.CopyTo(bytes.AsSpan(prefix.Length + 1));
        return Encode(SHA256.HashData(bytes));
    }

    private static void ValidateReadDisclosureMeaning(ReadDisclosureMeaning? m)
    {
        if (m is null
            || m.ProjectId is null
            || !Regex.IsMatch(m.ProjectId,
                @"\Agithub\.com/[a-z0-9][a-z0-9_.-]{0,99}/[a-z0-9][a-z0-9_.-]{0,99}\z",
                RegexOptions.CultureInvariant)
            || m.Branch is null
            || !Regex.IsMatch(m.Branch,
                @"\A[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}\z",
                RegexOptions.CultureInvariant)
            || m.Branch.Contains("..",StringComparison.Ordinal)
            || m.Branch.Contains("//",StringComparison.Ordinal)
            || m.Branch.EndsWith("/",StringComparison.Ordinal)
            || !Regex.IsMatch(m.RevisionSha ?? "",
                @"\A[0-9a-f]{40}\z",RegexOptions.CultureInvariant)
            || !Regex.IsMatch(m.PrincipalSid ?? "",
                @"\AS-1-5-21-(?:[0-9]+-){2,}[0-9]+\z",RegexOptions.CultureInvariant)
            || !Regex.IsMatch(m.RequestId ?? "",
                @"\A[0-9a-f]{48}\z",RegexOptions.CultureInvariant)
            || !ReadDisclosureHash(m.QuerySha256)
            || !ReadDisclosureHash(m.ResultSetSha256)
            || !ReadDisclosureHash(m.RecipientSessionSha256))
            throw new ArgumentException("invalid_read_disclosure_meaning");
    }

    private static bool ReadDisclosureHash(string? value) =>
        value is not null && Regex.IsMatch(value,
            @"\A[0-9a-f]{64}\z",RegexOptions.CultureInvariant);

    private void RemoveExpiredReadDisclosures()
    {
        foreach (var id in _readDisclosurePending.Where(p =>
            _clock.GetElapsedTime(p.Value.StartedTick) >= Lifetime
            || _clock.GetUtcNow() >= p.Value.ExpiresUtc)
            .Select(p=>p.Key).ToArray())
            _readDisclosurePending.Remove(id);
    }
}
