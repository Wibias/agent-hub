using AgentHub.C9.G3.Anchor;
using AgentHub.C9.G3.Audit;
using AgentHub.C9.G3.Witness;

namespace AgentHub.C9.G3.LocalDev;

// Deliberately compiled into the TEST executable only, never into a server assembly.
// A second local hash-chained journal is NOT an independently immutable seal.
internal sealed class LocalDevSeal : IIndependentImmutableSeal, IDisposable
{
    private readonly AnchorJournal journal;
    private readonly SemaphoreSlim gate = new(1, 1);

    public LocalDevSeal(string existingPath)
    {
        if (Environment.GetEnvironmentVariable("C9_G3_INSECURE_LOCAL_LAB") != "EXPLICIT_TEST_ONLY")
            throw new InvalidOperationException("DEV_SEAL_NOT_AUTHORIZED");
        journal = new AnchorJournal(existingPath);
    }

    public async Task<AnchorHead?> ReadAsync(string scope, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            AnchorHead current = journal.Read();
            return WitnessProtocol.IsId(scope) && current.Scope == scope ? current : null;
        }
        finally { gate.Release(); }
    }

    public async Task<bool> CompareAndSealAsync(AnchorHead previous, AnchorHead next,
        string transitionId, string signedManifestBase64, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            if (!WitnessProtocol.IsHex(transitionId, 32) ||
                journal.Read() != previous ||
                previous.Scope != next.Scope ||
                previous.Epoch != next.Epoch ||
                previous.RootKeyId != next.RootKeyId ||
                previous.Revision == long.MaxValue ||
                next.Revision != previous.Revision + 1 ||
                (!next.Revoked && journal.ContainsRevokedKey(next.IssuerKeyId, next.IssuerSpkiSha256)))
                return false;
            // The AuditEngine verified the signed manifest before calling this method.
            // This local journal append is a test surrogate, never a WORM approval.
            journal.Append(previous, next, transitionId);
            return journal.Read() == next;
        }
        finally { gate.Release(); }
    }

    public void Dispose()
    {
        journal.Dispose();
        gate.Dispose();
    }
}
