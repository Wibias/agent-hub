using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AgentHub.C9.G345;

public sealed record G4Claim(
    string TicketId, string RequestId, string Nonce, string TicketSha256,
    string VolumeId, string FileId, string PreimageSha256);

public readonly record struct G4ReservationVerdict(string Reason, bool Reserved, bool CanExecuteCommit)
{
    public static G4ReservationVerdict Deny(string reason) => new(reason, false, false);
}

// Review-only, local durable reservation journal. It is NOT an independent WORM witness.
// Reverting the complete journal or VM snapshot can undo consumed nonces.
public sealed class G4NonceJournal : IDisposable
{
    private sealed record Entry(
        long Sequence, string TicketId, string RequestId, string Nonce,
        string TicketSha256, string VolumeId, string FileId, string PreimageSha256,
        string PreviousHash, string EntryHash);

    private const string Header = "agenthub-c9-g4-nonce-journal-v1\n";
    private const int MaxFileBytes = 16 * 1024 * 1024;
    private const int MaxEntryBytes = 2048;
    private static readonly string[] Fields = [
        "Sequence", "TicketId", "RequestId", "Nonce", "TicketSha256",
        "VolumeId", "FileId", "PreimageSha256", "PreviousHash", "EntryHash"
    ];
    private readonly FileStream stream;
    private readonly object reservationLock = new();
    private bool unusable;

    public static byte[] EncodeEmptyForOfflineTestProvisioner() => Encoding.ASCII.GetBytes(Header);

    // Existing, separately provisioned absolute file only. Never auto-create, truncate or repair.
    // Exclusive open denies another process trying to create a concurrent reservation view.
    public G4NonceJournal(string existingAbsolutePath)
    {
        if (string.IsNullOrEmpty(existingAbsolutePath) ||
            !Path.IsPathFullyQualified(existingAbsolutePath) || !File.Exists(existingAbsolutePath))
            throw new InvalidOperationException("G4_JOURNAL_NOT_PROVISIONED");
        stream = new FileStream(existingAbsolutePath, FileMode.Open, FileAccess.ReadWrite,
            FileShare.None, 4096, FileOptions.WriteThrough);
        try { _ = ReadAll(); }
        catch { stream.Dispose(); throw; }
    }

    private static bool Hex(string? value, int size) =>
        value is not null && value.Length == size &&
        value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');

    private static bool Valid(G4Claim x) =>
        Hex(x.TicketId, 32) && Hex(x.RequestId, 32) && Hex(x.Nonce, 32) &&
        Hex(x.TicketSha256, 64) && Hex(x.VolumeId, 16) &&
        Hex(x.FileId, 32) && Hex(x.PreimageSha256, 64);

