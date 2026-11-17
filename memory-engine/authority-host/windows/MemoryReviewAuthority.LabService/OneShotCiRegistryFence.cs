using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using MemoryReviewAuthority.Store;
using Microsoft.Win32;

namespace MemoryReviewAuthority.LabService;

/// <summary>
/// Only the disposable Windows SCM synthetic CI lane. An independent
/// Administrator-provisioned HKLM Registry64 key mirrors a hash of the full
/// service-SID-protected SQLite read-once journal. Restoring ONLY an older DB
/// cannot silently lose terminal consumes or an irrevocable revocation.
///
/// Registry ACL is provisioned and audited by the elevated CI fixture:
/// SYSTEM / Administrators / exact service SID. Ordinary same-account users
/// cannot edit it. An ADMIN/SYSTEM attacker who can restore BOTH surfaces
/// defeats this fence; it is not a TPM monotonic counter or production trust.
/// </summary>
internal sealed class OneShotCiRegistryFence : IDisposable
{
    internal const string RegistryPath =
        @"SOFTWARE\AgentHubMemoryReviewLab-CiFence";
    internal const string BootstrapText =
        "AGENTHUB_ONE_SHOT_REGISTRY_FENCE_CI_BOOTSTRAP_ONCE_V1";
    private const string ValueName = "Snapshot";
    private const string BootstrapName = "Bootstrap";
    private static readonly Regex CheckpointFormat = new(
        @"\Av1:[1-9][0-9]{0,15}:[a-f0-9]{64}\z",
        RegexOptions.CultureInvariant);

    private readonly RegistryKey _key;
    private readonly ProtectedPendingReviewLedger _ledger;
    private string _expected;
    private long _sequence;
    private bool _poisoned;

    private OneShotCiRegistryFence(
        RegistryKey key,ProtectedPendingReviewLedger ledger,
        string expected,long sequence)
    {
        _key=key;
        _ledger=ledger;
        _expected=expected;
        _sequence=sequence;
    }

    internal static OneShotCiRegistryFence OpenAndVerify(
        ProtectedPendingReviewLedger ledger)
    {
        if(!ReviewHostIdentity.IsCurrentScmIdentity()
            || !OperatingSystem.IsWindows() || !Environment.Is64BitProcess)
            throw new InvalidOperationException("ci_registry_fence_wrong_scm_identity");
        using var hive=RegistryKey.OpenBaseKey(
            RegistryHive.LocalMachine,RegistryView.Registry64);
        var key=hive.OpenSubKey(RegistryPath,writable:true)
            ?? throw new InvalidOperationException("ci_registry_fence_missing");
        try
        {
            var snapshot=ledger.ReadCiOneShotFenceSnapshot();
            var current=key.GetValue(ValueName) as string;
            var bootstrap=key.GetValue(BootstrapName) as string;
            if(current is null)
            {
                // One-time ADMIN-provisioned bootstrap is only permitted
                // when the protected journal is completely empty and has
                // never been revoked. Never reseed a missing registry
                // checkpoint from existing SQLite alone.
                if(bootstrap!=BootstrapText
                    || snapshot.Receipts!=0 || snapshot.Revoked)
                    throw new InvalidOperationException(
                        "ci_registry_fence_no_authorized_empty_bootstrap");
                current="v1:1:"+snapshot.Sha256;
                key.SetValue(ValueName,current,RegistryValueKind.String);
                key.Flush();
                key.DeleteValue(BootstrapName,throwOnMissingValue:false);
                key.Flush();
            }
            else if(bootstrap is not null)
                throw new InvalidOperationException(
                    "ci_registry_fence_bootstrap_replay_denied");
            var sequence=VerifySnapshot(current,snapshot.Sha256);
            return new OneShotCiRegistryFence(key,ledger,current,sequence);
        }
        catch
        {
            key.Dispose();
            throw;
        }
    }

    private static long VerifySnapshot(string? anchor,string actualSha)
    {
        if(anchor is null || !CheckpointFormat.IsMatch(anchor))
            throw new InvalidOperationException("ci_registry_fence_anchor_malformed");
        var parts=anchor.Split(':');
        if(!long.TryParse(parts[1],NumberStyles.None,
            CultureInfo.InvariantCulture,out var n)
            || n<1 || parts[2]!=actualSha)
            throw new InvalidOperationException(
                "ci_registry_fence_sqlite_rollback_or_tamper_denied");
        return n;
    }

    private void CheckAnchorNotReplaced()
    {
        if(_poisoned)throw new InvalidOperationException(
            "ci_registry_fence_latched_failure");
        if(_key.GetValue(BootstrapName) is not null
            || _key.GetValue(ValueName) is not string actual
            || actual!=_expected)
        {
            _poisoned=true;
            throw new InvalidOperationException(
                "ci_registry_fence_changed_while_service_running");
        }
    }

    internal void VerifyBeforeMutation()
    {
        try
        {
            CheckAnchorNotReplaced();
            VerifySnapshot(_expected,_ledger.ReadCiOneShotFenceSnapshot().Sha256);
        }
        catch
        {
            _poisoned=true;
            throw;
        }
    }

    /// <summary>
    /// Must be called after every successful protected SQLite state change
    /// and BEFORE any private bytes can be sent. If updating HKLM fails,
    /// the CI release remains denied, and restart mismatches fail closed.
    /// </summary>
    internal void AdvanceAfterMutation()
    {
        try
        {
            CheckAnchorNotReplaced();
            var digest=_ledger.ReadCiOneShotFenceSnapshot().Sha256;
            if(digest==_expected.Split(':')[2])return;
            var next=checked(_sequence+1);
            var checkpoint="v1:"+next.ToString(CultureInfo.InvariantCulture)
                +":"+digest;
            _key.SetValue(ValueName,checkpoint,RegistryValueKind.String);
            _key.Flush();
            _expected=checkpoint;
            _sequence=next;
        }
        catch
        {
            _poisoned=true;
            throw;
        }
    }

    public void Dispose()
    {
        _poisoned=true;
        _key.Dispose();
    }
}
