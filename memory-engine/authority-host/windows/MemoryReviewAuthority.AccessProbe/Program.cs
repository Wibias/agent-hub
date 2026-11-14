using System.ComponentModel;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

// Ephemeral Windows GitHub runner ONLY. Attempts real filesystem operations
// under a restricted token of the SAME account as the elevated CI runner.
// This is not a second local user, VM, production service or approval endpoint.
internal static class Program
{
    private const uint TokenQuery = 0x0008;
    private const uint TokenDuplicate = 0x0002;
    private const uint TokenImpersonate = 0x0004;
    private const uint DisableMaxPrivilege = 0x00000001;

    private static int Main(string[] args)
    {
        try
        {
            Require(OperatingSystem.IsWindows()
                && Environment.GetEnvironmentVariable("GITHUB_ACTIONS") == "true"
                && Environment.GetEnvironmentVariable("RUNNER_OS") == "Windows",
                "ephemeral_windows_runner_required");
            var state = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "AgentHubMemoryReviewLab-State");
            Require(args.Length == 1
                && string.Equals(Path.GetFullPath(args[0]), Path.GetFullPath(state),
                    StringComparison.OrdinalIgnoreCase)
                && Directory.Exists(state), "unexpected_lab_state_path");

            var sqlite = Path.Combine(state, "review-authority.sqlite3");
            Require(File.Exists(sqlite), "synthetic_sqlite_ledger_missing");

            using var originalIdentity = WindowsIdentity.GetCurrent();
            var originalUserSid = originalIdentity.User?.Value;
            Require(!string.IsNullOrEmpty(originalUserSid), "caller_sid_missing");
            var admin = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
            var adminBytes = new byte[admin.BinaryLength];
            admin.GetBinaryForm(adminBytes, 0);
            var adminPointer = Marshal.AllocHGlobal(adminBytes.Length);
            try
            {
                Marshal.Copy(adminBytes, 0, adminPointer, adminBytes.Length);
                Require(Native.CheckTokenMembership(IntPtr.Zero, adminPointer, out var initialAdmin)
                    && initialAdmin, "github_runner_not_elevated");

                Require(Native.OpenProcessToken(Native.GetCurrentProcess(),
                    TokenQuery | TokenDuplicate | TokenImpersonate, out var processToken),
                    "open_runner_token_failed");
                using (processToken)
                {
                    var disabled = new[] { new Native.SidAndAttributes(adminPointer, 0) };
                    Require(Native.CreateRestrictedToken(processToken, DisableMaxPrivilege,
                        1, disabled, 0, IntPtr.Zero, 0, IntPtr.Zero, out var restricted),
                        "restricted_token_creation_failed");
                    using (restricted)
                    {
                        // RunImpersonated is synchronous. No child process can escape
                        // this test; the OS must deny *real* file operations.
                        WindowsIdentity.RunImpersonated(restricted, () =>
                        {
                            using var effective = WindowsIdentity.GetCurrent();
                            Require(effective.User?.Value == originalUserSid,
                                "restricted_token_changed_account");
                            Require(Native.CheckTokenMembership(IntPtr.Zero, adminPointer, out var adminEnabled)
                                && !adminEnabled, "administrators_group_still_enabled");

                            var marker = Path.Combine(state,
                                "untrusted-same-user-" + Guid.NewGuid().ToString("N") + ".txt");
                            ExpectAccessDenied("new_file_create", () =>
                            {
                                using var unused = new FileStream(
                                    marker, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                            });
                            Require(!File.Exists(marker), "unexpected_untrusted_marker");

                            ExpectAccessDenied("sqlite_write", () =>
                            {
                                using var unused = new FileStream(sqlite, FileMode.Open,
                                    FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
                            });
                            ExpectAccessDenied("sqlite_direct_read", () =>
                            {
                                using var unused = new FileStream(sqlite, FileMode.Open,
                                    FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                            });
                            // Same-account restricted token must also be
                            // unable to connect to the ADMIN-ONLY real E~
                            // review/UV pipe. The old synthetic read pipe is
                            // deliberately a different security boundary.
                            ExpectAccessDenied("operator_uv_pipe", () =>
                            {
                                using var pipe = new NamedPipeClientStream(".",
                                    "AgentHubMemoryReviewLab-OperatorV1",
                                    PipeDirection.InOut);
                                pipe.Connect(1000);
                            });
                        });
                    }
                }
            }
            finally
            {
                Marshal.FreeHGlobal(adminPointer);
            }
            Console.WriteLine("MEMORY_REVIEW_SAME_ACCOUNT_RESTRICTED_TOKEN PASS 4/4; SAME_USER NO_ADMIN NO_DIRECT_DB_OR_UV_PIPE_ACCESS");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("MEMORY_REVIEW_SAME_ACCOUNT_RESTRICTED_TOKEN FAIL: "
                + ex.GetType().Name + ": " + ex.Message);
            return 1;
        }
    }

    private static void ExpectAccessDenied(string label, Action operation)
    {
        try
        {
            operation();
        }
        catch (UnauthorizedAccessException ex)
            when (ex.HResult == unchecked((int)0x80070005))
        {
            Console.WriteLine("PASS " + label + " access_denied");
            return;
        }
        throw new InvalidOperationException(label + "_unexpectedly_allowed_or_wrong_error");
    }

    private static void Require(bool condition, string code)
    {
        if (!condition) throw new InvalidOperationException(code);
    }

    private static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        internal readonly struct SidAndAttributes(IntPtr sid, uint attributes)
        {
            internal readonly IntPtr Sid = sid;
            internal readonly uint Attributes = attributes;
        }

        [DllImport("kernel32.dll")]
        internal static extern IntPtr GetCurrentProcess();

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool OpenProcessToken(
            IntPtr processHandle, uint desiredAccess, out SafeAccessTokenHandle tokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CreateRestrictedToken(
            SafeAccessTokenHandle existingTokenHandle, uint flags,
            uint disableSidCount, [In] SidAndAttributes[] sidsToDisable,
            uint deletePrivilegeCount, IntPtr privilegesToDelete,
            uint restrictedSidCount, IntPtr sidsToRestrict,
            out SafeAccessTokenHandle newTokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CheckTokenMembership(
            IntPtr tokenHandle, IntPtr sidToCheck, [MarshalAs(UnmanagedType.Bool)] out bool isMember);
    }
}
