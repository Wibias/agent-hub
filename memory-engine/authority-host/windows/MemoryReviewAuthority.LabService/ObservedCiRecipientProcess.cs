using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace MemoryReviewAuthority.LabService;

/// <summary>
/// OS-observed CI process provenance and lifetime consistency, NOT signer,
/// anti-injection or unmodified-Codex attestation. Hold the kernel process
/// handle so reuse of a numeric PID cannot impersonate the observed process.
/// Same-user processes can still cause code to run INSIDE the observed process.
/// </summary>
internal sealed class ObservedCiRecipientProcess : IDisposable
{
    private const uint QueryLimited = 0x1000;
    private const uint Synchronize = 0x00100000;
    private const uint WaitTimeout = 0x102;
    private readonly SafeProcessHandle _handle;
    private readonly uint _pid;
    private readonly ulong _created;
    internal string ImagePath { get; }
    internal ulong CreationFileTime => _created;

    private ObservedCiRecipientProcess(SafeProcessHandle handle,uint pid,
        ulong created,string imagePath)
    {
        _handle=handle;
        _pid=pid;
        _created=created;
        ImagePath=imagePath;
    }

    /// <summary>
    /// Observe the ACTUAL named-pipe client handle. The connection is not
    /// presumed trusted: the process can be compromised or controlled by a
    /// sibling process with the same Windows account and integrity level.
    /// </summary>
    internal static ObservedCiRecipientProcess? Observe(
        NamedPipeServerStream pipe,uint expectedKernelPid)
    {
        if(!OperatingSystem.IsWindows() || expectedKernelPid==0
            || !pipe.IsConnected
            || !GetNamedPipeClientProcessId(pipe.SafePipeHandle,out var observed)
            || observed!=expectedKernelPid)
            return null;
        var handle=OpenProcess(QueryLimited|Synchronize,false,observed);
        if(handle.IsInvalid)
        {
            handle.Dispose();
            return null;
        }
        if(WaitForSingleObject(handle,0)!=WaitTimeout
            || !TryCreation(handle,out var created)
            || !TryImage(handle,out var image))
        {
            handle.Dispose();
            return null;
        }
        return new ObservedCiRecipientProcess(handle,observed,created,image);
    }

    internal bool Matches(NamedPipeServerStream pipe)
    {
        if(_handle.IsClosed || !pipe.IsConnected
            || !GetNamedPipeClientProcessId(pipe.SafePipeHandle,out var pid)
            || pid!=_pid || WaitForSingleObject(_handle,0)!=WaitTimeout
            || !TryCreation(_handle,out var created)
            || created!=_created || !TryImage(_handle,out var image))
            return false;
        return StringComparer.OrdinalIgnoreCase.Equals(image,ImagePath);
    }

    private static bool TryCreation(SafeProcessHandle h,out ulong created)
    {
        created=0;
        if(!GetProcessTimes(h,out var born,out _,out _,out _))
            return false;
        created=((ulong)(uint)born.dwHighDateTime<<32)|(uint)born.dwLowDateTime;
        return created!=0;
    }

    private static bool TryImage(SafeProcessHandle h,out string image)
    {
        image="";
        const uint bufferSize=32768;
        var buf=new StringBuilder((int)bufferSize);
        var size=bufferSize;
        if(!QueryFullProcessImageName(h,0,buf,ref size)
            ||size is < 4 or >= bufferSize)
            return false;
        image=buf.ToString();
        // This is an observed string, not a trusted or immutable file path.
        return Path.IsPathFullyQualified(image)
            && image.Length<=2048 && !image.Contains('\n')
            && !image.Contains('\r');
    }

    public void Dispose()=>_handle.Dispose();

    [DllImport("kernel32.dll",ExactSpelling=true,SetLastError=true)]
    private static extern SafeProcessHandle OpenProcess(uint access,
        [MarshalAs(UnmanagedType.Bool)] bool inherit,uint pid);
    [DllImport("kernel32.dll",ExactSpelling=true,SetLastError=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(
        SafePipeHandle pipe,out uint pid);
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
    private static extern uint WaitForSingleObject(SafeProcessHandle process,uint ms);
}
