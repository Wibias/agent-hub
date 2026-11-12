using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgentHub.C9.G3.Anchor;

// Local crash-detection journal only. The independent WORM authority, not this
// hash chain, must prevent rollback of a complete disk/VM snapshot.
public sealed class AnchorJournal : IAnchorJournal, IDisposable
{
    private sealed record Entry(long Sequence, string TransitionId, AnchorHead Head,
        string PreviousHash, string EntryHash);

    private static readonly JsonSerializerOptions StrictJson = new() {
        PropertyNameCaseInsensitive=false, UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow
    };
    private const int MaxJournalBytes = 16 * 1024 * 1024;
    private readonly FileStream stream;
    private bool unusable;

    // No create/open-or-create in service: genesis must be provisioned separately.
    public AnchorJournal(string existingAbsolutePath)
    {
        if (!Path.IsPathFullyQualified(existingAbsolutePath) ||
            !File.Exists(existingAbsolutePath))
            throw new InvalidOperationException("ANCHOR_JOURNAL_MISSING");
        stream = new FileStream(existingAbsolutePath,FileMode.Open,FileAccess.ReadWrite,
            FileShare.None,4096,FileOptions.WriteThrough);
        try { _ = Load(); }
        catch { stream.Dispose(); throw; }
    }

    private static bool ValidHead(AnchorHead h) =>
        AgentHub.C9.G3.Witness.WitnessProtocol.IsId(h.Scope) &&
        h.Epoch>=1 && h.Revision>=1 &&
        AgentHub.C9.G3.Witness.WitnessProtocol.IsHex(h.ManifestSha256,64) &&
        AgentHub.C9.G3.Witness.WitnessProtocol.IsId(h.RootKeyId) &&
        AgentHub.C9.G3.Witness.WitnessProtocol.IsId(h.IssuerKeyId) &&
        AgentHub.C9.G3.Witness.WitnessProtocol.IsHex(h.IssuerSpkiSha256,64);

