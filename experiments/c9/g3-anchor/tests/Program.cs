using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AgentHub.C9.G3;
using AgentHub.C9.G3.Anchor;
using AgentHub.C9.G3.Witness;

const long now=1794430800;
static string Sha(byte[] x)=>Convert.ToHexString(SHA256.HashData(x)).ToLowerInvariant();
using ECDsa rootSigner=ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa issuerA=ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa issuerB=ECDsa.Create(ECCurve.NamedCurves.nistP256);
using ECDsa anchorSigner=ECDsa.Create(ECCurve.NamedCurves.nistP256);
RootKeyPin root=new("test-root",rootSigner.ExportSubjectPublicKeyInfo(),
    Sha(rootSigner.ExportSubjectPublicKeyInfo()));
SignedTrustManifestV1 NewManifest(long revision,ECDsa issuer,string id,string state="active"){
    byte[] pub=issuer.ExportSubjectPublicKeyInfo();
    var unsigned=new SignedTrustManifestV1(1,root.RootKeyId,revision,id,
        Convert.ToBase64String(pub),Sha(pub),state,now-10,now+3600,"");
    byte[] sig=rootSigner.SignData(TrustBootstrap.CanonicalBytes(unsigned),
        HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence);
    return unsigned with {SignatureBase64=Convert.ToBase64String(sig)};
}
AnchorHead Head(SignedTrustManifestV1 manifest)=>new("deployment-1",1,manifest.Revision,
    TrustBootstrap.ManifestSha256(manifest),root.RootKeyId,manifest.IssuerKeyId,
    manifest.IssuerSpkiSha256,manifest.KeyState=="revoked");
AdvanceRequestV1 Next(AnchorHead old,SignedTrustManifestV1 m,string id,string reason)=>
    new(1,old.Scope,id,old.Epoch,old.Revision,old.ManifestSha256,
        Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(m)),reason,"owner-approval-test");