    private static string Hash(long sequence, G4Claim x, string previous) =>
        Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(string.Join("\n", new string[] {
            "agenthub-c9-g4-reservation-entry-v1", sequence.ToString(CultureInfo.InvariantCulture),
            x.TicketId, x.RequestId, x.Nonce, x.TicketSha256, x.VolumeId,
            x.FileId, x.PreimageSha256, previous, ""
        } )))).ToLowerInvariant();

    private static Entry Make(long number, G4Claim x, string prev) =>
        new(number, x.TicketId, x.RequestId, x.Nonce, x.TicketSha256,
            x.VolumeId, x.FileId, x.PreimageSha256, prev, Hash(number, x, prev));

    private List<Entry> ReadAll()
    {
        if (unusable) throw new InvalidOperationException("G4_JOURNAL_POISONED");
        if (stream.Length < Header.Length || stream.Length > MaxFileBytes)
            throw new InvalidOperationException("G4_JOURNAL_SIZE_DENIED");
        stream.Position = 0;
        byte[] bytes = new byte[checked((int)stream.Length)];
        stream.ReadExactly(bytes);
        string contents = new UTF8Encoding(false, true).GetString(bytes);
        if (!contents.StartsWith(Header, StringComparison.Ordinal) || contents[^1] != '\n')
            throw new InvalidOperationException("G4_JOURNAL_HEADER_OR_TORN_TAIL");
        string body = contents[Header.Length..];
        if (body.Length == 0) return [];
        string[] lines = body.Split('\n');
        if (lines[^1] != "") throw new InvalidOperationException("G4_JOURNAL_TORN_TAIL");
        var entries = new List<Entry>();
        var seenIds = new HashSet<string>(StringComparer.Ordinal);
        var seenNonces = new HashSet<string>(StringComparer.Ordinal);
        var seenRequests = new HashSet<string>(StringComparer.Ordinal);
        string previous = new string('0', 64);
        for (int i = 0; i < lines.Length - 1; i++)
        {
            if (lines[i].Length is < 150 or > MaxEntryBytes)
                throw new InvalidOperationException("G4_JOURNAL_LINE_SIZE_DENIED");
            using JsonDocument doc = JsonDocument.Parse(lines[i], new JsonDocumentOptions {
                AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 2
            });
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                throw new InvalidOperationException("G4_JOURNAL_OBJECT_REQUIRED");
            var members = new HashSet<string>(StringComparer.Ordinal);
            foreach (JsonProperty field in doc.RootElement.EnumerateObject())
            {
                if (Array.IndexOf(Fields, field.Name) < 0 || !members.Add(field.Name) ||
                    (field.Name == "Sequence" ?
                        field.Value.ValueKind != JsonValueKind.Number || !field.Value.TryGetInt64(out _) :
                        field.Value.ValueKind != JsonValueKind.String))
                    throw new InvalidOperationException("G4_JOURNAL_SCHEMA_DENIED");
            }
            if (members.Count != Fields.Length)
                throw new InvalidOperationException("G4_JOURNAL_MISSING_FIELDS");
            Entry? e = JsonSerializer.Deserialize<Entry>(lines[i]);
            if (e is null) throw new InvalidOperationException("G4_JOURNAL_PARSE_DENIED");
            G4Claim claim = new(e.TicketId, e.RequestId, e.Nonce, e.TicketSha256,
                e.VolumeId, e.FileId, e.PreimageSha256);
            if (!Valid(claim) || e.Sequence != i + 1L ||
                e.PreviousHash != previous || !Hex(e.EntryHash, 64) ||
                !string.Equals(e.EntryHash, Hash(e.Sequence, claim, e.PreviousHash), StringComparison.Ordinal) ||
                !seenIds.Add(e.TicketId) || !seenNonces.Add(e.Nonce) || !seenRequests.Add(e.RequestId))
                throw new InvalidOperationException("G4_JOURNAL_CHAIN_OR_REPLAY_DENIED");
            entries.Add(e);
            previous = e.EntryHash;
        }
        return entries;
    }

    public long Count => ReadAll().Count;

    // Reserve *before* returning even an advisory review success. Never refund on later failure.
    public G4ReservationVerdict Reserve(G4Claim claim)
    {
        lock (reservationLock)
        {
        if (unusable) return G4ReservationVerdict.Deny("G4_JOURNAL_POISONED");
        if (claim is null || !Valid(claim)) return G4ReservationVerdict.Deny("G4_CLAIM_INVALID");
        try
        {
            List<Entry> entries = ReadAll();
            if (entries.Any(e => e.TicketId == claim.TicketId ||
                                 e.Nonce == claim.Nonce || e.RequestId == claim.RequestId))
                return G4ReservationVerdict.Deny("G4_REPLAY_DENIED");
            string previous = entries.Count == 0 ? new string('0', 64) : entries[^1].EntryHash;
            Entry entry = Make(entries.Count + 1L, claim, previous);
            byte[] data = Encoding.ASCII.GetBytes(JsonSerializer.Serialize(entry) + "\n");
            if (stream.Length + data.Length > MaxFileBytes)
                return G4ReservationVerdict.Deny("G4_CAPACITY_DENIED");
            stream.Position = stream.Length;
            stream.Write(data);
            stream.Flush(flushToDisk: true);
            List<Entry> checkedEntries = ReadAll();
            if (checkedEntries.Count != entries.Count + 1 || checkedEntries[^1] != entry)
                throw new IOException("G4_POST_FLUSH_MISMATCH");
            return new G4ReservationVerdict("G4_DURABLY_RESERVED_LOCAL_ONLY", true, false);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or
            JsonException or InvalidOperationException or ArgumentException or DecoderFallbackException)
        {
            unusable = true;
            return G4ReservationVerdict.Deny("G4_IO_OR_INTEGRITY_UNCERTAIN");
        }
        }
    }

    public void Dispose() => stream.Dispose();
}
