using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

internal static class Program
{
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint Delete = 0x00010000;
    private const uint ReadAttributesAndTraverse = 0x000000A0;
    private const uint ShareAll = 0x00000007;
    private const uint CreateNew = 1;
    private const uint OpenExisting = 3;
    private const uint FileAttributeNormal = 0x00000080;
    private const uint FileFlagBackupSemantics = 0x02000000;
    private const int FileRenameInfo = 3;

    private static int Main(string[] args)
    {
        try
        {
            if (!OperatingSystem.IsWindows() || IntPtr.Size != 8)
                throw new PlatformNotSupportedException("Windows x64 only.");

            if (args.Length == 5 && args[0] == "commit")
            {
                Commit(args[1], args[2], args[3], args[4]);
                Console.WriteLine("G5_COMMIT_OK");
                return 0;
            }

            if (args.Length == 3 && args[0] == "prepare")
            {
                using var stage = CreateStage(args[1]);
                WriteAndFlush(stage, args[2]);
                Console.WriteLine("G5_STAGE_FLUSHED_NO_RENAME");
                return 0;
            }

            if (args.Length == 2 && args[0] == "recover")
            {
                File.Delete(args[1]);
                Console.WriteLine("G5_STALE_STAGE_REMOVED");
                return 0;
            }

            if (args.Length == 4 && args[0] == "attack")
                return AttemptUnauthorizedReplacement(args[1], args[2], args[3]);

            Console.Error.WriteLine("Usage: commit <stage-path> <target-dir> <target-name> <text> | prepare <stage-path> <text> | recover <stage-path> | attack <probe-dir> <target-path> <receipt-path>");
            return 2;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"{e.GetType().Name}: {e.Message}");
            return 1;
        }
    }

    private static void Commit(string stagePath, string targetDir, string targetName, string value)
    {
        if (string.IsNullOrWhiteSpace(targetName) ||
            targetName is "." or ".." ||
            Path.GetFileName(targetName) != targetName ||
            targetName.Contains(':'))
            throw new ArgumentException("A single target filename is required.");

        using var stage = CreateStage(stagePath);
        WriteAndFlush(stage, value);
        using var directory = OpenDirectory(targetDir);
        RenameUsingHandles(stage, directory, targetName);
    }

    private static SafeFileHandle CreateStage(string path)
    {
        var handle = CreateFileW(path, GenericRead | GenericWrite | Delete, ShareAll,
            IntPtr.Zero, CreateNew, FileAttributeNormal, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            int error = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new Win32Exception(error, "Opening staging file failed.");
        }
        return handle;
    }

    private static SafeFileHandle OpenDirectory(string path)
    {
        var handle = CreateFileW(path, ReadAttributesAndTraverse, ShareAll,
            IntPtr.Zero, OpenExisting, FileFlagBackupSemantics, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            int error = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new Win32Exception(error, "Opening target directory failed.");
        }
        return handle;
    }

    private static void WriteAndFlush(SafeFileHandle handle, string value)
    {
        // Leave the original DELETE-capable staging handle alive for the rename.
        using var stream = new FileStream(handle, FileAccess.Write, 4096, isAsync: false);
        stream.Write(Encoding.UTF8.GetBytes(value));
        stream.Flush(flushToDisk: true);
        // FileStream.Dispose closes the handle, so the caller must rename first.
    }

    private static void RenameUsingHandles(SafeFileHandle stage, SafeFileHandle directory, string name)
    {
        // Windows x64 FILE_RENAME_INFO: Flags [0..3], padding [4..7],
        // RootDirectory [8..15], FileNameLength [16..19], UTF-16 filename [20..].
        byte[] fileName = Encoding.Unicode.GetBytes(name);
        int length = checked(20 + fileName.Length + 2);
        IntPtr buffer = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.WriteInt32(buffer, 0, 1); // ReplaceIfExists = TRUE, FileRenameInfo
            Marshal.WriteInt32(buffer, 4, 0);
            Marshal.WriteIntPtr(buffer, 8, directory.DangerousGetHandle());
            Marshal.WriteInt32(buffer, 16, fileName.Length);
            Marshal.Copy(fileName, 0, IntPtr.Add(buffer, 20), fileName.Length);
            Marshal.WriteInt16(buffer, 20 + fileName.Length, 0);
            if (!SetFileInformationByHandle(stage, FileRenameInfo, buffer, (uint)length))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Handle rename failed.");
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static int AttemptUnauthorizedReplacement(string probeDir, string targetPath, string receiptPath)
    {
        if (WindowsIdentity.GetCurrent().User?.Value != "S-1-5-19")
            throw new InvalidOperationException("The adversary must actually run as LocalService.");

        string attackerStage = Path.Combine(probeDir, "attacker-" + Guid.NewGuid().ToString("N") + ".tmp");
        File.WriteAllText(attackerStage, "UNAUTHORIZED");
        try
        {
            File.Move(attackerStage, targetPath, overwrite: true);
            File.WriteAllText(receiptPath, "ATTACK_SUCCEEDED");
            return 1;
        }
        catch (Exception e) when (e.HResult == unchecked((int)0x80070005))
        {
            File.WriteAllText(receiptPath, "ATTACK_DENIED_ACCESS_5");
            return 0;
        }
        catch (Exception e)
        {
            File.WriteAllText(receiptPath, $"ATTACK_FAILED_UNEXPECTED_{e.HResult:X8}");
            return 1;
        }
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(
        string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);

    [DllImport("kernel32.dll", EntryPoint = "SetFileInformationByHandle", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetFileInformationByHandle(
        SafeFileHandle file, int infoClass, IntPtr info, uint length);
}
