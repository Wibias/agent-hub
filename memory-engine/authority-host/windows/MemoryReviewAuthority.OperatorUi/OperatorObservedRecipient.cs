using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace MemoryReviewAuthority.OperatorUi;

/// <summary>
/// The administrator-owned, separately signed native GUI observes a PID
/// returned by the service's SIGNED offer (never an agent JSON argument).
/// A handle pins creation time against PID reuse while consent is pending.
/// This is diagnostic executable provenance, NOT protection against same-user
/// automation, injection, handle theft or an unmodified Codex identity.
/// </summary>
internal sealed class OperatorObservedRecipient : IDisposable
{
    private const uint QueryLimited=0x1000;
    private const uint Synchronize=0x00100000;
    private const uint WaitTimeout=0x102;
    private readonly SafeProcessHandle _handle;
    private readonly ulong _created;
    private readonly string _path;
    private readonly uint _pid;
    internal string ImagePath => _path;
    internal ulong CreatedFileTime => _created;
    internal uint KernelPid => _pid;

    private OperatorObservedRecipient(SafeProcessHandle h,uint pid,
        ulong created,string path)
    {
        _handle=h;_pid=pid;_created=created;_path=path;
    }

    internal static OperatorObservedRecipient Observe(uint signedServiceKernelPid)
    {
        if(!OperatingSystem.IsWindows() || signedServiceKernelPid==0)
            throw new InvalidOperationException("ci_recipient_origin_invalid_pid");
        // QUERY_LIMITED_INFORMATION only, never VM_READ/VM_WRITE/DEBUG
        // or any process handle capable of modifying the target.
        var handle=OpenProcess(QueryLimited|Synchronize,false,
            signedServiceKernelPid);
        if(handle.IsInvalid)
        {
            handle.Dispose();
            throw new InvalidOperationException(
                "ci_recipient_origin_process_query_denied");
        }
        if(WaitForSingleObject(handle,0)!=WaitTimeout
            || !GetProcessTimes(handle,out var born,out _,out _,out _))
        {
            handle.Dispose();
            throw new InvalidOperationException(
                "ci_recipient_origin_process_exited");
        }
        var created=((ulong)(uint)born.dwHighDateTime<<32)
            |(uint)born.dwLowDateTime;
        var builder=new StringBuilder(32768);
        uint size=32768;
        if(created==0 || !QueryFullProcessImageName(handle,0,builder,ref size)
            || size is < 4 or >= 32768)
        {
            handle.Dispose();
            throw new InvalidOperationException(
                "ci_recipient_origin_image_unavailable");
        }
        var path=builder.ToString();
        if(!Path.IsPathFullyQualified(path) || path.Length>2048)
        {
            handle.Dispose();
            throw new InvalidOperationException(
                "ci_recipient_origin_image_invalid");
        }
        return new OperatorObservedRecipient(handle,signedServiceKernelPid,
            created,path);
    }

    internal bool Matches()
    {
        if(_handle.IsClosed || WaitForSingleObject(_handle,0)!=WaitTimeout
            || !GetProcessTimes(_handle,out var born,out _,out _,out _))
            return false;
        var current=((ulong)(uint)born.dwHighDateTime<<32)
            |(uint)born.dwLowDateTime;
        if(current!=_created)return false;
        var image=new StringBuilder(32768);
        uint size=32768;
        return QueryFullProcessImageName(_handle,0,image,ref size)
            &&size is >=4 and <32768
            &&StringComparer.OrdinalIgnoreCase.Equals(image.ToString(),_path);
    }

    public void Dispose()=>_handle.Dispose();

    [DllImport("kernel32.dll",ExactSpelling=true,SetLastError=true)]
    private static extern SafeProcessHandle OpenProcess(uint access,
        [MarshalAs(UnmanagedType.Bool)]bool inherit,uint pid);
    [DllImport("kernel32.dll",EntryPoint="QueryFullProcessImageNameW",
        CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(
        SafeProcessHandle process,uint flags,StringBuilder path,ref uint size);
    [DllImport("kernel32.dll",ExactSpelling=true,SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessTimes(SafeProcessHandle process,
        out System.Runtime.InteropServices.ComTypes.FILETIME created,
        out System.Runtime.InteropServices.ComTypes.FILETIME exit,
        out System.Runtime.InteropServices.ComTypes.FILETIME kernel,
        out System.Runtime.InteropServices.ComTypes.FILETIME user);
    [DllImport("kernel32.dll",ExactSpelling=true)]
    private static extern uint WaitForSingleObject(
        SafeProcessHandle process,uint milliseconds);
}
