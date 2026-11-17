using System.ComponentModel;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;
using Microsoft.Win32;

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
            var registryFenceMode = args.Length == 2
                && args[1] == "--registry-fence-ci";
            var userReadMode = args.Length == 4
                && args[1] is "--signed-user-ci" or "--revoked-user-ci"
                && args[2].Length == 40
                && args[2].All(ch => ch is >= '0' and <= '9' or >= 'a' and <= 'f')
                && Path.IsPathFullyQualified(args[3]);
            var expectRevoked = userReadMode && args[1] == "--revoked-user-ci";
            Require((args.Length == 1 || userReadMode || registryFenceMode)
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
                            if (registryFenceMode)
                            {
                                // The HKLM checkpoint must be inaccessible
                                // to the SAME account under its real restricted
                                // non-admin token, not merely protected on
                                // the fixture author's ACL inspection.
                                ExpectAccessDenied("hklm_read_once_checkpoint_write", () =>
                                {
                                    using var hive = RegistryKey.OpenBaseKey(
                                        RegistryHive.LocalMachine, RegistryView.Registry64);
                                    using var key = hive.OpenSubKey(
                                        @"SOFTWARE\AgentHubMemoryReviewLab-CiFence",
                                        writable: true)
                                        ?? throw new UnauthorizedAccessException();
                                    key.SetValue("Snapshot",
                                        "forge_attempt", RegistryValueKind.String);
                                });
                                ExpectAccessDenied("hklm_read_once_checkpoint_read", () =>
                                {
                                    using var hive = RegistryKey.OpenBaseKey(
                                        RegistryHive.LocalMachine, RegistryView.Registry64);
                                    using var key = hive.OpenSubKey(
                                        @"SOFTWARE\AgentHubMemoryReviewLab-CiFence",
                                        writable: false)
                                        ?? throw new UnauthorizedAccessException();
                                    _ = key.GetValue("Snapshot");
                                });
                            }
                            if (userReadMode)
                            {
                                Action connectAdminDirect = () =>
                                {
                                    using var pipe = new NamedPipeClientStream(".",
                                        "AgentHubMemoryReviewLab-DirectReadCiV1",
                                        PipeDirection.InOut);
                                    pipe.Connect(1000);
                                };
                                if (expectRevoked)
                                    ExpectRevokedPipeUnavailable(
                                        "admin_only_direct_read_pipe", connectAdminDirect);
                                else
                                    ExpectAccessDenied(
                                        "admin_only_direct_read_pipe", connectAdminDirect);
                                VerifySignedUserDirectCiRead(
                                    originalUserSid!, args[2], args[3], expectRevoked);
                            }
                        });
                    }
                }
            }
            finally
            {
                Marshal.FreeHGlobal(adminPointer);
            }
            Console.WriteLine(registryFenceMode
                ? "MEMORY_REVIEW_RESTRICTED_SAME_ACCOUNT_REGISTRY_FENCE PASS 2/2; NO_CHECKPOINT_READ_OR_WRITE"
                : userReadMode
                ? (expectRevoked
                    ? "MEMORY_REVIEW_SAME_ACCOUNT_RESTRICTED_TOKEN PASS 6/6; USER_DIRECT_READ_REVOKED, NO_ADMIN_OR_DB_ACCESS"
                    : "MEMORY_REVIEW_SAME_ACCOUNT_RESTRICTED_TOKEN PASS 6/6; ENROLLED_USER_READ_ONLY, NO_ADMIN_OR_DB_ACCESS")
                : "MEMORY_REVIEW_SAME_ACCOUNT_RESTRICTED_TOKEN PASS 4/4; SAME_USER NO_ADMIN NO_DIRECT_DB_OR_UV_PIPE_ACCESS");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("MEMORY_REVIEW_SAME_ACCOUNT_RESTRICTED_TOKEN FAIL: "
                + ex.GetType().Name + ": " + ex.Message);
            return 1;
        }
    }

    private static void VerifySignedUserDirectCiRead(
        string expectedSid, string revisionSha, string publicPinPath,
        bool expectRevoked = false)
    {
        const string protocol = "agenthub-protected-user-read-ci-v1";
        const string project = "github.com/example/operator-evidence";
        const string fact =
            "This knowledge statement is proposed from unverified historical Evidence.";
        const string query = "knowledge";

        var nonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        using var pipe = new NamedPipeClientStream(".",
            "AgentHubMemoryReviewLab-UserReadCiV1", PipeDirection.InOut,
            PipeOptions.Asynchronous, TokenImpersonationLevel.Impersonation);
        try
        {
            pipe.Connect(expectRevoked ? 1200 : 2500);
        }
        catch (TimeoutException) when (expectRevoked)
        {
            Console.WriteLine(
                "PASS revoked_same_account_nonadmin_user_pipe_absent_after_restart");
            return;
        }
        catch (IOException) when (expectRevoked)
        {
            Console.WriteLine(
                "PASS revoked_same_account_nonadmin_user_pipe_denied_after_restart");
            return;
        }
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            protocol, op = "read_user_ci", nonce,
            projectId = project, branch = "main", revisionSha,
            query, maxItems = 3,
        }) + "\n");
        pipe.Write(bytes);
        pipe.Flush();
        using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        string? line;
        try
        {
            line = reader.ReadLineAsync(timeout.Token).AsTask()
                .GetAwaiter().GetResult();
        }
        catch (OperationCanceledException) when (expectRevoked)
        {
            line = null;
        }
        catch (IOException) when (expectRevoked)
        {
            line = null;
        }
        if (expectRevoked)
        {
            // The server must NOT return any valid or invalid data after
            // revocation. A signed payload is not merely "untrusted"; it
            // must not be emitted by a running revoked read service.
            Require(line is null, "revoked_user_ci_returned_response");
            Console.WriteLine(
                "PASS revoked_same_account_nonadmin_user_read_no_response");
            return;
        }
        Require(line is { Length: >= 200 and <= 49152 },
            "enrolled_user_ci_read_missing_response");
        using var envelope = JsonDocument.Parse(line!);
        var outer = envelope.RootElement;
        Require(outer.GetProperty("protocol").GetString() == protocol,
            "signed_user_ci_wrong_protocol");
        var raw = Convert.FromBase64String(
            outer.GetProperty("payload_b64").GetString()!);
        var signature = Convert.FromBase64String(
            outer.GetProperty("signature_b64").GetString()!);
        using var key = ECDsa.Create();
        key.ImportFromPem(File.ReadAllText(publicPinPath));
        Require(key.ExportParameters(false).Curve.Oid.Value ==
                "1.2.840.10045.3.1.7"
            && key.VerifyData(raw, signature, HashAlgorithmName.SHA256,
                DSASignatureFormat.Rfc3279DerSequence),
            "enrolled_user_ci_signer_invalid");
        using var signed = JsonDocument.Parse(raw);
        var response = signed.RootElement;
        Require(response.GetProperty("protocol").GetString() == protocol
            && response.GetProperty("nonce").GetString() == nonce
            && response.GetProperty("principal_sid").GetString() == expectedSid
            && response.GetProperty("project_id").GetString() == project
            && response.GetProperty("branch").GetString() == "main"
            && response.GetProperty("revision_sha").GetString() == revisionSha
            && response.GetProperty("query").GetString() == query
            && response.GetProperty("max_items").GetInt32() == 3
            && response.GetProperty("status").GetString() == "found_direct_ci_only"
            && response.GetProperty("service_signed").GetBoolean()
            && response.GetProperty("read_only").GetBoolean()
            && response.GetProperty("ci_simulation_only").GetBoolean()
            && !response.GetProperty("trusted_for_production_recall").GetBoolean()
            && !response.GetProperty("physical_human_approval_verified").GetBoolean()
            && !response.GetProperty("published_to_codex").GetBoolean(),
            "enrolled_user_ci_scope_or_authority_invalid");
        var claims = response.GetProperty("items");
        Require(claims.ValueKind == JsonValueKind.Array
            && claims.GetArrayLength() == 1,
            "enrolled_user_ci_claim_count_invalid");
        var claim = claims[0];
        var statement = claim.GetProperty("value").GetString();
        var digest = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(statement ?? "")))
            .ToLowerInvariant();
        Require(statement == fact
            && claim.GetProperty("project_id").GetString() == project
            && claim.GetProperty("branch").GetString() == "main"
            && claim.GetProperty("revision_sha").GetString() == revisionSha
            && claim.GetProperty("fact_sha256").GetString() == digest
            && claim.GetProperty("provenance").GetString() ==
                "user_direct_reaffirmed_and_published_v1"
            && claim.GetProperty("historical_source_origin").GetString() ==
                "operator_pinned_unverified_evidence_v1"
            && !claim.GetProperty("historical_evidence_verified").GetBoolean()
            && !claim.GetProperty("physical_human_approval_verified").GetBoolean()
            && !claim.GetProperty("published_to_codex").GetBoolean(),
            "enrolled_user_ci_claim_not_authenticated");
        Console.WriteLine(
            "PASS enrolled_same_account_nonadmin_signed_direct_read; REAL_OS_SID AND SERVICE_SIGNATURE VERIFIED; NO_PRODUCTION_RECALL");
    }

    private static void ExpectRevokedPipeUnavailable(
        string label, Action operation)
    {
        try { operation(); }
        catch (TimeoutException)
        {
            Console.WriteLine("PASS " + label + " absent_after_revocation");
            return;
        }
        catch (UnauthorizedAccessException ex)
            when (ex.HResult == unchecked((int)0x80070005))
        {
            Console.WriteLine("PASS " + label + " access_denied_after_revocation");
            return;
        }
        throw new InvalidOperationException(label + "_revoked_but_connectable");
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
