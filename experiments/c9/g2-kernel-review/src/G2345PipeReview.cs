using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using AgentHub.C9.G3;
using AgentHub.C9.G345;
using Microsoft.Win32.SafeHandles;

namespace AgentHub.C9.G2;

public readonly record struct G2345PipeVerdict(
    string Reason, bool G2KernelVerified, bool G3Verified,
    bool G5Bound, bool G4Reserved, bool CanExecuteCommit)
{
    public static G2345PipeVerdict Deny(string reason) =>
        new(reason,false,false,false,false,false);
}

public sealed record ReviewIntentWithoutTokenClaims(
    string TrustedRoot,string RelativePath,string ReleaseSha256,string RequestId,
    string Operation,string TargetId,string PayloadSha256);

// One-shot Windows named-pipe entrypoint: the app cannot inject bool token flags.
// It uses real ReadFile bytes and thread-bound impersonation evidence. No write API.
public sealed class G2345PipeReview(G4NonceJournal journal)
{
    [DllImport("kernel32.dll",EntryPoint="ReadFile",SetLastError=true,ExactSpelling=true)]
    [return:MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReadFile(SafeHandle handle,byte[] buffer,uint count,
        out uint bytesRead,IntPtr overlapped);

    private static bool ReadExactly(SafeHandle handle,byte[] dest)
    {
        int offset=0;
        while(offset<dest.Length)
        {
            byte[] temp=new byte[dest.Length-offset];
            if(!ReadFile(handle,temp,(uint)temp.Length,out uint read,IntPtr.Zero) || read==0 || read>temp.Length)
                return false;
            Buffer.BlockCopy(temp,0,dest,offset,(int)read);
            offset+=(int)read;
        }
        return true;
    }
    public G2345PipeVerdict EvaluateOneRead(SafeHandle pipe,
        ReviewIntentWithoutTokenClaims? intent,TrustedKeySnapshot? trusted,
        string expectedIssuer,long nowUnix)
    {
        if(!OperatingSystem.IsWindows() ||
           Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT")!="github-hosted" ||
           Environment.GetEnvironmentVariable("RUNNER_OS")!="Windows" ||
           Environment.GetEnvironmentVariable("AGENTHUB_G2_REVIEW_ONLY")!="DISPOSABLE_WINDOWS_TEST" ||
           pipe is null || pipe.IsInvalid || pipe.IsClosed || intent is null || trusted is null ||
           !G2KernelIdentity.ThreadIsUnimpersonated())
            return G2345PipeVerdict.Deny("G2_REVIEW_SCOPE_OR_CONTEXT_DENIED");
        try
        {
            // The broker's process primary token is not supplied by any caller.
            KernelTokenSnapshot broker=G2KernelIdentity.SnapshotProcess();
            byte[] prefix=new byte[4];
            if(!ReadExactly(pipe,prefix))return G2345PipeVerdict.Deny("G2_PIPE_FRAME_DENIED");
            uint length=System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(prefix);
            if(length is < 150 or > 4096)return G2345PipeVerdict.Deny("G2_PIPE_LENGTH_DENIED");
            byte[] ticket=new byte[length];
            if(!ReadExactly(pipe,ticket))return G2345PipeVerdict.Deny("G2_PIPE_FRAME_DENIED");
            // Impersonation MUST occur immediately after the last successful ReadFile
            // on this exact thread, before any G3 parsing or disk IO.
            KernelTokenSnapshot? client=G2KernelIdentity.SnapshotClientAfterRead(pipe);
            if(!G2KernelIdentity.ThreadIsUnimpersonated())
                return G2345PipeVerdict.Deny("G2_REVERT_NOT_CONFIRMED");
            if(!G2KernelIdentity.BrokerIsExpectedService(broker) ||
               !G2KernelIdentity.ClientIsExpectedService(client))
                return G2345PipeVerdict.Deny("G2_SERVICE_TOKEN_DENIED");

            // Only native evidence can set these three flags. The original G345
            // test gate remains isolated and cannot authorize writes itself.
            var observation=new ReviewObservation(intent.TrustedRoot,intent.RelativePath,
                intent.ReleaseSha256,intent.RequestId,intent.Operation,intent.TargetId,
                intent.PayloadSha256,FrozenServiceIdentity.BrokerServiceSid,
                FrozenServiceIdentity.ClientServiceSid,true,true,true);
            ReviewDecision reviewed=new ReviewGate(journal).Evaluate(
                ticket,observation,trusted,expectedIssuer,nowUnix);
            return new G2345PipeVerdict(reviewed.Reason,true,reviewed.G3Verified,
                reviewed.G5Bound,reviewed.G4Reserved,false);
        }
        catch(Exception e) when(e is IOException or Win32Exception or InvalidOperationException or
            ArgumentException or CryptographicException or UnauthorizedAccessException)
        {return G2345PipeVerdict.Deny("G2_NATIVE_OR_PIPE_DENIED");}
    }
}
