using System.Security.Cryptography;
using System.Text.Json;
using AgentHub.C9.G3;
using AgentHub.C9.G3.Anchor;
using AgentHub.C9.G3.Witness;

namespace AgentHub.C9.G3.Audit;

// Deliberately matches the wire request already sent by the Anchor's AuditHttpBackend.
public sealed record AuditAdvanceWireV1(
    int Version, string Purpose, string ChallengeNonce, string TransitionId,
    AnchorHead Expected, AnchorHead Proposed, string SignedManifestBase64);

// The seal is a separate administrative/restore domain. An implementation MUST
// confirm durable immutable append and monotonic CAS BEFORE returning success.
// A disk file or a test fake cannot satisfy the production security contract.
public interface IIndependentImmutableSeal
{
    Task<AnchorHead?> ReadAsync(string scope, CancellationToken cancellationToken);
    Task<bool> CompareAndSealAsync(AnchorHead previous, AnchorHead next,
        string transitionId, string signedManifestBase64, CancellationToken cancellationToken);
}

// A service separate from the Anchor, with its own key and mTLS caller ACL.
// No enrollment/reset endpoint, no issuance of commit permission.
public sealed class AuditEngine(
    IAnchorJournal journal, IIndependentImmutableSeal seal, RootKeyPin trustedRoot,
    string auditKeyId, ECDsa signingKey)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private bool uncertain;

    private static bool ValidHead(AnchorHead h) =>
        WitnessProtocol.IsId(h.Scope) && h.Epoch > 0 && h.Revision > 0 &&
        WitnessProtocol.IsHex(h.ManifestSha256, 64) &&
        WitnessProtocol.IsId(h.RootKeyId) && WitnessProtocol.IsId(h.IssuerKeyId) &&
        WitnessProtocol.IsHex(h.IssuerSpkiSha256, 64);

    private static bool ValidRequest(AuditAdvanceWireV1 r) =>
        r.Version == 1 && r.Purpose == "G3_AUDIT_CAS" &&
        WitnessProtocol.IsHex(r.ChallengeNonce, 64) &&
        WitnessProtocol.IsHex(r.TransitionId, 32) &&
        r.Expected is not null && r.Proposed is not null &&
        ValidHead(r.Expected) && ValidHead(r.Proposed) &&
        r.SignedManifestBase64 is {Length: > 100 and <= 5500};

    private AnchorReceiptV1 Sign(AnchorHead h, string nonce, long now)
    {
        if (!ValidHead(h) || !WitnessProtocol.IsHex(nonce,64) ||
            !WitnessProtocol.IsId(auditKeyId) || signingKey.KeySize != 256 ||
            now is < 1577836800 or > 4102444770)
            throw new InvalidOperationException("AUDIT_SIGN_DENIED");
        var unsigned = new AnchorReceiptV1(1,auditKeyId,h.Scope,h.Epoch,h.Revision,
            h.ManifestSha256,h.RootKeyId,nonce,now,now+15,"");
        byte[] signature = signingKey.SignData(WitnessProtocol.AnchorCanonical(unsigned),
            HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence);
        return unsigned with {SignatureBase64=Convert.ToBase64String(signature)};
    }

    public async Task<AnchorReceiptV1?> GetCurrentAsync(AnchorQueryV1 query,
        long nowUnix,CancellationToken ct)
    {
        if (query is not {Version:1,Purpose:"G3_AUDIT_READ"} ||
            !WitnessProtocol.IsId(query.Scope) || !WitnessProtocol.IsHex(query.ChallengeNonce,64))
            return null;
        await gate.WaitAsync(ct);
        try
        {
            if (uncertain) return null;
            AnchorHead local=journal.Read();
            if (!ValidHead(local) || local.Scope!=query.Scope) return null;
            AnchorHead? immutable=await seal.ReadAsync(query.Scope,ct);
            if (immutable is null || immutable!=local) return null;
            return Sign(local,query.ChallengeNonce,nowUnix);
        }
        catch (Exception ex) when (ex is IOException or InvalidOperationException or
            CryptographicException or OperationCanceledException or HttpRequestException or JsonException)
        { uncertain=true; return null; }
        finally { gate.Release(); }
    }

    public async Task<AnchorReceiptV1?> CompareAndAnchorAsync(
        AuditAdvanceWireV1 request,long nowUnix,CancellationToken ct)
    {
        if (!ValidRequest(request)) return null;
        await gate.WaitAsync(ct);
        try
        {
            if (uncertain) return null;
            AnchorHead local=journal.Read();
            AnchorHead old=request.Expected,newHead=request.Proposed;
            if (local!=old || local.Scope!=newHead.Scope ||
                local.Epoch!=newHead.Epoch || local.RootKeyId!=newHead.RootKeyId ||
                old.Revision==long.MaxValue || newHead.Revision!=old.Revision+1 ||
                trustedRoot.RootKeyId!=old.RootKeyId) return null;
            AnchorHead? sealedHead=await seal.ReadAsync(old.Scope,ct);
            if (sealedHead is null || sealedHead!=old) return null;

            byte[] data;
            try { data=Convert.FromBase64String(request.SignedManifestBase64); }
            catch(FormatException) { return null; }
            if (data.Length is < 300 or > 4096 ||
                Convert.ToBase64String(data)!=request.SignedManifestBase64) return null;
            SignedTrustManifestV1? manifest;
            try {manifest=JsonSerializer.Deserialize<SignedTrustManifestV1>(data);}
            catch(JsonException){return null;}
            if (manifest is null || manifest.Revision!=newHead.Revision ||
                manifest.RootKeyId!=newHead.RootKeyId ||
                TrustBootstrap.ManifestSha256(manifest)!=newHead.ManifestSha256) return null;
            TrustBootstrapVerdict verified=TrustBootstrap.Verify(data,trustedRoot,
                new ProtectedTrustCheckpoint(newHead.Revision,newHead.ManifestSha256),nowUnix);
            TrustedKeySnapshot? issuer=verified.VerifiedIssuer;
            if (!verified.ManifestVerified || issuer is null || verified.CanExecuteCommit ||
                newHead.IssuerKeyId!=issuer.KeyId ||
                newHead.IssuerSpkiSha256!=issuer.ExpectedSpkiSha256 ||
                newHead.Revoked!=issuer.Revoked) return null;
            if (newHead.Revoked && (newHead.IssuerKeyId!=old.IssuerKeyId ||
                                   newHead.IssuerSpkiSha256!=old.IssuerSpkiSha256)) return null;
            if (!newHead.Revoked &&
                ((old.Revoked && (newHead.IssuerKeyId==old.IssuerKeyId ||
                                  newHead.IssuerSpkiSha256==old.IssuerSpkiSha256)) ||
                 journal.ContainsRevokedKey(newHead.IssuerKeyId,newHead.IssuerSpkiSha256))) return null;

            // Crossing this line might durably change the independent seal.
            // Failures, including a negative/timeout CAS result, latch UNKNOWN.
            uncertain=true;
            bool advanced=await seal.CompareAndSealAsync(old,newHead,request.TransitionId,
                request.SignedManifestBase64,ct);
            if(!advanced) return null;
            journal.Append(old,newHead,request.TransitionId); // Flush(true) in journal
            AnchorHead? rechecked=await seal.ReadAsync(old.Scope,ct);
            if(rechecked!=newHead) return null;
            uncertain=false;
            return Sign(newHead,request.ChallengeNonce,nowUnix);
        }
        catch(Exception ex) when(ex is IOException or InvalidOperationException or
            CryptographicException or OperationCanceledException or HttpRequestException or JsonException)
        { uncertain=true; return null; }
        finally { gate.Release(); }
    }
}
