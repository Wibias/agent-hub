using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace AgentHub.C9.G2;

// Exact values from frozen readonly-rc1/src/Broker/BrokerIdentity.cs.
// This review has no independent authority to change those identities.
public static class FrozenServiceIdentity
{
    public const string BrokerServiceSid = "S-1-5-80-1871353128-2073126224-3623205792-890782069-2664301559";
    public const string ClientServiceSid = "S-1-5-80-206086128-3447947495-1842352659-2836494350-1013679070";
    public const string LocalServiceSid = "S-1-5-19";
}

// Values come only from a Windows token returned by GetTokenInformation.
// A snapshot is diagnostic evidence, NOT a caller-asserted authorization token.
public sealed record KernelTokenSnapshot(
    string UserSid, IReadOnlyList<string> EnabledGroupSids, int RestrictedSidCount,
    int TokenType, int? ImpersonationLevel);

public static class G2KernelIdentity
{
    private const uint TokenQuery = 0x0008;
    private const uint SeGroupEnabled = 0x00000004;
    private const int ErrorInsufficientBuffer = 122;
    private const int ErrorNoToken = 1008;
    private static readonly int GroupsOffset = IntPtr.Size == 8 ? 8 : 4;
    private static readonly int GroupStride = IntPtr.Size == 8 ? 16 : 8;

    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentThread();
    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(IntPtr process,uint access,out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenThreadToken(IntPtr thread,uint access,
        [MarshalAs(UnmanagedType.Bool)] bool openAsSelf,out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(SafeAccessTokenHandle token,int kind,
        IntPtr buffer,int length,out int written);
    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ImpersonateNamedPipeClient(SafeHandle pipe);
    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RevertToSelf();

    private static IntPtr ReadBuffer(SafeAccessTokenHandle token,int kind,out int length)
    {
        if (GetTokenInformation(token,kind,IntPtr.Zero,0,out length))
            throw new InvalidOperationException("G2_UNEXPECTED_EMPTY_TOKEN_QUERY");
        int error = Marshal.GetLastWin32Error();
        if (error!=ErrorInsufficientBuffer || length is < 4 or > 1048576)
            throw new Win32Exception(error,"G2_TOKEN_QUERY_LENGTH_DENIED");
        IntPtr pointer=Marshal.AllocHGlobal(length);
        try
        {
            if(!GetTokenInformation(token,kind,pointer,length,out int written) ||
                written is < 4 or > 1048576 || written>length)
                throw new Win32Exception(Marshal.GetLastWin32Error(),"G2_TOKEN_QUERY_DENIED");
            length=written;
            return pointer;
        }
        catch { Marshal.FreeHGlobal(pointer); throw; }
    }
    private static int ReadNumber(SafeAccessTokenHandle token,int kind)
    {
        IntPtr p=ReadBuffer(token,kind,out int n);
        try {if(n<4)throw new InvalidOperationException("G2_TOKEN_NUMBER_SHORT");return Marshal.ReadInt32(p);}
        finally {Marshal.FreeHGlobal(p);}
    }
    private static KernelTokenSnapshot Snapshot(SafeAccessTokenHandle token,bool client)
    {
        IntPtr p=ReadBuffer(token,1,out int n);
        string user;
        try
        {
            if(n<IntPtr.Size)throw new InvalidOperationException("G2_USER_SHORT");
            user=new SecurityIdentifier(Marshal.ReadIntPtr(p)).Value;
        }
        finally {Marshal.FreeHGlobal(p);}
        p=ReadBuffer(token,2,out n);
        string[] groups;
        try
        {
            int count=Marshal.ReadInt32(p);
            if(count<0 || count>4096 || n<GroupsOffset ||
                (long)GroupsOffset+(long)count*GroupStride>n)
                throw new InvalidOperationException("G2_GROUPS_INVALID");
            var enabled=new List<string>(count);
            for(int i=0;i<count;i++)
            {
                int pos=checked(GroupsOffset+i*GroupStride);
                uint attrs=unchecked((uint)Marshal.ReadInt32(p,pos+IntPtr.Size));
                if((attrs & SeGroupEnabled)!=0)
                    enabled.Add(new SecurityIdentifier(Marshal.ReadIntPtr(p,pos)).Value);
            }
            groups=enabled.ToArray();
        }
        finally {Marshal.FreeHGlobal(p);}
        int type=ReadNumber(token,8); // TokenType, primary=1 or impersonation=2
        int restricted;
        p=ReadBuffer(token,11,out n); // TokenRestrictedSids (TOKEN_GROUPS)
        try {restricted=Marshal.ReadInt32(p);}
        finally {Marshal.FreeHGlobal(p);}
        if(restricted<0 || restricted>4096 || type is not (1 or 2))
            throw new InvalidOperationException("G2_TOKEN_TYPE_OR_RESTRICTED_INVALID");
        int? level=client ? ReadNumber(token,9) : null;
        return new KernelTokenSnapshot(user,Array.AsReadOnly(groups),restricted,type,level);
    }
    public static KernelTokenSnapshot SnapshotProcess()
    {
        if(!OperatingSystem.IsWindows())throw new PlatformNotSupportedException("G2_WINDOWS_ONLY");
        if(!OpenProcessToken(GetCurrentProcess(),TokenQuery,out var token))
            throw new Win32Exception(Marshal.GetLastWin32Error(),"G2_PROCESS_TOKEN_DENIED");
        using(token)return Snapshot(token,false);
    }
    public static bool ThreadIsUnimpersonated()
    {
        if(!OperatingSystem.IsWindows())return false;
        if(OpenThreadToken(GetCurrentThread(),TokenQuery,true,out var token))
        {token.Dispose();return false;}
        return Marshal.GetLastWin32Error()==ErrorNoToken;
    }
    // MUST be called on the same native thread, immediately after a successful
    // synchronous ReadFile on the supplied pipe. It always reverts before returning.
    // No application IO, G3/G4/G5 or logging may run while impersonated.
    public static KernelTokenSnapshot? SnapshotClientAfterRead(SafeHandle pipe)
    {
        if(!OperatingSystem.IsWindows() || pipe is null || pipe.IsInvalid || pipe.IsClosed ||
           !ThreadIsUnimpersonated())return null;
        if(!ImpersonateNamedPipeClient(pipe))return null;
        try
        {
            if(!OpenThreadToken(GetCurrentThread(),TokenQuery,true,out var token))return null;
            using(token)return Snapshot(token,true);
        }
        catch(Exception e) when(e is Win32Exception or InvalidOperationException or
            ArgumentException or SystemException)
        {return null;}
        finally
        {
            if(!RevertToSelf())Environment.FailFast("G2_FATAL_REVERT_TO_SELF_FAILURE");
        }
    }
    public static bool BrokerIsExpectedService(KernelTokenSnapshot? token) =>
        token is {TokenType:1,RestrictedSidCount:0,UserSid:FrozenServiceIdentity.LocalServiceSid} &&
        token.EnabledGroupSids.Contains(FrozenServiceIdentity.BrokerServiceSid,StringComparer.OrdinalIgnoreCase) &&
        !token.EnabledGroupSids.Contains(FrozenServiceIdentity.ClientServiceSid,StringComparer.OrdinalIgnoreCase);
    public static bool ClientIsExpectedService(KernelTokenSnapshot? token) =>
        token is {TokenType:2,ImpersonationLevel:2,RestrictedSidCount:0,UserSid:FrozenServiceIdentity.LocalServiceSid} &&
        token.EnabledGroupSids.Contains(FrozenServiceIdentity.ClientServiceSid,StringComparer.OrdinalIgnoreCase) &&
        !token.EnabledGroupSids.Contains(FrozenServiceIdentity.BrokerServiceSid,StringComparer.OrdinalIgnoreCase);
}
