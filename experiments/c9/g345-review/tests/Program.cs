using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using AgentHub.C9.G3;
using AgentHub.C9.G5;
using AgentHub.C9.G345;
using Microsoft.Win32.SafeHandles;

if (!OperatingSystem.IsWindows() ||
    Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
    Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows" ||
    Environment.GetEnvironmentVariable("AGENTHUB_G345_REVIEW_ONLY") != "DISPOSABLE_WINDOWS_TEST")
    throw new InvalidOperationException("G345_TEST_RUNNER_NOT_ISOLATED");

static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
static string HexId(int n) => n.ToString("x32", CultureInfo.InvariantCulture);
static ApprovedFilePin IndependentNativePin(string file)
{
    using SafeFileHandle handle = File.OpenHandle(file, FileMode.Open, FileAccess.Read, FileShare.Read);
    IntPtr ptr = Marshal.AllocHGlobal(24);
    try
    {
        if (!NativeTest.QueryFileId(handle, 18, ptr, 24)) throw new IOException("FILEID_PROOF_UNAVAILABLE");
        ulong volume = unchecked((ulong)Marshal.ReadInt64(ptr));
        byte[] id = new byte[16];
        Marshal.Copy(IntPtr.Add(ptr,8),id,0,16);
        return new ApprovedFilePin(volume.ToString("x16",CultureInfo.InvariantCulture),
            Convert.ToHexString(id).ToLowerInvariant(), Sha(File.ReadAllBytes(file)));
    }
    finally { Marshal.FreeHGlobal(ptr); }
}

int passed=0;
void Check(string title, bool condition)
{
    if (!condition) throw new Exception("G345_TEST_FAIL " + title);
    passed++;
    Console.WriteLine("PASS " + title);
}

