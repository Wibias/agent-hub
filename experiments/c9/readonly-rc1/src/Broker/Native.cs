using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace AgentHub.LaneB;

internal static class Native
{
    internal const uint PipeAccessDuplex = 0x00000003;
    internal const uint FileFlagFirstPipeInstance = 0x00080000;
    internal const uint PipeRejectRemoteClients = 0x00000008;
    internal const uint TokenQuery = 0x00000008;
    internal const uint SeGroupEnabled = 0x00000004;

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        internal int Length;
        internal IntPtr Descriptor;
        [MarshalAs(UnmanagedType.Bool)] internal bool Inherit;
    }

    [DllImport("advapi32.dll", EntryPoint="ConvertStringSecurityDescriptorToSecurityDescriptorW", CharSet=CharSet.Unicode, SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ConvertSddl(string sddl, uint revision, out IntPtr descriptor, out uint size);

    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern IntPtr LocalFree(IntPtr pointer);

    [DllImport("kernel32.dll", EntryPoint="CreateNamedPipeW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern SafeFileHandle CreateNamedPipe(string name, uint openMode, uint pipeMode,
        uint instances, uint outBuffer, uint inBuffer, uint timeout, ref SecurityAttributes attributes);

    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ConnectNamedPipe(SafeFileHandle pipe, IntPtr overlapped);

    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ReadFile(SafeFileHandle pipe, byte[] buffer, uint bytesToRead, out uint bytesRead, IntPtr overlapped);

    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool WriteFile(SafeFileHandle pipe, byte[] buffer, uint bytesToWrite, out uint bytesWritten, IntPtr overlapped);

    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool FlushFileBuffers(SafeFileHandle pipe);

    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DisconnectNamedPipe(SafeFileHandle pipe);

    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CancelIoEx(SafeFileHandle pipe, IntPtr overlapped);

    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ImpersonateNamedPipeClient(SafeFileHandle pipe);

    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool RevertToSelf();

    [DllImport("kernel32.dll")]
    internal static extern IntPtr GetCurrentThread();

    [DllImport("kernel32.dll")]
    internal static extern IntPtr GetCurrentProcess();

    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool OpenThreadToken(IntPtr thread, uint access,
        [MarshalAs(UnmanagedType.Bool)] bool openAsSelf, out SafeAccessTokenHandle handle);

    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool OpenProcessToken(IntPtr process, uint access, out SafeAccessTokenHandle handle);

    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetTokenInformation(SafeAccessTokenHandle token, int informationClass,
        IntPtr buffer, int bufferSize, out int bytesWritten);

    internal static SafeFileHandle CreateRestrictedPipe()
    {
        // The DACL is intentionally not GR/GW or GENERIC_WRITE: that could grant
        // FILE_CREATE_PIPE_INSTANCE. The exact mask matches Lane A's positive Windows test.
        string sddl = $"D:P(A;;GA;;;SY)(A;;GA;;;{BrokerIdentity.BrokerServiceSid})" +
            $"(A;;0x{BrokerIdentity.ClientAccess:X8};;;{BrokerIdentity.ScratchServiceSid})";
        if (!ConvertSddl(sddl, 1, out IntPtr descriptor, out _))
            throw LastError("ConvertSddl");
        try
        {
            var security = new SecurityAttributes {
                Length = Marshal.SizeOf<SecurityAttributes>(),
                Descriptor = descriptor, Inherit = false
            };
            SafeFileHandle pipe = CreateNamedPipe(BrokerIdentity.PipePath,
                PipeAccessDuplex | FileFlagFirstPipeInstance,
                PipeRejectRemoteClients, 1, 4096, 4096, 0, ref security);
            if (pipe.IsInvalid)
            {
                int error = Marshal.GetLastWin32Error();
                pipe.Dispose();
                throw new Win32Exception(error, "CreateNamedPipeW failed");
            }
            return pipe;
        }
        finally { LocalFree(descriptor); }
    }

    internal static Win32Exception LastError(string operation) =>
        new Win32Exception(Marshal.GetLastWin32Error(), operation + " failed");
}
