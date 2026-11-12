using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace AgentHub.C9.G5;

public sealed record ApprovedFilePin(string VolumeId, string FileId, string PreimageSha256);
public sealed record FileProof(string VolumeId, string FileId, string PreimageSha256, long Size);
public readonly record struct G5Verdict(string Reason, bool IdentityAndPreimageMatched, bool CanExecuteCommit)
{
    public static G5Verdict Deny(string reason) => new(reason, false, false);
    public static G5Verdict Match() => new("PINNED_READ_ONLY_MATCH", true, false);
}

// A retained, read-only Windows file handle; no method exposes a path-based
// commit or a writable handle. The caller must dispose it after review.
public sealed class PinnedReadOnlyFile : IDisposable
{
    private readonly FileStream stream;
    private readonly List<SafeFileHandle> pinnedParents;
    private readonly ApprovedFilePin expected;
    private bool disposed;
    private readonly FileProof firstProof;

    internal PinnedReadOnlyFile(FileStream stream, List<SafeFileHandle> parents,
        ApprovedFilePin pin, FileProof proof)
    {
        this.stream = stream;
        pinnedParents = parents;
        expected = pin;
        firstProof = proof;
    }
    public FileProof OriginalProof => firstProof;
    public bool CanExecuteCommit => false;
    public G5Verdict RecheckPinned()
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        try
        {
            FileProof proof = HandleIdentity.ReadFileProof(stream);
            return HandleIdentity.Matches(proof, expected) && proof == firstProof
                ? G5Verdict.Match() : G5Verdict.Deny("RETAINED_HANDLE_CHANGED");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or
            Win32Exception or InvalidOperationException or ArgumentException)
        { return G5Verdict.Deny("RETAINED_HANDLE_UNAVAILABLE"); }
    }
    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        stream.Dispose();
        foreach (SafeFileHandle h in pinnedParents) h.Dispose();
    }
}

public sealed record G5OpenResult(G5Verdict Verdict, PinnedReadOnlyFile? File);

public static class HandleIdentity
{
    private const uint FileReadData = 0x0001;
    private const uint FileReadAttributes = 0x0080;
    private const uint FileShareRead = 0x0001;
    private const uint FileShareWrite = 0x0002;
    private const uint OpenExisting = 3;
    private const uint BackupSemantics = 0x02000000;
    private const uint OpenReparsePoint = 0x00200000;
    private const uint AttributeReparsePoint = 0x400;
    private const int FileStandardInfoClass = 1;
    private const int FileAttributeTagInfoClass = 9;
    private const int FileIdInfoClass = 18;
    private const long MaximumPreimageSize = 32 * 1024 * 1024;

    [StructLayout(LayoutKind.Sequential)]
    private struct AttributeTagInfo { public uint FileAttributes; public uint ReparseTag; }

