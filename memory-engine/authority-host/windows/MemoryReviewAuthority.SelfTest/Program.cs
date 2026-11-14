using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MemoryReviewAuthority.Core;

internal static class Program
{
    private static int _passed;
    private static readonly string Fact = "AgentHub supports Windows x64.";
    private static readonly ReviewMeaning Meaning = new(
        "github.com/Wibias/agent-hub",
        "main",
        new string('a', 40),
        "E~0123456789",
        new string('b', 64),
        HashHex(Fact),
        "confirm",
        Fact);

    private static void Main()
    {
        Run("cross_language_challenge_vector", ChallengeVector);
        Run("valid_uv_assertion_is_not_claim_authority", ValidAssertion);
        Run("reject_missing_user_presence_and_verification", MissingUserVerification);
        Run("reject_wrong_signature_and_credential", WrongSignature);
        Run("reject_wrong_rp_and_origin", WrongOrigin);
        Run("reject_wrong_review_meaning", WrongMeaning);
        Run("failed_attempt_consumes_challenge", FailedAttemptConsumes);
        Run("valid_attempt_consumes_challenge", SuccessfulAttemptConsumes);
        Run("reject_counter_replay", CounterReplay);
        Run("zero_sign_counter_has_no_replay_claim", ZeroSignCounter);
        Run("reject_duplicate_pending_proposal", DuplicateProposal);
        Run("reject_expired_challenge", Expired);
        Run("pending_is_not_persisted_over_restart", NoPersistence);
        Run("bounded_queue_capacity", Capacity);
        Run("reject_invalid_fact_and_nonlocal_origin", InvalidInputs);
        Console.WriteLine($"MEMORY_AUTHORITY_CORE PASS {_passed}/15; NO_SERVICE NO_DB_WRITE NO_AUTHORIZATION");
    }

    private static void Run(string name, Action test)
    {
        try
        {
            test();
            _passed++;
            Console.WriteLine("PASS " + name);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("FAIL " + name + ": " + error.GetType().Name + ": " + error.Message);
            Environment.ExitCode = 1;
            throw;
        }
    }

    private static void ChallengeVector()
    {
        var nonce = Enumerable.Range(0, 32).Select(i => (byte)i).ToArray();
        var challenge = ReviewChallengeCore.ComputeChallenge(Meaning, nonce);
        Equal("DGdOkW0EmbuTLfgLiJUZwCoZ3onR1PxJdS-da6sLkMs", challenge);
        Throws<ArgumentOutOfRangeException>(() =>
            ReviewChallengeCore.ComputeChallenge(Meaning, new byte[4]));
        Check(ReviewChallengeCore.ComputeChallenge(Meaning with { Decision = "reject" }, nonce) != challenge);
        Check(ReviewChallengeCore.ComputeChallenge(Meaning with { RevisionSha = new string('c', 40) }, nonce) != challenge);
    }

    private static void ValidAssertion()
    {
        using var credential = TestCredential.New();
        var host = new ReviewChallengeCore();
        var ticket = host.Begin(Meaning, credential.Pinned);
        Check(ticket.ExpiresUtc > DateTimeOffset.UtcNow);
        Equal(Meaning, ticket.Meaning);
        var result = host.VerifyAndConsume(ticket.TicketId, Meaning, credential.Sign(ticket));
        Check(result.Verified && result.UserPresent && result.UserVerified);
        Check(result.SignCount == 1);
        Check(!result.ApprovedReviewDecision && !result.ClaimWritten);
    }

    private static void MissingUserVerification()
    {
        foreach (var flags in new byte[] { 0, 0x01, 0x04, 0x10 })
        {
            using var credential = TestCredential.New();
            var host = new ReviewChallengeCore();
            var ticket = host.Begin(Meaning, credential.Pinned);
            var result = host.VerifyAndConsume(ticket.TicketId, Meaning, credential.Sign(ticket, flags));
            Check(!result.Verified && !result.ApprovedReviewDecision);
        }
    }

