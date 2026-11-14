using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MemoryReviewAuthority.Core;
using MemoryReviewAuthority.Store;

namespace MemoryReviewAuthority.LabService;

/// <summary>
/// A disposable, explicitly synthetic fixture inside AgentHubMemoryReviewLab.
/// This is NEVER a user's WebAuthn assertion and must not be interpreted as
/// human authorization. Production must not reuse this synthetic facility.
/// </summary>
internal static class SyntheticLabClaim
{
    private static string Hash(string value) => Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private static string Encode(byte[] data) => Convert.ToBase64String(data)
        .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    internal static void Seed(ProtectedPendingReviewLedger store)
    {
        const string value = "Synthetic non-authorizing lab fact";
        var pending = new PendingReview(
            SignedProtectedClaimPipe.FixtureProject,
            SignedProtectedClaimPipe.FixtureBranch,
            new string('a', 40),
            "E~0123456789",
            new string('b', 64),
            Hash(value),
            Hash("Synthetic non-authorizing lab Evidence"),
            "confirm");
        var first = store.RecordPending(pending);
        if (first != store.RecordPending(pending) || store.CountPending() != 1)
            throw new InvalidOperationException("synthetic_pending_fixture_failed");

        // Ephemeral P-256 key proves the existing *verification code path*,
        // not the presence of an actual person or enrolled Windows credential.
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var credential = new PinnedCredential(
            Encode(RandomNumberGenerator.GetBytes(32)),
            key.ExportSubjectPublicKeyInfoPem(), "http://localhost:4328");
        var meaning = new ReviewMeaning(
            pending.ProjectId, pending.Branch, pending.RevisionSha,
            pending.ProposalRef, pending.ReviewSnapshotSha256,
            pending.CanonicalFactSha256, pending.RequestedAction, value);
        var coordinator = new VerifiedReviewCoordinator(store, credential,
            trustedSourceReader: _ => new TrustedReviewSource(
                pending.ProjectId, pending.Branch, pending.RevisionSha,
                pending.ProposalRef, pending.ReviewSnapshotSha256, value,
                pending.SourceEvidenceSha256, "knowledge", "unrelated", null));
        var ticket = coordinator.Begin(meaning);
        var client = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(
            new Dictionary<string, object>
            {
                ["type"] = "webauthn.get",
                ["challenge"] = ticket.ChallengeBase64Url,
                ["origin"] = credential.ExpectedOrigin,
                ["crossOrigin"] = false,
            }));
        var auth = new byte[37];
        SHA256.HashData(Encoding.UTF8.GetBytes("localhost")).CopyTo(auth, 0);
        auth[32] = 0x05;
        BinaryPrimitives.WriteUInt32BigEndian(auth.AsSpan(33), 1);
        var signed = new byte[auth.Length + 32];
        auth.CopyTo(signed, 0);
        SHA256.HashData(client).CopyTo(signed, auth.Length);
        var proof = new BrowserAssertion(credential.CredentialIdBase64Url,
            "public-key", Encode(client), Encode(auth),
            Encode(key.SignData(signed, HashAlgorithmName.SHA256,
                DSASignatureFormat.Rfc3279DerSequence)));
        var completed = coordinator.CompleteProtected(ticket.TicketId,
            meaning, proof);
        if (!completed.Verified || !completed.ClaimWritten
            || store.ReadProtectedClaims(pending.ProjectId, pending.Branch).Count != 1)
            throw new InvalidOperationException("synthetic_claim_fixture_failed");
    }
}
