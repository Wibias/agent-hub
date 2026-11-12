using System.Security.Cryptography;
using System.Text.Json;
using AgentHub.C9.G3;
using AgentHub.C9.G3.Witness;

namespace AgentHub.C9.G3.Anchor;

public sealed record AnchorHead(
    string Scope, long Epoch, long Revision, string ManifestSha256,
    string RootKeyId, string IssuerKeyId, string IssuerSpkiSha256, bool Revoked);

public sealed record AdvanceRequestV1(
    int Version, string Scope, string TransitionId, long ExpectedEpoch,
    long ExpectedRevision, string ExpectedManifestSha256, string SignedManifestBase64,
    string Reason, string OwnerApprovalReference);

public readonly record struct AdvanceOutcome(string State, AnchorHead? Head)
{
    public bool Committed => State == "COMMITTED";
    public static AdvanceOutcome Deny(string reason) => new(reason, null);
}

// This interface is a SECURITY BOUNDARY, not an in-process cache. Its real adapter
// must independently authenticate off-host signed replies and enforce durable WORM CAS.
public interface IIndependentAudit
{
    Task<AnchorHead?> GetCurrentAsync(string scope, CancellationToken ct);
    Task<bool> CompareAndAnchorAsync(AnchorHead oldHead, AnchorHead newHead,
        string transitionId, string signedManifestBase64, CancellationToken ct);
}

public interface IAnchorJournal
{
    AnchorHead Read();
    bool ContainsRevokedKey(string keyId, string spkiSha256);
    void Append(AnchorHead expected, AnchorHead next, string transitionId);
}

