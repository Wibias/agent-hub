using System.Buffers.Binary;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Text.Json;
using AgentHub.C9.G2;
using AgentHub.C9.G3;
using AgentHub.C9.G345;

if(!OperatingSystem.IsWindows() ||
   Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT")!="github-hosted" ||
   Environment.GetEnvironmentVariable("RUNNER_OS")!="Windows" ||
   Environment.GetEnvironmentVariable("AGENTHUB_G2_REVIEW_ONLY")!="DISPOSABLE_WINDOWS_TEST" ||
   Environment.GetEnvironmentVariable("AGENTHUB_G345_REVIEW_ONLY")!="DISPOSABLE_WINDOWS_TEST")
    throw new InvalidOperationException("G2_NON_EPHEMERAL_RUNNER_DENIED");

int passed=0;
void Check(string label,bool ok){if(!ok)throw new Exception("G2_TEST_FAIL "+label);passed++;Console.WriteLine("PASS "+label);}
string sha(byte[] b)=>Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();

[DllImport("kernel32.dll",EntryPoint="ReadFile",SetLastError=true,ExactSpelling=true)]
[return:MarshalAs(UnmanagedType.Bool)]
static extern bool ReadNative(Microsoft.Win32.SafeHandles.SafePipeHandle pipe,byte[] buffer,uint length,
    out uint count,IntPtr overlapped);

KernelTokenSnapshot process=G2KernelIdentity.SnapshotProcess();
using WindowsIdentity windows=WindowsIdentity.GetCurrent();
Check("kernel process token user equals independent WindowsIdentity",process.UserSid==windows.User?.Value);
Check("real process token is primary with at least one enabled group",process.TokenType==1 &&
    process.EnabledGroupSids.Count>0 && process.RestrictedSidCount>=0);
Check("review runner is NOT approved broker service",!G2KernelIdentity.BrokerIsExpectedService(process));
Check("review starts without a thread impersonation token",G2KernelIdentity.ThreadIsUnimpersonated());

// A disposable real Named Pipe, NOT the frozen AgentHub service's pipe.
// Synchronous ReadFile and ImpersonateNamedPipeClient run on the same OS thread.
void WithOnePipe(byte[] payload,Action<NamedPipeServerStream> serverAction)
{
    string name="c9-g2-review-"+Guid.NewGuid().ToString("N");
    using var server=new NamedPipeServerStream(name,PipeDirection.InOut,1,
        PipeTransmissionMode.Byte,PipeOptions.None);
    Task client=Task.Run(()=>{
        using var c=new NamedPipeClientStream(".",name,PipeDirection.Out,
            PipeOptions.None,TokenImpersonationLevel.Impersonation);
        c.Connect(5000);
        c.Write(payload);
        c.Flush();
    });
    server.WaitForConnection();
    serverAction(server);
    client.GetAwaiter().GetResult();
}
WithOnePipe([0x52],server=>{
    byte[] b=new byte[1];
    Check("native named pipe ReadFile delivered client byte",ReadNative(server.SafePipeHandle,b,1,
        out uint count,IntPtr.Zero) && count==1 && b[0]==0x52);
    KernelTokenSnapshot? client=G2KernelIdentity.SnapshotClientAfterRead(server.SafePipeHandle);
    Check("kernel impersonated pipe client token captured",client is
        {TokenType:2,RestrictedSidCount:>=0,ImpersonationLevel:2});
    Check("pipe client kernel SID matches same-user runner only",client?.UserSid==process.UserSid);
    Check("actual client is NOT required named service identity",!G2KernelIdentity.ClientIsExpectedService(client));
    Check("RevertToSelf removed impersonation token",G2KernelIdentity.ThreadIsUnimpersonated());
});

