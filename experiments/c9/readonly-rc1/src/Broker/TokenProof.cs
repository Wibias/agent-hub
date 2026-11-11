using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace AgentHub.LaneB;

internal sealed record TokenSnapshot(string UserSid, string[] EnabledSids, int RestrictedSids, int? ImpersonationLevel);

internal static class TokenProof
{
    private static readonly int GroupStart = IntPtr.Size == 8 ? 8 : 4;
    private static readonly int GroupStride = IntPtr.Size == 8 ? 16 : 8;

    private static IntPtr GetBuffer(SafeAccessTokenHandle token, int informationClass)
    {
        if (Native.GetTokenInformation(token, informationClass, IntPtr.Zero, 0, out int length))
            throw new InvalidOperationException("Unexpected empty token query success");
        int error = Marshal.GetLastWin32Error();
        if (error != 122 || length <= 0 || length > 1_048_576)
            throw new Win32Exception(error, "Token information size invalid");
        IntPtr p = Marshal.AllocHGlobal(length);
        try
        {
            if (!Native.GetTokenInformation(token, informationClass, p, length, out int written) || written > length || written < 0)
                throw Native.LastError("GetTokenInformation");
            return p;
        }
        catch { Marshal.FreeHGlobal(p); throw; }
    }

    private static string ReadUser(SafeAccessTokenHandle token)
    {
        IntPtr p = GetBuffer(token, 1); // TokenUser
        try { return new SecurityIdentifier(Marshal.ReadIntPtr(p)).Value; }
        finally { Marshal.FreeHGlobal(p); }
    }

    private static int ReadInt32(SafeAccessTokenHandle token, int informationClass)
    {
        IntPtr p = GetBuffer(token, informationClass);
        try { return Marshal.ReadInt32(p); }
        finally { Marshal.FreeHGlobal(p); }
    }

    private static string[] ReadEnabledGroups(SafeAccessTokenHandle token)
    {
        IntPtr p = GetBuffer(token, 2); // TokenGroups
        try
        {
            int count = Marshal.ReadInt32(p);
            if (count < 0 || count > 4096) throw new InvalidOperationException("Token group count invalid");
            var enabled = new List<string>(count);
            for (int i = 0; i < count; i++)
            {
                int offset = checked(GroupStart + i * GroupStride);
                IntPtr sid = Marshal.ReadIntPtr(p, offset);
                uint attributes = unchecked((uint)Marshal.ReadInt32(p, offset + IntPtr.Size));
                if ((attributes & Native.SeGroupEnabled) != 0)
                    enabled.Add(new SecurityIdentifier(sid).Value);
            }
            return enabled.ToArray();
        }
        finally { Marshal.FreeHGlobal(p); }
    }

    private static TokenSnapshot Snapshot(SafeAccessTokenHandle token, bool client)
    {
        string user = ReadUser(token);
        string[] groups = ReadEnabledGroups(token);
        int restrictedCount = ReadInt32(token, 11); // TokenRestrictedSids, count at offset 0
        int? level = null;
        if (client)
        {
            if (ReadInt32(token, 8) != 2) // TokenImpersonation
                throw new InvalidOperationException("Client token must be impersonation type");
            level = ReadInt32(token, 9); // TokenImpersonationLevel
        }
        return new TokenSnapshot(user, groups, restrictedCount, level);
    }

    internal static void CheckBrokerProcess()
    {
        if (!Native.OpenProcessToken(Native.GetCurrentProcess(), Native.TokenQuery, out var token))
            throw Native.LastError("OpenProcessToken");
        using (token)
        {
            TokenSnapshot t = Snapshot(token, client: false);
            if (t.UserSid != BrokerIdentity.LocalServiceSid ||
                !t.EnabledSids.Contains(BrokerIdentity.BrokerServiceSid, StringComparer.OrdinalIgnoreCase) ||
                 t.EnabledSids.Contains(BrokerIdentity.ScratchServiceSid, StringComparer.OrdinalIgnoreCase) ||
                 t.RestrictedSids != 0)
                throw new InvalidOperationException("BROKER_SERVICE_IDENTITY_DENIED");
        }
    }

    internal static bool CheckClientAfterRead(SafeFileHandle pipe)
    {
        // Called on the same thread immediately after a successful ReadFile.
        if (!Native.ImpersonateNamedPipeClient(pipe)) return false;
        bool approved = false;
        try
        {
            if (!Native.OpenThreadToken(Native.GetCurrentThread(), Native.TokenQuery, true, out var token))
                throw Native.LastError("OpenThreadToken");
            using (token)
            {
                TokenSnapshot t = Snapshot(token, client: true);
                approved = t.UserSid == BrokerIdentity.LocalServiceSid &&
                    t.EnabledSids.Contains(BrokerIdentity.ScratchServiceSid, StringComparer.OrdinalIgnoreCase) &&
                    !t.EnabledSids.Contains(BrokerIdentity.BrokerServiceSid, StringComparer.OrdinalIgnoreCase) &&
                    t.RestrictedSids == 0 && t.ImpersonationLevel == 2;
            }
        }
        catch (Exception) { approved = false; }
        finally
        {
            // Never continue to application logic on a thread whose identity
            // could not be restored. No logging/file access while impersonated.
            if (!Native.RevertToSelf()) Environment.FailFast("LANE_B_FATAL_REVERT_TO_SELF_FAILURE");
        }
        return approved;
    }
}