    private static string Hash(long seq,string id,AnchorHead head,string previous) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            "agenthub-c9-anchor-local-log-v1\n" + seq.ToString(CultureInfo.InvariantCulture) +
            "\n"+id+"\n"+JsonSerializer.Serialize(head)+"\n"+previous+"\n"))).ToLowerInvariant();

    private static Entry NewEntry(long seq,string id,AnchorHead head,string prev) =>
        new(seq,id,head,prev,Hash(seq,id,head,prev));

    public static byte[] EncodeGenesisForOfflineProvisioner(AnchorHead initial)
    {
        if (!ValidHead(initial)) throw new ArgumentException("INVALID_GENESIS");
        return Encoding.UTF8.GetBytes(JsonSerializer.Serialize(NewEntry(1,"genesis",initial,new string('0',64)))+"\n");
    }

    private List<Entry> Load()
    {
        if (unusable) throw new InvalidOperationException("ANCHOR_JOURNAL_POISONED");
        if (stream.Length is < 100 or > MaxJournalBytes)
            throw new InvalidOperationException("ANCHOR_JOURNAL_SIZE_DENIED");
        stream.Position=0;
        var bytes = new byte[checked((int)stream.Length)];
        stream.ReadExactly(bytes);
        if (bytes[^1] != (byte)'\n') throw new InvalidOperationException("ANCHOR_JOURNAL_TORN_TAIL");
        string source = new UTF8Encoding(false,true).GetString(bytes);
        var lines=source.Split('\n',StringSplitOptions.None);
        if (lines.Length < 2 || lines[^1] != "")throw new InvalidOperationException("ANCHOR_JOURNAL_BAD_END");
        var list=new List<Entry>();
        string previous = new string('0',64);
        for(int i=0;i<lines.Length-1;i++)
        {
            if(lines[i].Length is < 100 or > 4096)
                throw new InvalidOperationException("ANCHOR_JOURNAL_LINE_DENIED");
            // Reject duplicate JSON members even within the nested head.
            using JsonDocument doc=JsonDocument.Parse(lines[i]);
            CheckObject(doc.RootElement);
            Entry e=JsonSerializer.Deserialize<Entry>(lines[i],StrictJson)
                ?? throw new InvalidOperationException("ANCHOR_JOURNAL_PARSE_DENIED");
            if(e.Head is null || !ValidHead(e.Head) || e.Sequence != i+1 ||
                e.PreviousHash != previous ||
                !AgentHub.C9.G3.Witness.WitnessProtocol.IsHex(e.EntryHash,64) ||
                e.EntryHash != Hash(e.Sequence,e.TransitionId,e.Head,e.PreviousHash))
                throw new InvalidOperationException("ANCHOR_JOURNAL_CHAIN_DENIED");
            if(i==0 && e.TransitionId!="genesis")throw new InvalidOperationException("ANCHOR_JOURNAL_NO_GENESIS");
            if(i>0)
            {
                AnchorHead old=list[^1].Head;
                if(!AgentHub.C9.G3.Witness.WitnessProtocol.IsHex(e.TransitionId,32) ||
                   e.Head.Scope != old.Scope || e.Head.Epoch != old.Epoch ||
                   old.Revision == long.MaxValue || e.Head.Revision != old.Revision+1 ||
                   e.Head.RootKeyId != old.RootKeyId)
                    throw new InvalidOperationException("ANCHOR_JOURNAL_NONMONOTONIC");
            }
            list.Add(e); previous=e.EntryHash;
        }
        return list;
    }

    private static void CheckObject(JsonElement e)
    {
        if(e.ValueKind!=JsonValueKind.Object)throw new InvalidOperationException("ANCHOR_JOURNAL_OBJECT_REQUIRED");
        var keys=new HashSet<string>(StringComparer.Ordinal);
        foreach(JsonProperty p in e.EnumerateObject())
        {
            if(!keys.Add(p.Name))throw new InvalidOperationException("ANCHOR_JOURNAL_DUPLICATE_FIELD");
            if(p.Value.ValueKind==JsonValueKind.Object)CheckObject(p.Value);
        }
    }

    public AnchorHead Read() => Load()[^1].Head;

    public bool ContainsRevokedKey(string keyId,string spkiSha256) =>
        Load().Exists(e=>e.Head.Revoked &&
            (e.Head.IssuerKeyId==keyId || e.Head.IssuerSpkiSha256==spkiSha256));

    public void Append(AnchorHead expected, AnchorHead next,string transitionId)
    {
        if(unusable)throw new InvalidOperationException("ANCHOR_JOURNAL_POISONED");
        try
        {
            List<Entry> events=Load();
            Entry previous=events[^1];
            if(previous.Head!=expected || !ValidHead(next) ||
                !AgentHub.C9.G3.Witness.WitnessProtocol.IsHex(transitionId,32) ||
                events.Exists(e=>e.TransitionId==transitionId) ||
                next.Scope!=expected.Scope || next.Epoch!=expected.Epoch ||
                expected.Revision==long.MaxValue || next.Revision!=expected.Revision+1 ||
                next.RootKeyId!=expected.RootKeyId)
                throw new InvalidOperationException("ANCHOR_JOURNAL_CAS_DENIED");
            byte[] data=Encoding.UTF8.GetBytes(JsonSerializer.Serialize(
                NewEntry(previous.Sequence+1,transitionId,next,previous.EntryHash))+"\n");
            if(stream.Length + data.Length > MaxJournalBytes)
                throw new InvalidOperationException("ANCHOR_JOURNAL_CAPACITY_DENIED");
            stream.Position=stream.Length;
            stream.Write(data);
            stream.Flush(flushToDisk:true);
            if(Read()!=next)throw new InvalidOperationException("ANCHOR_JOURNAL_VERIFY_FAILED");
        }
        catch { unusable=true; throw; }
    }

    public void Dispose() => stream.Dispose();
}