    private static void WrongSignature()
    {
        using var credential = TestCredential.New();
        using var other = TestCredential.New();
        var host = new ReviewChallengeCore();
        var ticket = host.Begin(Meaning, credential.Pinned);
        var badId = credential.Sign(ticket) with { CredentialIdBase64Url = other.Pinned.CredentialIdBase64Url };
        Check(!host.VerifyAndConsume(ticket.TicketId, Meaning, badId).Verified);

        var ticket2 = host.Begin(Meaning, credential.Pinned);
        var good = credential.Sign(ticket2);
        var badSig = good with { SignatureBase64Url = Encode(RandomNumberGenerator.GetBytes(70)) };
        Check(!host.VerifyAndConsume(ticket2.TicketId, Meaning, badSig).Verified);
    }

    private static void WrongOrigin()
    {
        using var credential = TestCredential.New();
        var host = new ReviewChallengeCore();
        var t1 = host.Begin(Meaning, credential.Pinned);
        Check(!host.VerifyAndConsume(t1.TicketId, Meaning,
            credential.Sign(t1, origin: "http://evil.example:4328")).Verified);
        var t2 = host.Begin(Meaning, credential.Pinned);
        Check(!host.VerifyAndConsume(t2.TicketId, Meaning,
            credential.Sign(t2, rpId: "evil.example")).Verified);
    }

    private static void WrongMeaning()
    {
        using var credential = TestCredential.New();
        var host = new ReviewChallengeCore();
        var ticket = host.Begin(Meaning, credential.Pinned);
        var forged = Meaning with { Decision = "reject" };
        Check(!host.VerifyAndConsume(ticket.TicketId, forged, credential.Sign(ticket)).Verified);
        Check(!host.VerifyAndConsume(ticket.TicketId, Meaning, credential.Sign(ticket)).Verified);
    }

    private static void FailedAttemptConsumes()
    {
        using var credential = TestCredential.New();
        var host = new ReviewChallengeCore();
        var ticket = host.Begin(Meaning, credential.Pinned);
        var attempt = credential.Sign(ticket, flags:0x01);
        Check(!host.VerifyAndConsume(ticket.TicketId, Meaning, attempt).Verified);
        Check(!host.VerifyAndConsume(ticket.TicketId, Meaning, credential.Sign(ticket)).Verified);
    }

    private static void SuccessfulAttemptConsumes()
    {
        using var credential = TestCredential.New();
        var host = new ReviewChallengeCore();
        var ticket = host.Begin(Meaning, credential.Pinned);
        Check(host.VerifyAndConsume(ticket.TicketId, Meaning, credential.Sign(ticket)).Verified);
        Check(!host.VerifyAndConsume(ticket.TicketId, Meaning, credential.Sign(ticket)).Verified);
    }

    private static void CounterReplay()
    {
        using var credential = TestCredential.New();
        var host = new ReviewChallengeCore();
        var a = host.Begin(Meaning, credential.Pinned);
        Check(host.VerifyAndConsume(a.TicketId, Meaning, credential.Sign(a, counter:7)).Verified);
        var b = host.Begin(Meaning, credential.Pinned);
        Check(!host.VerifyAndConsume(b.TicketId, Meaning, credential.Sign(b, counter:7)).Verified);
        var c = host.Begin(Meaning, credential.Pinned);
        var result = host.VerifyAndConsume(c.TicketId, Meaning, credential.Sign(c, counter:8));
        Check(result.Verified && result.SignCounterVerifiable);
    }

    private static void ZeroSignCounter()
    {
        using var credential = TestCredential.New();
        var host = new ReviewChallengeCore();
        var a = host.Begin(Meaning, credential.Pinned);
        Check(host.VerifyAndConsume(a.TicketId, Meaning, credential.Sign(a, counter:7)).Verified);
        var b = host.Begin(Meaning, credential.Pinned);
        var zero = host.VerifyAndConsume(b.TicketId, Meaning, credential.Sign(b, counter:0));
        Check(zero.Verified && !zero.SignCounterVerifiable);
    }

    private static void DuplicateProposal()
    {
        using var credential = TestCredential.New();
        var host = new ReviewChallengeCore();
        _ = host.Begin(Meaning, credential.Pinned);
        Throws<InvalidOperationException>(() =>
            host.Begin(Meaning with { Decision = "reject" }, credential.Pinned));
    }