int count=0;
void Check(string label,bool ok){if(!ok)throw new Exception("ANCHOR_TEST_FAIL "+label);count++;Console.WriteLine("PASS "+label);}
var genesis=NewManifest(1,issuerA,"issuer-A");
var rotation=NewManifest(2,issuerB,"issuer-B");
var revocation=NewManifest(3,issuerB,"issuer-B","revoked");
string dir=Path.Combine(Path.GetTempPath(),"c9-g3-anchor-"+Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(dir);
try{
    string file=Path.Combine(dir,"head.journal");
    File.WriteAllBytes(file,AnchorJournal.EncodeGenesisForOfflineProvisioner(Head(genesis)));
    var audit=new TestAudit(Head(genesis));
    using(var journal=new AnchorJournal(file)){
        var engine=new AnchorEngine(journal,audit,root,"anchor-test",anchorSigner);
        var query=new AnchorQueryV1(1,"G3_ANCHOR_READ","deployment-1",new string('b',64));
        var receipt=await engine.GetCurrentAsync(query,now,CancellationToken.None);
        Check("signed fresh head accepted",receipt is not null &&
            WitnessProtocol.VerifyAnchor(JsonSerializer.SerializeToUtf8Bytes(receipt),
            query.Scope,query.ChallengeNonce,"anchor-test",anchorSigner.ExportSubjectPublicKeyInfo(),
            Sha(anchorSigner.ExportSubjectPublicKeyInfo()),now) is {Revision:1});
        Check("bad purpose denied",await engine.GetCurrentAsync(query with {Purpose="G3_TRUST_WRITE"},
            now,CancellationToken.None) is null);
        audit.Available=false;
        Check("audit unavailable means no signature",await engine.GetCurrentAsync(query,now,CancellationToken.None) is null);
        audit.Available=true;
        audit.Head=Head(rotation);
        Check("local old / independent newer denies",await engine.GetCurrentAsync(query,now,CancellationToken.None) is null);
        audit.Head=Head(genesis);
        var incorrect=Next(Head(genesis),rotation,new string('a',32),"rotate") with {ExpectedRevision=0};
        Check("CAS conflict denied",!(await engine.AdvanceHeadAsync(incorrect,now,CancellationToken.None)).Committed);
        SignedTrustManifestV1 forged=rotation with {SignatureBase64=Convert.ToBase64String(RandomNumberGenerator.GetBytes(70))};
        Check("forged root signature denied",!(await engine.AdvanceHeadAsync(
            Next(Head(genesis),forged,new string('c',32),"rotate"),now,CancellationToken.None)).Committed);
        var advanced=await engine.AdvanceHeadAsync(Next(Head(genesis),rotation,new string('d',32),"rotate"),
            now,CancellationToken.None);
        Check("independent CAS then local journal committed",advanced.Committed &&
            audit.CasCalls==1 && journal.Read()==Head(rotation));
        Check("restarted journal retains current head",journal.Read()==Head(rotation));
        Check("new head returns matching signed receipt",(await engine.GetCurrentAsync(query,now,CancellationToken.None))?.Revision==2);
        Check("old CAS replay denied",!(await engine.AdvanceHeadAsync(
            Next(Head(genesis),rotation,new string('d',32),"rotate"),now,CancellationToken.None)).Committed);
        var revoked=await engine.AdvanceHeadAsync(Next(Head(rotation),revocation,new string('e',32),"revoke"),
            now,CancellationToken.None);
        Check("root-signed revocation committed",revoked.Committed && journal.Read().Revoked);
        var forbiddenReuse=NewManifest(4,issuerB,"issuer-B");
        Check("revoked issuer ID and key cannot be reactivated",!(await engine.AdvanceHeadAsync(
            Next(Head(revocation),forbiddenReuse,new string('f',32),"rotate"),now,CancellationToken.None)).Committed);
    }
    using(var reopened=new AnchorJournal(file)){
        Check("journal survives process-style reopen",reopened.Read()==Head(revocation));
        Check("journal preserves revoked tombstones",reopened.ContainsRevokedKey("issuer-B",revocation.IssuerSpkiSha256));
    }
    await File.AppendAllTextAsync(file,"{\"partial\"");
    bool torn=false;try{using var _=new AnchorJournal(file);}catch(InvalidOperationException){torn=true;}
    Check("torn journal tail rejected",torn);
    // Simulate remote commit durable, then local write fails: never sign stale state.
    string crash=Path.Combine(dir,"crash.journal");
    File.WriteAllBytes(crash,AnchorJournal.EncodeGenesisForOfflineProvisioner(Head(genesis)));
    using(var real=new AnchorJournal(crash)){
        var failing=new FailingJournal(real);var remote=new TestAudit(Head(genesis));
        var engine=new AnchorEngine(failing,remote,root,"anchor-test",anchorSigner);
        var result=await engine.AdvanceHeadAsync(Next(Head(genesis),rotation,new string('1',32),"rotate"),
            now,CancellationToken.None);
        Check("external advance plus local failure reports UNKNOWN",result.State=="UNKNOWN_FAIL_CLOSED" &&
            remote.Head==Head(rotation) && real.Read()==Head(genesis));
        Check("uncertain instance refuses GetCurrent",await engine.GetCurrentAsync(
            new AnchorQueryV1(1,"G3_ANCHOR_READ","deployment-1",new string('b',64)),now,CancellationToken.None) is null);
    }
    Console.WriteLine($"C9_G3_ANCHOR_CORE_PASS count={count} AUDIT=SIMULATED PRODUCTION_NO_GO G3_HOLD");
}
finally{Directory.Delete(dir,recursive:true);}

sealed class TestAudit(AnchorHead first):IIndependentAudit{
    public AnchorHead Head {get;set;}=first;
    public bool Available {get;set;}=true;
    public int CasCalls {get;private set;}
    public Task<AnchorHead?> GetCurrentAsync(string scope,CancellationToken ct)=>
        Task.FromResult<AnchorHead?>(Available && Head.Scope==scope?Head:null);
    public Task<bool> CompareAndAnchorAsync(AnchorHead old,AnchorHead next,string id,string signedManifest,CancellationToken ct){
        CasCalls++;
        if(!Available || Head!=old)return Task.FromResult(false);
        Head=next;
        return Task.FromResult(true);
    }
}
sealed class FailingJournal(IAnchorJournal inner):IAnchorJournal{
    public AnchorHead Read()=>inner.Read();
    public bool ContainsRevokedKey(string id,string spki)=>inner.ContainsRevokedKey(id,spki);
    public void Append(AnchorHead old,AnchorHead next,string id)=>throw new IOException("simulated crash");
}
