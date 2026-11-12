using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AgentHub.C9.G3;
using AgentHub.C9.G3.Audit;
using AgentHub.C9.G3.Anchor;
using AgentHub.C9.G3.Witness;

const long now=1794430800;
static string Hash(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
using ECDsa rootSigner=ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa issuerA=ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa issuerB=ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa auditSigner=ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa sealSigner=ECDsa.Create(ECCurve.NamedCurves.nistP256);
RootKeyPin root=new("root-test",rootSigner.ExportSubjectPublicKeyInfo(),
    Hash(rootSigner.ExportSubjectPublicKeyInfo()));
SignedTrustManifestV1 MakeManifest(long rev,ECDsa issuer,string id,string state="active"){
    byte[] key=issuer.ExportSubjectPublicKeyInfo();
    var m=new SignedTrustManifestV1(1,root.RootKeyId,rev,id,
        Convert.ToBase64String(key),Hash(key),state,now-10,now+3600,"");
    return m with {SignatureBase64=Convert.ToBase64String(rootSigner.SignData(
        TrustBootstrap.CanonicalBytes(m),HashAlgorithmName.SHA256,
        DSASignatureFormat.Rfc3279DerSequence))};
}
AnchorHead Head(SignedTrustManifestV1 m)=>new("deployment-1",1,m.Revision,
    TrustBootstrap.ManifestSha256(m),root.RootKeyId,m.IssuerKeyId,
    m.IssuerSpkiSha256,m.KeyState=="revoked");
AuditAdvanceWireV1 Advance(AnchorHead old,SignedTrustManifestV1 m,string tx)=>new(1,
    "G3_AUDIT_CAS",new string('b',64),tx,old,Head(m),
    Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(m)));