using ECDsa issuer = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa outsider = ECDsa.Create(ECCurve.NamedCurves.nistP256);
byte[] spki=issuer.ExportSubjectPublicKeyInfo();
TrustedKeySnapshot trust=new("issuer-test",spki,Sha(spki),false);
long now=DateTimeOffset.UtcNow.ToUnixTimeSeconds();
string temp=Path.Combine(Path.GetTempPath(),"c9-g345-"+Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(temp);
try
{
    string target=Path.Combine(temp,"target.bin");
    File.WriteAllBytes(target,[0x01,0x18,0x2a,0x3c,0x5e,0x77,0x99]);
    ApprovedFilePin pin=IndependentNativePin(target);
    ReviewObservation obs=new(temp,"target.bin",new string('a',64),HexId(100),
        "replace", "target-test",new string('b',64),"S-1-5-80-1234567",
        "S-1-5-80-7654321",true,true,true);
    ApprovalTicketV2 Ticket(int ticketNo,int requestNo,int nonceNo,ApprovedFilePin targetPin) =>
        new(2,"test-issuer","issuer-test",obs.ReleaseSha256,HexId(ticketNo),HexId(requestNo),
            HexId(nonceNo),obs.Operation,obs.TargetId,targetPin.VolumeId,targetPin.FileId,
            obs.PayloadSha256,targetPin.PreimageSha256,obs.BrokerServiceSid,obs.ClientServiceSid,
            now-3,now+240,"");
    byte[] Signed(ApprovalTicketV2 ticket, ECDsa? key=null)
    {
        key ??= issuer;
        var signed=ticket with {SignatureBase64=Convert.ToBase64String(key.SignData(
            OfflineAuthorization.CanonicalBytes(ticket),HashAlgorithmName.SHA256,
            DSASignatureFormat.Rfc3279DerSequence))};
        return JsonSerializer.SerializeToUtf8Bytes(signed);
    }
    static ReviewObservation Request(ReviewObservation o, int n) => o with {RequestId=HexId(n)};

    string ledgerPath=Path.Combine(temp,"g4-replay.journal");
    Check("missing journal refuses to initialize", !File.Exists(ledgerPath));
    File.WriteAllBytes(ledgerPath,G4NonceJournal.EncodeEmptyForOfflineTestProvisioner());
    using(var ledger=new G4NonceJournal(ledgerPath))
    {
        var gate=new ReviewGate(ledger);
        byte[] baseline=Signed(Ticket(1,100,500,pin));
        ReviewDecision ok=gate.Evaluate(baseline,obs,trust,"test-issuer",now);
        Check("G3 G5 G4 verified and consumed with no commit",ok is
            {G3Verified:true,G5Bound:true,G4Reserved:true,CanExecuteCommit:false});
        Check("target bytes unchanged",Sha(File.ReadAllBytes(target))==pin.PreimageSha256);
        Check("journal persisted first reservation",ledger.Count==1);
        byte[] concurrentTicket=Signed(Ticket(12,112,512,pin));
        int accepted=0;
        Parallel.For(0,8,_=>{
            ReviewDecision result=gate.Evaluate(concurrentTicket,Request(obs,112),trust,"test-issuer",now);
            if(result.G4Reserved)Interlocked.Increment(ref accepted);
        });
        Check("concurrent replay has exactly one consumed nonce",accepted==1 && ledger.Count==2);
        Check("exact same ticket replay denied",gate.Evaluate(baseline,obs,trust,"test-issuer",now) is
            {G4Reserved:false,CanExecuteCommit:false});
        Check("same nonce under fresh signed ticket denied",gate.Evaluate(
            Signed(Ticket(2,101,500,pin)),Request(obs,101),trust,"test-issuer",now) is
            {G3Verified:true,G5Bound:true,G4Reserved:false});
        Check("same request ID with changed nonce denied",gate.Evaluate(
            Signed(Ticket(3,100,502,pin)),obs,trust,"test-issuer",now) is
            {G3Verified:true,G5Bound:true,G4Reserved:false});
        Check("same ticket ID with fresh request and nonce denied",gate.Evaluate(
            Signed(Ticket(1,103,503,pin)),Request(obs,103),trust,"test-issuer",now) is
            {G3Verified:true,G5Bound:true,G4Reserved:false});
        Check("wrong issuer cannot consume nonce",gate.Evaluate(
            Signed(Ticket(4,104,504,pin)),Request(obs,104),trust,"wrong",now) is
            {G3Verified:false,G4Reserved:false});
        Check("forged signature cannot consume nonce",gate.Evaluate(
            Signed(Ticket(5,105,505,pin),outsider),Request(obs,105),trust,"test-issuer",now) is
            {G3Verified:false,G4Reserved:false});
        Check("false token flags deny before reservation",gate.Evaluate(
            Signed(Ticket(6,106,506,pin)),Request(obs,106) with {ClientTokenChecked=false},
            trust,"test-issuer",now) is {G3Verified:false,G4Reserved:false});
        Check("expired approval denies before reservation",gate.Evaluate(
            Signed(Ticket(7,107,507,pin)),Request(obs,107),trust,"test-issuer",now+400) is
            {G3Verified:false,G4Reserved:false});
        Check("signature valid but wrong preimage denied by native handle",gate.Evaluate(
            Signed(Ticket(8,108,508,pin with {PreimageSha256=new string('e',64)})),
            Request(obs,108),trust,"test-issuer",now) is {G3Verified:true,G5Bound:false,G4Reserved:false});
        Check("signature valid but wrong file ID denied by native handle",gate.Evaluate(
            Signed(Ticket(9,109,509,pin with {FileId=new string('e',32)})),
            Request(obs,109),trust,"test-issuer",now) is {G3Verified:true,G5Bound:false,G4Reserved:false});
        Check("bad path denied before reservation",gate.Evaluate(
            Signed(Ticket(10,110,510,pin)),Request(obs,110) with {RelativePath="..\\target.bin"},
            trust,"test-issuer",now) is {G3Verified:true,G5Bound:false,G4Reserved:false});
        Check("unavailable token proof does not burn nonce",ledger.Count==2);
        bool exclusive=false;
        try {using var second=new G4NonceJournal(ledgerPath);}
        catch(IOException){exclusive=true;}
        Check("second process style exclusive open denied",exclusive);
        Check("malformed ticket cannot consume nonce",gate.Evaluate([1,2,3],obs,trust,"test-issuer",now) is
            {G3Verified:false,G4Reserved:false});
        Check("reservation ledger unchanged after all rejects",ledger.Count==2);

        // Same file bytes but new native FileId: a valid signature is not enough.
        string old=Path.Combine(temp,"moved-away.bin");
        File.Move(target,old);
        File.WriteAllBytes(target,[0x01,0x18,0x2a,0x3c,0x5e,0x77,0x99]);
        Check("native file replacement has different identity",IndependentNativePin(target).FileId!=pin.FileId);
        Check("same-content target swap denied before G4",gate.Evaluate(
            Signed(Ticket(11,111,511,pin)),Request(obs,111),trust,"test-issuer",now) is
            {G3Verified:true,G5Bound:false,G4Reserved:false});
        File.Delete(target);
        File.Move(old,target);
        Check("original verified file identity restored",IndependentNativePin(target).FileId==pin.FileId);
    }
    using(var reopened=new G4NonceJournal(ledgerPath))
    {
        var gate=new ReviewGate(reopened);
        Check("G4 consumption remains after process style restart",reopened.Count==2);
        Check("restart refuses the exact replay",gate.Evaluate(
            Signed(Ticket(1,100,500,pin)),obs,trust,"test-issuer",now) is
            {G3Verified:true,G5Bound:true,G4Reserved:false,CanExecuteCommit:false});
    }

    string broken=Path.Combine(temp,"broken.journal");
    File.Copy(ledgerPath,broken);
    File.AppendAllText(broken,"{\"partial\"");
    bool torn=false;
    try {using var ignored=new G4NonceJournal(broken);}
    catch(Exception ex) when(ex is InvalidOperationException or JsonException){torn=true;}
    Check("torn persisted journal rejects startup",torn);
    string tampered=Path.Combine(temp,"tampered.journal");
    File.Copy(ledgerPath,tampered);
    string raw=File.ReadAllText(tampered);
    File.WriteAllText(tampered,raw.Replace("\"Nonce\":\"", "\"Nonce\":\"f",StringComparison.Ordinal));
    bool corrupt=false;
    try {using var ignored=new G4NonceJournal(tampered);}
    catch(Exception ex) when(ex is InvalidOperationException or JsonException){corrupt=true;}
    Check("changed nonce without valid entry hash denies startup",corrupt);
    Console.WriteLine($"C9_G345_NATIVE_INTEGRATION_PASS count={passed} G4=LOCAL_ONLY G2=SIMULATED NO_TARGET_WRITES NO_COMMIT G3_G4_G5_HOLD PRODUCTION_NO_GO");
}
finally
{
    Directory.Delete(temp,recursive:true);
    Console.WriteLine("C9_G345_DISPOSABLE_CLEANUP_PASS");
}

internal static class NativeTest
{
    [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandleEx",SetLastError=true,ExactSpelling=true)]
    internal static extern bool QueryFileId(SafeFileHandle handle,int infoClass,IntPtr result,uint length);
}