public sealed class AnchorEngine(
    IAnchorJournal journal, IIndependentAudit audit, RootKeyPin trustedRoot,
    string anchorKeyId, ECDsa signingKey)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private bool uncertain;

    // Audit receipt intentionally covers only the canonical manifest hash, scope,
    // epoch, revision and root ID. Full issuer identity is bound by that hash.
    private static bool EqualsHead(AnchorHead x, AnchorHead y) =>
        x.Scope == y.Scope && x.Epoch == y.Epoch && x.Revision == y.Revision &&
        x.ManifestSha256 == y.ManifestSha256 && x.RootKeyId == y.RootKeyId;

    public async Task<AnchorReceiptV1?> GetCurrentAsync(
        AnchorQueryV1 query, long nowUnix, CancellationToken cancellationToken)
    {
        if (query is not {Version:1,Purpose:"G3_ANCHOR_READ"} ||
            !WitnessProtocol.IsId(query.Scope) || !WitnessProtocol.IsHex(query.ChallengeNonce,64))
            return null;
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (uncertain) return null;
            AnchorHead local = journal.Read();
            if (local.Scope != query.Scope || local.Epoch < 1 || local.Revision < 1) return null;
            AnchorHead? independent = await audit.GetCurrentAsync(query.Scope, cancellationToken);
            if (independent is null || !EqualsHead(local, independent)) return null;
            if (nowUnix is < 1577836800 or > 4102444770) return null;
            if (!WitnessProtocol.IsId(anchorKeyId) || signingKey.KeySize != 256) return null;
            var unsigned = new AnchorReceiptV1(1, anchorKeyId, local.Scope,
                local.Epoch, local.Revision, local.ManifestSha256, local.RootKeyId,
                query.ChallengeNonce, nowUnix, nowUnix + 15, "");
            byte[] signature = signingKey.SignData(WitnessProtocol.AnchorCanonical(unsigned),
                HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
            return unsigned with {SignatureBase64 = Convert.ToBase64String(signature)};
        }
        catch (Exception e) when (e is IOException or CryptographicException or InvalidOperationException or
                                      JsonException or HttpRequestException or OperationCanceledException)
        { uncertain = true; return null; }
        finally { gate.Release(); }
    }

    public async Task<AdvanceOutcome> AdvanceHeadAsync(
        AdvanceRequestV1 request, long nowUnix, CancellationToken cancellationToken)
    {
        if (request is not {Version:1} || !WitnessProtocol.IsId(request.Scope) ||
            !WitnessProtocol.IsHex(request.TransitionId,32) ||
            !WitnessProtocol.IsHex(request.ExpectedManifestSha256,64) ||
            !WitnessProtocol.IsId(request.OwnerApprovalReference) ||
            request.Reason is not ("rotate" or "revoke") ||
            request.SignedManifestBase64 is null || request.SignedManifestBase64.Length > 5500)
            return AdvanceOutcome.Deny("BAD_REQUEST");
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (uncertain) return AdvanceOutcome.Deny("UNCERTAIN_STATE");
            AnchorHead current = journal.Read();
            if (current.Scope != request.Scope || current.Epoch != request.ExpectedEpoch ||
                current.Revision != request.ExpectedRevision ||
                current.ManifestSha256 != request.ExpectedManifestSha256)
                return AdvanceOutcome.Deny("CAS_MISMATCH");
            AnchorHead? anchored = await audit.GetCurrentAsync(current.Scope,cancellationToken);
            if (anchored is null || !EqualsHead(anchored,current))
                return AdvanceOutcome.Deny("EXTERNAL_HEAD_MISMATCH");
            byte[] manifestBytes;
            try { manifestBytes=Convert.FromBase64String(request.SignedManifestBase64); }
            catch (FormatException) { return AdvanceOutcome.Deny("MALFORMED_MANIFEST"); }
            if (manifestBytes.Length is < 300 or > 4096 ||
                Convert.ToBase64String(manifestBytes) != request.SignedManifestBase64)
                return AdvanceOutcome.Deny("MALFORMED_MANIFEST");
            SignedTrustManifestV1? manifest;
            try { manifest = JsonSerializer.Deserialize<SignedTrustManifestV1>(manifestBytes); }
            catch (JsonException) { return AdvanceOutcome.Deny("MALFORMED_MANIFEST"); }
            if (manifest is null || current.Revision == long.MaxValue ||
                manifest.Revision != current.Revision + 1 || manifest.RootKeyId != current.RootKeyId)
                return AdvanceOutcome.Deny("NON_MONOTONIC_OR_ROOT_CHANGE");
            string hash=TrustBootstrap.ManifestSha256(manifest);
            var verified=TrustBootstrap.Verify(manifestBytes,trustedRoot,
                new ProtectedTrustCheckpoint(manifest.Revision,hash),nowUnix);
            if (!verified.ManifestVerified || verified.VerifiedIssuer is null || verified.CanExecuteCommit)
                return AdvanceOutcome.Deny("MANIFEST_INVALID");
            var issuer=verified.VerifiedIssuer;
            if (request.Reason == "rotate" && issuer.Revoked ||
                request.Reason == "revoke" && !issuer.Revoked)
                return AdvanceOutcome.Deny("TRANSITION_REASON_MISMATCH");
            if (request.Reason == "rotate" &&
                (current.Revoked && (current.IssuerKeyId == issuer.KeyId ||
                                     current.IssuerSpkiSha256 == issuer.ExpectedSpkiSha256) ||
                 journal.ContainsRevokedKey(issuer.KeyId,issuer.ExpectedSpkiSha256)))
                return AdvanceOutcome.Deny("REVOKED_KEY_REUSE");
            if (request.Reason == "revoke" &&
                (issuer.KeyId != current.IssuerKeyId ||
                 issuer.ExpectedSpkiSha256 != current.IssuerSpkiSha256))
                return AdvanceOutcome.Deny("REVOKE_MUST_IDENTIFY_CURRENT_KEY");
            var next=new AnchorHead(current.Scope,current.Epoch,manifest.Revision,hash,
                current.RootKeyId,issuer.KeyId,issuer.ExpectedSpkiSha256,issuer.Revoked);
            // External CAS is required to be durable and independently immutable before ACK.
            // From here on ANY failure may mean remote state advanced. Latch deny-only.
            uncertain = true;
            bool committed = await audit.CompareAndAnchorAsync(current,next,request.TransitionId,
                request.SignedManifestBase64,cancellationToken);
            if (!committed) return AdvanceOutcome.Deny("EXTERNAL_CAS_UNKNOWN_OR_DENIED");
            journal.Append(current,next,request.TransitionId);
            AnchorHead? rechecked=await audit.GetCurrentAsync(current.Scope,cancellationToken);
            if (rechecked is null || !EqualsHead(rechecked,next))
                return AdvanceOutcome.Deny("POST_COMMIT_ANCHOR_MISMATCH");
            uncertain = false;
            return new AdvanceOutcome("COMMITTED", next);
        }
        catch (Exception e) when (e is IOException or InvalidOperationException or
                                  CryptographicException or OperationCanceledException or
                                  JsonException or HttpRequestException)
        { uncertain = true; return AdvanceOutcome.Deny("UNKNOWN_FAIL_CLOSED"); }
        finally { gate.Release(); }
    }
}