AnchorQueryV1 Query()=>new(1,"G3_AUDIT_READ","deployment-1",new string('a',64));
int passed=0;
void Check(string title,bool ok){if(!ok)throw new Exception("AUDIT_TEST_FAIL "+title);passed++;Console.WriteLine("PASS "+title);}
var m1=MakeManifest(1,issuerA,"issuer-A");
var m2=MakeManifest(2,issuerB,"issuer-B");
var m3=MakeManifest(3,issuerB,"issuer-B","revoked");
string dir=Path.Combine(Path.GetTempPath(),"c9-g3-audit-"+Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(dir);
try{
    string file=Path.Combine(dir,"audit.journal");
    File.WriteAllBytes(file,AnchorJournal.EncodeGenesisForOfflineProvisioner(Head(m1)));
    var seal=new FakeSeal(Head(m1));
    using(var journal=new AnchorJournal(file)){
        var engine=new AuditEngine(journal,seal,root,"audit-test",auditSigner);
        var query=Query();
        var receipt=await engine.GetCurrentAsync(query,now,CancellationToken.None);
        Check("signed current head matches durable seal",receipt is not null &&
            WitnessProtocol.VerifyAnchor(JsonSerializer.SerializeToUtf8Bytes(receipt),
                query.Scope,query.ChallengeNonce,"audit-test",auditSigner.ExportSubjectPublicKeyInfo(),
                Hash(auditSigner.ExportSubjectPublicKeyInfo()),now) is {Revision:1});
        Check("wrong read purpose denied",await engine.GetCurrentAsync(
            query with {Purpose="G3_BROKER_WRITE"},now,CancellationToken.None) is null);
        seal.Available=false;
        Check("seal unavailable denies read",await engine.GetCurrentAsync(query,now,CancellationToken.None) is null);
        seal.Available=true;
        seal.Head=Head(m2);
        Check("local journal behind seal denies read",await engine.GetCurrentAsync(query,now,CancellationToken.None) is null);
        seal.Head=Head(m1);
        Check("CAS stale expected denies",await engine.CompareAndAnchorAsync(
            Advance(Head(m1),m2,new string('c',32)) with {Expected=Head(m2)},
            now,CancellationToken.None) is null);
        var forged=m2 with {SignatureBase64=Convert.ToBase64String(RandomNumberGenerator.GetBytes(70))};
        Check("forged root manifest denies",await engine.CompareAndAnchorAsync(
            Advance(Head(m1),forged,new string('d',32)),now,CancellationToken.None) is null);
        Check("CAS response nonce malformed denies",await engine.CompareAndAnchorAsync(
            Advance(Head(m1),m2,new string('e',32)) with {ChallengeNonce="invalid"},
            now,CancellationToken.None) is null);
        var committed=await engine.CompareAndAnchorAsync(
            Advance(Head(m1),m2,new string('f',32)),now,CancellationToken.None);
        Check("seal CAS then flushed journal commits",committed is {Revision:2} &&
            journal.Read()==Head(m2) && seal.Head==Head(m2) && seal.CasCalls==1);
        Check("new head signed with response nonce",(await engine.GetCurrentAsync(
            query,now,CancellationToken.None))?.Revision==2);
        Check("old CAS replay denied",await engine.CompareAndAnchorAsync(
            Advance(Head(m1),m2,new string('f',32)),now,CancellationToken.None) is null);
        Check("revocation committed",(await engine.CompareAndAnchorAsync(
            Advance(Head(m2),m3,new string('1',32)),now,CancellationToken.None)) is {Revision:3} &&
            journal.Read().Revoked);
        var m4=MakeManifest(4,issuerB,"issuer-B");
        Check("revoked issuer cannot reactivate",await engine.CompareAndAnchorAsync(
            Advance(Head(m3),m4,new string('2',32)),now,CancellationToken.None) is null);
    }
    using(var reopened=new AnchorJournal(file)){
        Check("journal survives restart with revocation tombstone",
            reopened.Read()==Head(m3) && reopened.ContainsRevokedKey("issuer-B",m3.IssuerSpkiSha256));
    }
    await File.AppendAllTextAsync(file,"{\"partial\"");
    bool torn=false;
    try{using var _=new AnchorJournal(file);}catch(InvalidOperationException){torn=true;}
    Check("torn journal denies startup",torn);

    string crashFile=Path.Combine(dir,"crash.journal");
    File.WriteAllBytes(crashFile,AnchorJournal.EncodeGenesisForOfflineProvisioner(Head(m1)));
    var crashedSeal=new FakeSeal(Head(m1));
    using(var journal=new AnchorJournal(crashFile)){
        var crashed=new AuditEngine(new ThrowingJournal(journal),crashedSeal,root,"audit-test",auditSigner);
        Check("external seal advanced but local journal failure denies",
            await crashed.CompareAndAnchorAsync(Advance(Head(m1),m2,new string('3',32)),
                now,CancellationToken.None) is null && crashedSeal.Head==Head(m2) && journal.Read()==Head(m1));
        Check("uncertain process refuses GetCurrent",await crashed.GetCurrentAsync(Query(),
            now,CancellationToken.None) is null);
    }
    using(var journal=new AnchorJournal(crashFile)){
        var fresh=new AuditEngine(journal,crashedSeal,root,"audit-test",auditSigner);
        Check("restart cannot sign rolled-back local head",await fresh.GetCurrentAsync(
            Query(),now,CancellationToken.None) is null);
    }
    var goodSeal=new SealReceiptV1(1,"seal-test",Head(m2).Scope,1,2,Head(m2).ManifestSha256,
        Head(m2).RootKeyId,Head(m2).IssuerKeyId,Head(m2).IssuerSpkiSha256,false,
        new string('4',64),now,now+15,"");
    var signedSeal=goodSeal with {SignatureBase64=Convert.ToBase64String(sealSigner.SignData(
        SealProtocol.Canonical(goodSeal),HashAlgorithmName.SHA256,
        DSASignatureFormat.Rfc3279DerSequence))};
    AnchorHead? VerifySeal(SealReceiptV1 s,string nonce)=>SealProtocol.Verify(
        JsonSerializer.SerializeToUtf8Bytes(s),"deployment-1",nonce,"seal-test",
        sealSigner.ExportSubjectPublicKeyInfo(),Hash(sealSigner.ExportSubjectPublicKeyInfo()),now);
    Check("signed independent seal fields accepted",VerifySeal(signedSeal,new string('4',64))==Head(m2));
    Check("seal wrong nonce denied",VerifySeal(signedSeal,new string('5',64)) is null);
    Check("seal revoked flag tamper denied",VerifySeal(signedSeal with {Revoked=true},new string('4',64)) is null);
    Check("seal pin swap denied",SealProtocol.Verify(JsonSerializer.SerializeToUtf8Bytes(signedSeal),
        "deployment-1",new string('4',64),"seal-test",sealSigner.ExportSubjectPublicKeyInfo(),
        new string('0',64),now) is null);
    byte[] extra=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(JsonSerializer.SerializeToUtf8Bytes(signedSeal))
        .Replace("\"Version\":1,","\"Version\":1,\"CanExecuteCommit\":true,",StringComparison.Ordinal));
    Check("seal unknown privilege property denied",SealProtocol.Verify(extra,"deployment-1",
        new string('4',64),"seal-test",sealSigner.ExportSubjectPublicKeyInfo(),
        Hash(sealSigner.ExportSubjectPublicKeyInfo()),now) is null);
    byte[] duplicate=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(JsonSerializer.SerializeToUtf8Bytes(signedSeal))
        .Replace("\"Version\":1,","\"Version\":1,\"Version\":1,",StringComparison.Ordinal));
    Check("seal duplicate JSON key denied",SealProtocol.Verify(duplicate,"deployment-1",
        new string('4',64),"seal-test",sealSigner.ExportSubjectPublicKeyInfo(),
        Hash(sealSigner.ExportSubjectPublicKeyInfo()),now) is null);
    Console.WriteLine($"C9_G3_AUDIT_CORE_PASS count={passed} SEAL=SIMULATED NO_DEPLOYMENT G3_HOLD PRODUCTION_NO_GO");
}
finally {Directory.Delete(dir,recursive:true);}

sealed class FakeSeal(AnchorHead initial):IIndependentImmutableSeal{
    public AnchorHead Head {get;set;}=initial;
    public bool Available {get;set;}=true;
    public int CasCalls{get;private set;}
    public Task<AnchorHead?> ReadAsync(string scope,CancellationToken ct)=>
        Task.FromResult<AnchorHead?>(Available && scope==Head.Scope?Head:null);
    public Task<bool> CompareAndSealAsync(AnchorHead old,AnchorHead next,string id,string manifest,CancellationToken ct){
        CasCalls++;
        if(!Available || Head!=old)return Task.FromResult(false);
        Head=next;return Task.FromResult(true);
    }
}
sealed class ThrowingJournal(IAnchorJournal journal):IAnchorJournal{
    public AnchorHead Read()=>journal.Read();
    public bool ContainsRevokedKey(string id,string spki)=>journal.ContainsRevokedKey(id,spki);
    public void Append(AnchorHead old,AnchorHead next,string id)=>throw new IOException("simulated disk crash");
}
