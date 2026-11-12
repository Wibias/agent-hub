using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using AgentHub.C9.G5;
using Microsoft.Win32.SafeHandles;

// Disposable Windows CI-only experiment. It is deliberately NOT a Broker service,
// library, authorization path, or a secure G5 commit implementation.
internal static class Program
{
    private static readonly byte[] OldBytes = [0x41, 0x48, 0x42, 0x2d, 0x4f, 0x4c, 0x44, 0x0a];
    private static readonly byte[] NewBytes = [0x41, 0x48, 0x42, 0x2d, 0x4e, 0x45, 0x57, 0x0a];
    private const string Target = "target.bin";
    private const string Stage = "stage.bin";
    private const string Backup = "backup.bin";
    private const string Marker = "barrier.signal";
    private static int passed;

    [DllImport("kernel32.dll", EntryPoint = "GetFileInformationByHandleEx", SetLastError = true, ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileId(SafeFileHandle handle, int infoClass, IntPtr buffer, uint size);

    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static string HashFile(string file) => Hash(File.ReadAllBytes(file));
    private static string PathOf(string dir, string name) => Path.Combine(dir, name);

    private static void Check(string name, bool good)
    {
        if (!good) throw new InvalidOperationException("G5_ATOMIC_LAB_FAIL " + name);
        passed++;
        Console.WriteLine("PASS " + name);
    }

    private static bool GuardedRunner()
    {
        if (!OperatingSystem.IsWindows() ||
            Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
            Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows" ||
            Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
            Environment.GetEnvironmentVariable("AGENTHUB_G5_ATOMIC_LAB") != "DISPOSABLE_GITHUB_RUNNER")
            return false;
        string? temp = Environment.GetEnvironmentVariable("RUNNER_TEMP");
        return !string.IsNullOrWhiteSpace(temp) && Path.IsPathFullyQualified(temp) &&
               Directory.Exists(temp);
    }

    private static string RootFor(string mode, string path)
    {
        string parent = Path.GetFullPath(Environment.GetEnvironmentVariable("RUNNER_TEMP")!);
        string full = Path.GetFullPath(path);
        string? runRoot = Path.GetDirectoryName(full);
        if (mode is not ("worker-before" or "worker-after") ||
            runRoot is null ||
            !string.Equals(Path.GetDirectoryName(runRoot), parent, StringComparison.OrdinalIgnoreCase) ||
            !System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(runRoot),
                "^agenthub-g5-atomic-[0-9a-f]{32}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant) ||
            Path.GetFileName(full) != (mode == "worker-before" ? "before" : "after") ||
            !Directory.Exists(full))
            throw new InvalidOperationException("G5_WORKER_PATH_DENIED");
        return full;
    }

    private static ApprovedFilePin IndependentPin(string path)
    {
        using SafeFileHandle handle = File.OpenHandle(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        IntPtr buffer = Marshal.AllocHGlobal(24);
        try
        {
            if (!GetFileId(handle, 18, buffer, 24))
                throw new InvalidOperationException("FILE_ID_INFO_UNAVAILABLE");
            ulong volume = unchecked((ulong)Marshal.ReadInt64(buffer));
            byte[] id = new byte[16];
            Marshal.Copy(IntPtr.Add(buffer, 8), id, 0, id.Length);
            if (volume == 0 || id.All(x => x == 0))
                throw new InvalidOperationException("INVALID_FILE_ID");
            return new ApprovedFilePin(volume.ToString("x16", CultureInfo.InvariantCulture),
                Convert.ToHexString(id).ToLowerInvariant(), HashFile(path));
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    // A bounded validation-only probe. The returned lease is NEVER converted
    // into a write handle, and closing it creates a TOCTOU gap before Replace.
    private static bool PinnedMatches(string dir, ApprovedFilePin pin)
    {
        G5OpenResult result = HandleIdentity.OpenApprovedReadOnly(dir, Target, pin);
        using PinnedReadOnlyFile? retained = result.File;
        return result.Verdict is {IdentityAndPreimageMatched:true, CanExecuteCommit:false} &&
            retained is not null &&
            retained.RecheckPinned() is {IdentityAndPreimageMatched:true, CanExecuteCommit:false};
    }

    private static void FlushStage(string dir)
    {
        using var stream = new FileStream(PathOf(dir, Stage), FileMode.CreateNew,
            FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough);
        stream.Write(NewBytes);
        stream.Flush(flushToDisk:true);
    }

    private static void CreateScenario(string dir)
    {
        Directory.CreateDirectory(dir);
        File.WriteAllBytes(PathOf(dir, Target), OldBytes);
    }

    // This is a PATH-BASED laboratory replacement. It cannot be used to
    // authorize a G5 commit because the retained G5 lease is already closed.
    private static bool TryReplaceForLab(string dir, ApprovedFilePin oldPin)
    {
        // Demonstrates a deliberate, still UNRESOLVED TOCTOU window between
        // disposing the G5 read-only lease and the path-based namespace switch.
        if (File.Exists(PathOf(dir, Backup)) || !File.Exists(PathOf(dir, Stage)) ||
            HashFile(PathOf(dir, Stage)) != Hash(NewBytes) ||
            !PinnedMatches(dir, oldPin)) return false;
        File.Replace(PathOf(dir, Stage), PathOf(dir, Target),
            PathOf(dir, Backup), ignoreMetadataErrors:false);
        return true;
    }

    private static void Worker(string mode, string dir)
    {
        dir = RootFor(mode, dir);
        if (!File.Exists(PathOf(dir, Target)) ||
            HashFile(PathOf(dir, Target)) != Hash(OldBytes) ||
            File.Exists(PathOf(dir, Stage)) || File.Exists(PathOf(dir, Backup)))
            throw new InvalidOperationException("WORKER_PREREQUISITES_DENIED");
        ApprovedFilePin pin = IndependentPin(PathOf(dir, Target));
        FlushStage(dir);
        if (mode == "worker-after" && !TryReplaceForLab(dir, pin))
            throw new InvalidOperationException("WORKER_LAB_REPLACE_DENIED");
        using (var f = new FileStream(PathOf(dir, Marker), FileMode.CreateNew,
            FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
        {
            f.WriteByte(0x47);
            f.Flush(flushToDisk:true);
        }
        Thread.Sleep(Timeout.Infinite);
    }

    private static void KillWorkerAtBarrier(string mode, string dir)
    {
        using Process process = Process.Start(new ProcessStartInfo(Environment.ProcessPath!)
        {
            ArgumentList = {mode, dir},
            UseShellExecute = false,
            CreateNoWindow = true
        }) ?? throw new InvalidOperationException("WORKER_DID_NOT_START");
        try
        {
            var watch = Stopwatch.StartNew();
            while (!File.Exists(PathOf(dir, Marker)) && watch.Elapsed < TimeSpan.FromSeconds(20))
            {
                if (process.HasExited)
                    throw new InvalidOperationException($"WORKER_EARLY_EXIT {process.ExitCode}");
                Thread.Sleep(40);
            }
            if (!File.Exists(PathOf(dir, Marker))) throw new TimeoutException("WORKER_BARRIER_TIMEOUT");
            process.Kill(entireProcessTree:true);
            if (!process.WaitForExit(10000) || !process.HasExited)
                throw new InvalidOperationException("WORKER_KILL_NOT_CONFIRMED");
            Check(mode + " process terminated at durable checkpoint", true);
        }
        finally
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree:true);
                process.WaitForExit(10000);
            }
        }
    }

    // Review-only offline decision: never auto-commit a staged payload after a crash.
    // No repair or destructive action on mismatch. Only known-good test bytes.
    private static string InspectInterrupted(string dir)
    {
        string target = PathOf(dir, Target), stage = PathOf(dir, Stage), backup = PathOf(dir, Backup);
        if (!File.Exists(target)) return "DENY_TARGET_MISSING";
        string current = HashFile(target);
        bool stageExists = File.Exists(stage), backupExists = File.Exists(backup);
        if (current == Hash(OldBytes) && stageExists && !backupExists &&
            HashFile(stage) == Hash(NewBytes))
            return "ABORT_PRECOMMIT_NO_AUTORETRY";
        if (current == Hash(NewBytes) && !stageExists && backupExists &&
            HashFile(backup) == Hash(OldBytes))
            return "POSTCOMMIT_REQUIRES_RECONCILIATION";
        return "DENY_INCONSISTENT_STORAGE";
    }

    private static string NewDir(string root, string label)
    {
        string path = Path.Combine(root, label);
        CreateScenario(path);
        return path;
    }

    private static void Run()
    {
        string root = Path.Combine(Environment.GetEnvironmentVariable("RUNNER_TEMP")!,
            "agenthub-g5-atomic-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            string normal = NewDir(root, "normal");
            ApprovedFilePin original = IndependentPin(PathOf(normal, Target));
            Check("G5 original handle ID plus preimage confirmed", PinnedMatches(normal, original));
            FlushStage(normal);
            Check("stage flushed before namespace operation", HashFile(PathOf(normal, Stage)) == Hash(NewBytes));
            Check("old target still readable before replace", HashFile(PathOf(normal, Target)) == Hash(OldBytes));
            using (PinnedReadOnlyFile? proof = HandleIdentity.OpenApprovedReadOnly(normal, Target, original).File)
                Check("G5 cannot be silently upgraded into commit capability", proof is not null && !proof.CanExecuteCommit);
            // The previous read lease is closed at this point; not safe for production.
            Check("staged lab replacement succeeds on isolated target", TryReplaceForLab(normal, original));
            Check("lab replace exposes complete new payload", HashFile(PathOf(normal, Target)) == Hash(NewBytes));
            Check("lab replacement retains complete old backup", HashFile(PathOf(normal, Backup)) == Hash(OldBytes));
            Check("replacement has different FileId", IndependentPin(PathOf(normal, Target)).FileId != original.FileId);
            Check("old G5 pin rejected after replacement", !PinnedMatches(normal, original));

            string race = NewDir(root, "swap");
            ApprovedFilePin racePin = IndependentPin(PathOf(race, Target));
            Check("pre-swap G5 pin matches", PinnedMatches(race, racePin));
            FlushStage(race);
            File.Move(PathOf(race, Target), PathOf(race, "old-identity.bin"));
            File.WriteAllBytes(PathOf(race, Target), OldBytes);
            Check("same-content file swap rejected by FileId", !PinnedMatches(race, racePin));
            Check("file-swap attack denied by lab replacement", !TryReplaceForLab(race, racePin));
            Check("race denial did not commit stage", File.Exists(PathOf(race, Stage)) &&
                HashFile(PathOf(race, Target)) == Hash(OldBytes));

            // Adversarial schedule AFTER the G5 lease is released: this shows
            // why a path-based swap is NOT a G5-authorized commit even if the
            // previous identity check passed. No production code uses it.
            string gap = NewDir(root, "postcheck-gap");
            ApprovedFilePin gapPin = IndependentPin(PathOf(gap, Target));
            FlushStage(gap);
            Check("pre-race retained G5 proof passes", PinnedMatches(gap, gapPin));
            File.Move(PathOf(gap, Target), PathOf(gap, "approved-but-moved.bin"));
            File.WriteAllBytes(PathOf(gap, Target), OldBytes);
            ApprovedFilePin substituted = IndependentPin(PathOf(gap, Target));
            Check("identical-content attacker substitute has a different FileId",
                substituted.FileId != gapPin.FileId);
            // Demonstration of an UNSAFE path-based operation, not an approved
            // lab TryReplaceForLab call; all files are disposable CI fixtures.
            File.Replace(PathOf(gap, Stage), PathOf(gap, Target),
                PathOf(gap, Backup), ignoreMetadataErrors:false);
            Check("path-only commit gap demonstrated and classified unsafe",
                HashFile(PathOf(gap, Target)) == Hash(NewBytes) &&
                IndependentPin(PathOf(gap, "approved-but-moved.bin")).FileId == gapPin.FileId &&
                IndependentPin(PathOf(gap, Backup)).FileId == substituted.FileId);
            Console.WriteLine("G5_TOCTOU_UNRESOLVED_PROOF old_file_id_not_bound_to_replace=true");

            string corrupt = NewDir(root, "corrupt-stage");
            ApprovedFilePin corruptPin = IndependentPin(PathOf(corrupt, Target));
            File.WriteAllBytes(PathOf(corrupt, Stage), [0xee, 0x01, 0xff]);
            Check("corrupt stage cannot be committed", !TryReplaceForLab(corrupt, corruptPin) &&
                HashFile(PathOf(corrupt, Target)) == Hash(OldBytes));

            string competing = NewDir(root, "competing");
            ApprovedFilePin competePin = IndependentPin(PathOf(competing, Target));
            FlushStage(competing);
            using (var writer = new FileStream(PathOf(competing, Target), FileMode.Open,
                FileAccess.Write, FileShare.ReadWrite | FileShare.Delete))
            {
                Check("pre-existing write handle blocks G5 lease", !PinnedMatches(competing, competePin));
                Check("pre-existing writer prevents lab replacement", !TryReplaceForLab(competing, competePin));
            }
            Check("G5 lease recovers after writer closes", PinnedMatches(competing, competePin));

            // Advisory cooperative gate is intentionally not attacker protection.
            string lockPath = PathOf(competing, "cooperative.lock");
            using (var lockOwner = new FileStream(lockPath, FileMode.CreateNew,
                FileAccess.ReadWrite, FileShare.None))
            {
                bool denied = false;
                try { using var second = new FileStream(lockPath, FileMode.Open,
                    FileAccess.ReadWrite, FileShare.None); }
                catch (IOException) { denied = true; }
                Check("second cooperative committer blocked", denied);
            }

            // Worker paths are direct children of the unique runner root, each
            // with a distinct scenario directory; tests are independently cleaned.
            string before = NewDir(root, "before");
            KillWorkerAtBarrier("worker-before", before);
            Check("pre-replace interruption preserves old target",
                HashFile(PathOf(before, Target)) == Hash(OldBytes));
            Check("pre-replace restart never auto-commits stage",
                InspectInterrupted(before) == "ABORT_PRECOMMIT_NO_AUTORETRY");
            File.Delete(PathOf(before, Stage));
            Check("pre-replace cleanup leaves original target", HashFile(PathOf(before, Target)) == Hash(OldBytes));

            string after = NewDir(root, "after");
            KillWorkerAtBarrier("worker-after", after);
            Check("post-replace interruption preserves whole new target",
                HashFile(PathOf(after, Target)) == Hash(NewBytes));
            Check("post-replace restart demands explicit reconciliation",
                InspectInterrupted(after) == "POSTCOMMIT_REQUIRES_RECONCILIATION");
            File.WriteAllBytes(PathOf(after, Backup), [0xde,0xad,0xbe,0xef]);
            Check("tampered backup denies recovery without touching target",
                InspectInterrupted(after) == "DENY_INCONSISTENT_STORAGE" &&
                HashFile(PathOf(after, Target)) == Hash(NewBytes));

            Console.WriteLine($"C9_G5_ATOMIC_DISPOSABLE_LAB_PASS count={passed} " +
                "READ_ONLY_PROOF_RETAINED=true LAB_PATH_REPLACE_ONLY=true G5_WRITE_HOLD=true PRODUCTION_NO_GO");
        }
        finally
        {
            Directory.Delete(root, recursive:true);
            if (Directory.Exists(root)) throw new InvalidOperationException("G5_TEST_ROOT_CLEANUP_FAILED");
            Console.WriteLine("C9_G5_ATOMIC_DISPOSABLE_CLEANUP_PASS");
        }
    }

    private static int Main(string[] args)
    {
        if (!GuardedRunner()) {Console.Error.WriteLine("G5_ATOMIC_LAB_SCOPE_DENIED"); return 64;}
        try
        {
            if (args.Length == 1 && args[0] == "--run") Run();
            else if (args.Length == 2 && args[0] is "worker-before" or "worker-after")
                Worker(args[0], args[1]);
            else return 65;
            return 0;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("G5_ATOMIC_LAB_DENIED " + e);
            return 1;
        }
    }
}