    [StructLayout(LayoutKind.Sequential)]
    private struct StandardInfo
    {
        public long AllocationSize;
        public long EndOfFile;
        public uint NumberOfLinks;
        [MarshalAs(UnmanagedType.U1)] public bool DeletePending;
        [MarshalAs(UnmanagedType.U1)] public bool Directory;
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode,
        SetLastError = true, ExactSpelling = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share,
        IntPtr securityAttributes, uint disposition, uint flagsAndAttributes, IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle file,
        int fileInformationClass, out AttributeTagInfo information, uint bufferSize);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "GetFileInformationByHandleEx")]
    private static extern bool GetStandardInfo(SafeFileHandle file,
        int fileInformationClass, out StandardInfo information, uint bufferSize);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "GetFileInformationByHandleEx")]
    private static extern bool GetIdInfo(SafeFileHandle file,
        int fileInformationClass, IntPtr information, uint bufferSize);

    private static void CheckNative(bool success, string reason)
    {
        if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), reason);
    }
    private static bool Hex(string? s, int n)
    {
        if (s is null || s.Length != n) return false;
        return s.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    }

    private static bool SafeSegment(string segment) =>
        segment.Length is > 0 and <= 120 && segment is not ("." or "..") &&
        !segment.EndsWith('.') && !segment.EndsWith(' ') &&
        Regex.IsMatch(segment, "^[A-Za-z0-9_.-]+$", RegexOptions.CultureInvariant);

    private static bool SafeRoot(string path)
    {
        if (path.Length is < 5 or > 240 || path[1] != ':' || path[2] != '\\' ||
            !char.IsAsciiLetter(path[0]) || path.Contains('/') || path.EndsWith('\\') ||
            path.StartsWith("\\\\", StringComparison.Ordinal) ||
            !string.Equals(Path.GetFullPath(path), path, StringComparison.OrdinalIgnoreCase))
            return false;
        return path[3..].Split('\\').All(SafeSegment);
    }

    private static AttributeTagInfo ReadAttributes(SafeFileHandle handle)
    {
        CheckNative(GetFileInformationByHandleEx(handle, FileAttributeTagInfoClass,
            out AttributeTagInfo info, (uint)Marshal.SizeOf<AttributeTagInfo>()), "G5_ATTRIBUTE_QUERY_FAILED");
        return info;
    }

    private static StandardInfo ReadStandard(SafeFileHandle handle)
    {
        CheckNative(GetStandardInfo(handle, FileStandardInfoClass,
            out StandardInfo info, (uint)Marshal.SizeOf<StandardInfo>()), "G5_STANDARD_QUERY_FAILED");
        return info;
    }

    private static SafeFileHandle OpenDirectory(string path)
    {
        SafeFileHandle handle = CreateFile(path, FileReadAttributes,
            FileShareRead | FileShareWrite, IntPtr.Zero, OpenExisting,
            BackupSemantics | OpenReparsePoint, IntPtr.Zero);
        if (handle.IsInvalid) { handle.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error(), "G5_DIRECTORY_OPEN_DENIED"); }
        try
        {
            AttributeTagInfo attrs = ReadAttributes(handle);
            StandardInfo standard = ReadStandard(handle);
            if ((attrs.FileAttributes & AttributeReparsePoint) != 0 || !standard.Directory || standard.DeletePending)
                throw new InvalidOperationException("G5_DIRECTORY_REPARSE_OR_INVALID");
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }

    private static SafeFileHandle OpenLeaf(string path)
    {
        SafeFileHandle handle = CreateFile(path, FileReadData | FileReadAttributes,
            FileShareRead, IntPtr.Zero, OpenExisting, OpenReparsePoint, IntPtr.Zero);
        if (handle.IsInvalid) { handle.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error(), "G5_LEAF_OPEN_DENIED"); }
        try
        {
            AttributeTagInfo attrs = ReadAttributes(handle);
            StandardInfo standard = ReadStandard(handle);
            if ((attrs.FileAttributes & AttributeReparsePoint) != 0 || standard.Directory ||
                standard.DeletePending || standard.NumberOfLinks != 1 ||
                standard.EndOfFile is < 0 or > MaximumPreimageSize)
                throw new InvalidOperationException("G5_LEAF_REPARSE_HARDLINK_OR_SIZE_DENIED");
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }

    // FileIdInfo = 8-byte volume serial + 16 raw FileId bytes.
    // The entire observation, including SHA256, comes from this retained handle.
    internal static FileProof ReadFileProof(FileStream stream)
    {
        SafeFileHandle handle = stream.SafeFileHandle;
        AttributeTagInfo attrs = ReadAttributes(handle);
        StandardInfo standard = ReadStandard(handle);
        if ((attrs.FileAttributes & AttributeReparsePoint) != 0 || standard.Directory ||
            standard.DeletePending || standard.NumberOfLinks != 1 ||
            standard.EndOfFile is < 0 or > MaximumPreimageSize)
            throw new InvalidOperationException("G5_FILE_STATE_UNSAFE");
        IntPtr ptr = Marshal.AllocHGlobal(24);
        try
        {
            CheckNative(GetIdInfo(handle, FileIdInfoClass, ptr, 24), "G5_ID_QUERY_FAILED");
            ulong volume = unchecked((ulong)Marshal.ReadInt64(ptr));
            byte[] id = new byte[16];
            Marshal.Copy(IntPtr.Add(ptr, 8), id, 0, 16);
            if (volume == 0 || id.All(b => b == 0))
                throw new InvalidOperationException("G5_ID_UNSUPPORTED");
            stream.Position = 0;
            string hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
            if (stream.Length != standard.EndOfFile)
                throw new InvalidOperationException("G5_FILE_SIZE_CHANGED");
            return new FileProof(volume.ToString("x16", CultureInfo.InvariantCulture),
                Convert.ToHexString(id).ToLowerInvariant(), hash, standard.EndOfFile);
        }
        finally { Marshal.FreeHGlobal(ptr); }
    }

    internal static bool Matches(FileProof proof, ApprovedFilePin pin) =>
        proof.VolumeId == pin.VolumeId && proof.FileId == pin.FileId &&
        CryptographicOperations.FixedTimeEquals(Convert.FromHexString(proof.PreimageSha256),
            Convert.FromHexString(pin.PreimageSha256));

    // The 'pin' must come from an independently authenticated approval. No local
    // probe of the untrusted path is allowed to promote itself to authorization.
    public static G5OpenResult OpenApprovedReadOnly(string trustedRoot, string relativePath,
        ApprovedFilePin pin)
    {
        if (!OperatingSystem.IsWindows())
            return new(G5Verdict.Deny("WINDOWS_ONLY"), null);
        if (!SafeRoot(trustedRoot) || string.IsNullOrEmpty(relativePath) ||
            relativePath.Length > 512 || relativePath.Contains('/') ||
            !relativePath.Split('\\').All(SafeSegment) ||
            !Hex(pin.VolumeId, 16) || !Hex(pin.FileId, 32) ||
            !Hex(pin.PreimageSha256, 64))
            return new(G5Verdict.Deny("PATH_OR_PIN_INVALID"), null);
        var parents = new List<SafeFileHandle>();
        FileStream? opened = null;
        try
        {
            // Retain every component starting with the drive root. No directory
            // is reopened after being checked; deny-delete sharing resists renames.
            string path = trustedRoot[..3];
            parents.Add(OpenDirectory(path));
            foreach (string component in trustedRoot[3..].Split('\\'))
            {
                path = Path.Combine(path, component);
                parents.Add(OpenDirectory(path));
            }
            string[] relative = relativePath.Split('\\');
            for (int i = 0; i < relative.Length - 1; i++)
            {
                path = Path.Combine(path, relative[i]);
                parents.Add(OpenDirectory(path));
            }
            string leaf = Path.Combine(path, relative[^1]);
            SafeFileHandle file = OpenLeaf(leaf);
            try { opened = new FileStream(file, FileAccess.Read, 4096, false); }
            catch { file.Dispose(); throw; }
            FileProof proof = ReadFileProof(opened);
            if (!Matches(proof, pin))
                return new(G5Verdict.Deny("FILE_ID_OR_PREIMAGE_MISMATCH"), null);
            var lease = new PinnedReadOnlyFile(opened, parents, pin, proof);
            opened = null;
            parents = new List<SafeFileHandle>();
            return new(G5Verdict.Match(), lease);
        }
        catch (Exception e) when (e is Win32Exception or IOException or UnauthorizedAccessException or
            InvalidOperationException or ArgumentException or NotSupportedException)
        { return new(G5Verdict.Deny("UNSAFE_OR_INACCESSIBLE_TARGET"), null); }
        finally
        {
            opened?.Dispose();
            foreach (SafeFileHandle h in parents) h.Dispose();
        }
    }
}