    private static void Expired()
    {
        using var credential = TestCredential.New();
        var time = new FakeClock();
        var host = new ReviewChallengeCore(time);
        var ticket = host.Begin(Meaning, credential.Pinned);
        time.Advance(TimeSpan.FromMinutes(2));
        Check(!host.VerifyAndConsume(ticket.TicketId, Meaning, credential.Sign(ticket)).Verified);
    }

    private static void NoPersistence()
    {
        using var credential = TestCredential.New();
        var ticket = new ReviewChallengeCore().Begin(Meaning, credential.Pinned);
        var restarted = new ReviewChallengeCore();
        Check(!restarted.VerifyAndConsume(ticket.TicketId, Meaning, credential.Sign(ticket)).Verified);
    }

    private static void Capacity()
    {
        using var credential = TestCredential.New();
        var host = new ReviewChallengeCore();
        for (int n=0; n<ReviewChallengeCore.MaxPending; n++)
        {
            var meaning = Meaning with { ProposalRef = "E~" + n.ToString("x10") };
            _ = host.Begin(meaning, credential.Pinned);
        }
        Throws<InvalidOperationException>(() =>
            host.Begin(Meaning with { ProposalRef = "E~9999999999" }, credential.Pinned));
    }

    private static void InvalidInputs()
    {
        using var credential = TestCredential.New();
        var host = new ReviewChallengeCore();
        Throws<ArgumentException>(() =>
            host.Begin(Meaning with { CanonicalFact = "Different content" }, credential.Pinned));
        Throws<ArgumentException>(() =>
            host.Begin(Meaning, credential.Pinned with { ExpectedOrigin = "http://evil.example" }));
    }

    private static string HashHex(string input)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(input))).ToLowerInvariant();

    private static string Encode(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static void Equal<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new Exception("expected " + expected + ", got " + actual);
    }

    private static void Check(bool value)
    {
        if (!value) throw new Exception("assertion failed");
    }

    private static void Throws<T>(Action action) where T:Exception
    {
        try { action(); }
        catch (T) { return; }
        throw new Exception("Expected " + typeof(T).Name);
    }

    private sealed class TestCredential : IDisposable
    {
        private readonly ECDsa _key;
        public PinnedCredential Pinned { get; }

        private TestCredential(ECDsa key)
        {
            _key = key;
            Pinned = new PinnedCredential(Encode(RandomNumberGenerator.GetBytes(32)),
                key.ExportSubjectPublicKeyInfoPem(), "http://localhost:4328");
        }

        public static TestCredential New()
            => new(ECDsa.Create(ECCurve.NamedCurves.nistP256));

        public BrowserAssertion Sign(ChallengeTicket ticket, byte flags=0x05, uint counter=1,
            string? origin=null, string? rpId=null)
        {
            var client = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Dictionary<string,object>
            {
                ["type"]="webauthn.get",
                ["challenge"]=ticket.ChallengeBase64Url,
                ["origin"]=origin ?? Pinned.ExpectedOrigin,
                ["crossOrigin"]=false,
            }));
            var auth = new byte[37];
            SHA256.HashData(Encoding.UTF8.GetBytes(rpId ?? "localhost")).CopyTo(auth, 0);
            auth[32] = flags;
            BinaryPrimitives.WriteUInt32BigEndian(auth.AsSpan(33), counter);
            var signed = new byte[auth.Length + 32];
            auth.CopyTo(signed, 0);
            SHA256.HashData(client).CopyTo(signed, auth.Length);
            var signature = _key.SignData(signed,
                HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
            return new BrowserAssertion(
                Pinned.CredentialIdBase64Url,
                "public-key",
                Encode(client),
                Encode(auth),
                Encode(signature));
        }

        public void Dispose() => _key.Dispose();
    }

    private sealed class FakeClock : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 11, 14, 12, 0, 0, TimeSpan.Zero);
        private long _ticks;
        public override DateTimeOffset GetUtcNow() => _now;
        public override long GetTimestamp() => _ticks;
        public override long TimestampFrequency => 1_000_000;
        public void Advance(TimeSpan duration)
        {
            _now += duration;
            _ticks += (long)(duration.TotalSeconds * TimestampFrequency);
        }
    }
}
