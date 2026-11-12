using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using AgentHub.C9.G5;
using Microsoft.Win32.SafeHandles;

// Deliberately stand-alone: only GUID-scoped ProgramData fixtures, never Broker RC2.
internal static class Program
{
    const uint ReadAttributes = 0x80, Delete = 0x10000, Traverse = 0x20;
    const uint GenericRead = 0x80000000, GenericWrite = 0x40000000;
    const uint ShareRead = 1, ShareWrite = 2, ShareDelete = 4;
    const uint CreateNew = 1, OpenExisting = 3;
    const uint BackupSemantics = 0x02000000, OpenReparsePoint = 0x00200000;
    const uint WriteThrough = 0x80000000;
    const int RenameInfo = 3, FileIdInfo = 18;
    static readonly byte[] Old = Encoding.UTF8.GetBytes("approved-old-content\n");
    static readonly byte[] New = Encoding.UTF8.GetBytes("approved-new-content\n");

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    static extern SafeFileHandle CreateFile(string path, uint access, uint share, nint attributes,
        uint disposition, uint flags, nint templateFile);

    [DllImport("kernel32.dll", EntryPoint = "SetFileInformationByHandle", SetLastError = true, ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool SetInfo(SafeFileHandle handle, int kind, nint info, uint length);

    [DllImport("kernel32.dll", EntryPoint = "GetFileInformationByHandleEx", SetLastError = true, ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetInfo(SafeFileHandle handle, int kind, nint info, uint length);

    static int Main(string[] args)
    {
        try
        {
            if (!OperatingSystem.IsWindows() || args.Length < 1) return 2;
            if (args[0] == "--attack" && args.Length == 3)
                return Attack(args[1], args[2]);
            if (Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
                Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows" ||
                Environment.GetEnvironmentVariable("AGENTHUB_G5_MINIMAL_LAB") != "DISPOSABLE_CI")
                throw new InvalidOperationException("NOT_DISPOSABLE_WINDOWS_CI");
            if (args[0] == "--crash" && args.Length == 3)
            {
                Work(args[1], null, args[2]);
                throw new InvalidOperationException("CRASH_BARRIER_NOT_REACHED");
            }
            if (args[0] != "--run" || args.Length != 3) return 2;
            Run(args[1], args[2]);
            Console.WriteLine("G5_MINIMAL_LAB_PASS tests=3 G5_WRITE_HOLD PRODUCTION_NO_GO");
            return 0;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("G5_MINIMAL_LAB_FAILED " + e);
            return 1;
        }
    }

    static void Require(bool condition, string marker)
    {
        if (!condition) throw new InvalidOperationException(marker);
        Console.WriteLine(marker + " PASS");
    }

    static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    static void Fixture(string folder)
    {
        Directory.CreateDirectory(folder);
        File.WriteAllBytes(Path.Combine(folder, "target.bin"), Old);
    }

    static void Run(string root, string taskName)
    {
        ValidateLabRoot(root);
        Require(new DriveInfo(Path.GetPathRoot(root)!).DriveFormat == "NTFS", "NTFS_REQUIRED");
        string positive = Path.Combine(root, "work", "positive");
        string before = Path.Combine(root, "work", "before");
        string after = Path.Combine(root, "work", "after");
        Fixture(positive);
        Fixture(before);
        Fixture(after);

        Work(positive, taskName, "positive");
        Require(Hash(File.ReadAllBytes(Path.Combine(positive, "target.bin"))) == Hash(New) &&
            !File.Exists(Path.Combine(positive, "pending.stage")), "POSITIVE_HANDLE_RENAME");

        Crash(root, before, "before");
        Require(Inspect(before) == "OLD_WITH_STAGE", "CRASH_BEFORE_INSPECT_ONLY");
        Crash(root, after, "after");
        Require(Inspect(after) == "NEW_NO_STAGE", "CRASH_AFTER_INSPECT_ONLY");
        Console.WriteLine("G5_RECOVERY_NO_AUTO_RETRY PASS");
    }

    static void ValidateLabRoot(string root)
    {
        string parent = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "");
        string absolute = Path.GetFullPath(root);
        if (!absolute.StartsWith(parent, StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(absolute).StartsWith("AgentHubC9G5Lab-", StringComparison.Ordinal) ||
            absolute.Contains("..", StringComparison.Ordinal))
            throw new InvalidOperationException("LAB_ROOT_REJECTED");
    }

    static ApprovedFilePin PinFromIndependentFixture(string target)
    {
        using SafeFileHandle handle = File.OpenHandle(target, FileMode.Open, FileAccess.Read, FileShare.Read);
        (string volume, string fileId) = Identity(handle);
        return new ApprovedFilePin(volume, fileId, Hash(File.ReadAllBytes(target)));
    }

    static (string Volume, string FileId) Identity(SafeFileHandle handle)
    {
        nint buffer = Marshal.AllocHGlobal(24);
        try
        {
            if (!GetInfo(handle, FileIdInfo, buffer, 24)) throw new Win32Exception(Marshal.GetLastWin32Error());
            ulong volume = unchecked((ulong)Marshal.ReadInt64(buffer));
            byte[] id = new byte[16];
            Marshal.Copy(buffer + 8, id, 0, 16);
            return (volume.ToString("x16", CultureInfo.InvariantCulture),
                Convert.ToHexString(id).ToLowerInvariant());
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    static SafeFileHandle OpenDirectory(string directory)
    {
        if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("REPARSE_DIRECTORY_DENIED");
        SafeFileHandle h = CreateFile(directory, ReadAttributes | Traverse,
            ShareRead | ShareWrite, 0, OpenExisting, BackupSemantics | OpenReparsePoint, 0);
        if (h.IsInvalid) { h.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error()); }
        return h;
    }

    static FileStream Stage(string path)
    {
        SafeFileHandle h = CreateFile(path, GenericRead | GenericWrite | Delete,
            ShareRead, 0, CreateNew, WriteThrough | OpenReparsePoint, 0);
        if (h.IsInvalid) { h.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error()); }
        return new FileStream(h, FileAccess.ReadWrite, 4096, false);
    }

    static void Rename(SafeFileHandle stage, SafeFileHandle directory, string name)
    {
        // x64 FILE_RENAME_INFO: BOOLEAN at 0, HANDLE at 8, byte count at 16, UTF-16 at 20.
        if (IntPtr.Size != 8 || name != "target.bin") throw new InvalidOperationException("RENAME_LAYOUT_DENIED");
        byte[] wide = Encoding.Unicode.GetBytes(name);
        nint blob = Marshal.AllocHGlobal(20 + wide.Length);
        try
        {
            for (int i = 0; i < 20; i++) Marshal.WriteByte(blob, i, 0);
            Marshal.WriteByte(blob, 0, 1); // ReplaceIfExists = true; no POSIX semantics
            Marshal.WriteIntPtr(blob, 8, directory.DangerousGetHandle());
            Marshal.WriteInt32(blob, 16, wide.Length);
            Marshal.Copy(wide, 0, blob + 20, wide.Length);
            if (!SetInfo(stage, RenameInfo, blob, checked((uint)(20 + wide.Length))))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "STAGE_HANDLE_RENAME_FAILED");
        }
        finally { Marshal.FreeHGlobal(blob); }
    }

    static void Work(string directory, string? taskName, string mode)
    {
        string target = Path.Combine(directory, "target.bin");
        string stage = Path.Combine(directory, "pending.stage");
        using SafeFileHandle parent = OpenDirectory(directory);
        ApprovedFilePin pin = PinFromIndependentFixture(target);
        using FileStream staged = Stage(stage);
        staged.Write(New);
        staged.Flush(flushToDisk: true);
        staged.Position = 0;
        Require(Convert.ToHexString(SHA256.HashData(staged)).ToLowerInvariant() == Hash(New), "STAGE_HASH_AND_FLUSH");
        (string _, string stageId) = Identity(staged.SafeFileHandle);

        G5OpenResult opened = HandleIdentity.OpenApprovedReadOnly(directory, "target.bin", pin);
        if (!opened.Verdict.IdentityAndPreimageMatched || opened.File is null || opened.Verdict.CanExecuteCommit)
            throw new InvalidOperationException("G5_PIN_NOT_MATCHED");
        using (PinnedReadOnlyFile held = opened.File)
            Require(held.RecheckPinned() is { IdentityAndPreimageMatched: true, CanExecuteCommit: false }, "G5_RECHECK");
        // The G5 leaf handle is now closed. This is only safe under the independently
        // provisioned test DACL, not as a FileId compare-and-swap operation.
        if (mode == "before") Process.GetCurrentProcess().Kill();
        if (taskName is not null) ProveNoUnprivilegedRename(taskName, directory);
        Rename(staged.SafeFileHandle, parent, "target.bin");
        if (mode == "after") Process.GetCurrentProcess().Kill();
        using SafeFileHandle newHandle = File.OpenHandle(target, FileMode.Open, FileAccess.Read, FileShare.Read);
        Require(Identity(newHandle).FileId == stageId &&
            Hash(File.ReadAllBytes(target)) == Hash(New), "STAGE_HANDLE_TARGET_IDENTITY");
    }

    static void ProveNoUnprivilegedRename(string taskName, string directory)
    {
        string signal = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(directory)!)!, "signals", "attack.txt");
        if (File.Exists(signal)) File.Delete(signal);
        using Process scheduler = Process.Start(new ProcessStartInfo("schtasks.exe")
        {
            ArgumentList = { "/run", "/tn", taskName },
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        }) ?? throw new InvalidOperationException("TASK_START_FAILED");
        if (!scheduler.WaitForExit(15000) || scheduler.ExitCode != 0)
            throw new InvalidOperationException("TASK_DISPATCH_FAILED " + scheduler.StandardError.ReadToEnd());
        var watch = Stopwatch.StartNew();
        while (!File.Exists(signal) && watch.Elapsed < TimeSpan.FromSeconds(30)) Thread.Sleep(100);
        if (!File.Exists(signal)) throw new InvalidOperationException("UNPRIVILEGED_WORKER_TIMEOUT");
        Require(File.ReadAllText(signal).Trim() == "S-1-5-19|5|DENIED" &&
            !File.Exists(Path.Combine(directory, "attacker-renamed.bin")), "ACL_UNPRIVILEGED_RENAME_DENIED");
    }

    static int Attack(string target, string result)
    {
        // Never run an attack helper on arbitrary paths or under an elevated token.
        string norm = Path.GetFullPath(target);
        string baseRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AgentHubC9G5Lab-");
        if (!norm.StartsWith(baseRoot, StringComparison.OrdinalIgnoreCase) ||
            WindowsIdentity.GetCurrent().User?.Value != "S-1-5-19") return 3;
        using SafeFileHandle h = CreateFile(norm, Delete,
            ShareRead | ShareWrite | ShareDelete, 0, OpenExisting, OpenReparsePoint, 0);
        int error = h.IsInvalid ? Marshal.GetLastWin32Error() : 0;
        bool blocked = false;
        try { File.Move(norm, Path.Combine(Path.GetDirectoryName(norm)!, "attacker-renamed.bin")); }
        catch (UnauthorizedAccessException) { blocked = true; }
        catch (IOException) { blocked = true; }
        File.WriteAllText(result, $"{WindowsIdentity.GetCurrent().User!.Value}|{error}|{(blocked ? "DENIED" : "UNSAFE")}");
        return error == 5 && blocked ? 0 : 4;
    }

    static void Crash(string root, string directory, string checkpoint)
    {
        using Process worker = Process.Start(new ProcessStartInfo(Environment.ProcessPath!)
        {
            ArgumentList = { "--crash", directory, checkpoint },
            UseShellExecute = false
        }) ?? throw new InvalidOperationException("WORKER_START_FAILED");
        if (!worker.WaitForExit(20000))
        {
            worker.Kill();
            throw new InvalidOperationException("CRASH_WORKER_TIMEOUT");
        }
        Require(worker.ExitCode != 0, "CHILD_PROCESS_TERMINATED_" + checkpoint.ToUpperInvariant());
    }

    static string Inspect(string directory)
    {
        string target = Path.Combine(directory, "target.bin");
        string stage = Path.Combine(directory, "pending.stage");
        string targetHash = File.Exists(target) ? Hash(File.ReadAllBytes(target)) : "missing";
        string stageHash = File.Exists(stage) ? Hash(File.ReadAllBytes(stage)) : "missing";
        if (targetHash == Hash(Old) && stageHash == Hash(New)) return "OLD_WITH_STAGE";
        if (targetHash == Hash(New) && stageHash == "missing") return "NEW_NO_STAGE";
        return "AMBIGUOUS_DENY";
    }
}