string temp=Path.Combine(Path.GetTempPath(),"c9-g2-review-"+Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(temp);
try
{
    string journalPath=Path.Combine(temp,"g4.journal");
    File.WriteAllBytes(journalPath,G4NonceJournal.EncodeEmptyForOfflineTestProvisioner());
    using var journal=new G4NonceJournal(journalPath);
    using ECDsa issuer=ECDsa.Create(ECCurve.NamedCurves.nistP256);
    byte[] pub=issuer.ExportSubjectPublicKeyInfo();
    var trust=new TrustedKeySnapshot("issuer-test",pub,sha(pub),false);
    // G2 MUST fail before G3/G5/G4 for the actual non-service runner token.
    // The frame uses a real signed ticket, not synthetic token provenance flags.
    long now=DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    var approval=new ApprovalTicketV2(2,"test-issuer","issuer-test",new string('a',64),
        new string('1',32),new string('2',32),new string('3',32),"replace","target-test",
        new string('4',16),new string('5',32),new string('b',64),new string('c',64),
        FrozenServiceIdentity.BrokerServiceSid,FrozenServiceIdentity.ClientServiceSid,
        now-3,now+120,"");
    approval=approval with {SignatureBase64=Convert.ToBase64String(issuer.SignData(
        OfflineAuthorization.CanonicalBytes(approval),HashAlgorithmName.SHA256,
        DSASignatureFormat.Rfc3279DerSequence))};
    byte[] ticket=JsonSerializer.SerializeToUtf8Bytes(approval);
    byte[] framed=new byte[ticket.Length+4];
    BinaryPrimitives.WriteUInt32LittleEndian(framed.AsSpan(0,4),(uint)ticket.Length);
    ticket.CopyTo(framed.AsSpan(4));
    var intent=new ReviewIntentWithoutTokenClaims(temp,"target.bin",approval.ReleaseSha256,
        approval.RequestId,approval.Operation,approval.TargetId,approval.PayloadSha256);
    var gate=new G2345PipeReview(journal);
    WithOnePipe(framed,server=>{
        G2345PipeVerdict verdict=gate.EvaluateOneRead(server.SafePipeHandle,
            intent,trust,"test-issuer",now);
        Check("real G2 identity mismatch blocks complete G345 chain",verdict is
            {Reason:"G2_SERVICE_TOKEN_DENIED",G2KernelVerified:false,
             G3Verified:false,G5Bound:false,G4Reserved:false,CanExecuteCommit:false});
        Check("denied client impersonation always reverted",G2KernelIdentity.ThreadIsUnimpersonated());
        Check("G4 nonce was not burned by wrong OS identities",journal.Count==0);
    });
    WithOnePipe(framed,server=>{
        G2345PipeVerdict verdict=gate.EvaluateOneRead(server.SafePipeHandle,
            intent,trust,"test-issuer",now);
        Check("same real unapproved client cannot gain review from replay",!verdict.G2KernelVerified &&
            !verdict.G4Reserved && !verdict.CanExecuteCommit && journal.Count==0);
    });
    WithOnePipe([0xFF,0xFF,0xFF,0xFF],server=>{
        G2345PipeVerdict verdict=gate.EvaluateOneRead(server.SafePipeHandle,
            intent,trust,"test-issuer",now);
        Check("oversized pipe frame denied before downstream review",verdict.Reason==
            "G2_PIPE_LENGTH_DENIED" && journal.Count==0);
    });
    Check("no externally supplied G2 boolean flags in new pipe API",
        !typeof(G2345PipeReview).GetMethods().Any(m=>m.GetParameters().Any(p=>
            p.ParameterType==typeof(ReviewObservation))));
    Check("target was never created or modified by G2345",!File.Exists(Path.Combine(temp,"target.bin")));
    Check("G2 review leaves G4 journal unmodified",journal.Count==0);
    Console.WriteLine($"C9_G2_KERNEL_PIPE_REVIEW_PASS count={passed} REAL_TOKENS=OBSERVED SERVICE_IDENTITIES=NOT_PROVISIONED G2345=DENY NO_SCM NO_TARGET_WRITE G2_HOLD PRODUCTION_NO_GO");
}
finally {Directory.Delete(temp,true);Console.WriteLine("C9_G2_DISPOSABLE_CLEANUP_PASS");}
