import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { createConnection } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.RUNNER_OS !== 'Windows' || !process.env.RUNNER_TEMP
    || process.argv.length !== 3 || !['--seed','--verify'].includes(process.argv[2]))
  throw new Error('Disposable Windows CI fixture only');
const root = join(process.env.ProgramData, 'AgentHubMemoryReviewLab-State');
const snapshot = join(root, 'operator-evidence-snapshot.sqlite3');
const manifest = JSON.parse(readFileSync(join(root,'operator-evidence-manifest.json'),'utf8'));
const scope = {projectId:'github.com/example/operator-evidence',branch:'main',
  proposalRef:'E~'+createHash('sha256').update('actual-canonical-evidence-proposal-id').digest('hex').slice(0,10)};
for (const [key,value] of Object.entries(scope)) assert.equal(manifest[key],value);
assert.equal(manifest.decision,'confirm');
const hash = value => createHash('sha256').update(value).digest('hex');
if (process.argv[2] === '--seed') {
  // Only the fresh synthetic CI copy after ordinary empty-scope export.
  // This is NOT a production export route.
  assert.equal(existsSync(join(root,'review-authority.sqlite3')),false);
  assert.equal(existsSync(join(root,'operator-webauthn-credential.json')),false);
  const db = new DatabaseSync(snapshot);
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM claims').get().n,0);
    const fact = db.prepare('SELECT canonical_fact FROM memory_evidence_proposals').get().canonical_fact;
    const insert = db.prepare('INSERT INTO claims (id,project_id,branch_scope,state,value_text) VALUES (?,?,?,?,?)');
    db.exec('BEGIN');
    insert.run('a',scope.projectId,scope.branch,'active','Existing synthetic fact');
    insert.run('b',scope.projectId,scope.branch,'active',fact);
    insert.run('c',scope.projectId,'feature','active','Foreign branch');
    insert.run('d','github.com/example/foreign',scope.branch,'active','Foreign project');
    insert.run('e',scope.projectId,scope.branch,'superseded','Inactive fact');
    db.exec('COMMIT');
  } finally {db.close();}
  console.log('PASS synthetic comparison fixture prepared; no authority');
} else {
  const prefix = '\\\\.\\pipe\\AgentHubMemoryReviewLab-';
  const protocol = 'agenthub-operator-uv-service-v1';
  const pin = createPublicKey(readFileSync(join(process.env.ProgramData,
    'AgentHubMemoryReviewLab-Public','review-service-signing-key.pub.pem')));
  assert.equal(pin.asymmetricKeyDetails.namedCurve,'prime256v1');
  function requestOnce(suffix, payload) {
    return new Promise((resolve,reject) => {
      const client = createConnection(prefix+suffix);
      let data = '', settled = false, connected = false;
      const done = (error,result) => {
        if(settled)return;
        settled=true;client.destroy();error?reject(error):resolve(result);
      };
      client.setTimeout(4000,()=>done(new Error('pipe timeout')));
      client.on('connect',()=>{connected=true;client.write(JSON.stringify(payload)+'\n');});
      client.on('data',chunk=>{
        data+=chunk.toString('utf8');
        if(data.length>16384)return done(new Error('response too large'));
        if(data.includes('\n'))done(null,data.split('\n')[0]);
      });
      client.on('end',()=>done(null,data||null));
      client.on('error',error=>{error.beforeConnect=!connected;done(error);});
    });
  }
  async function request(suffix, payload) {
    // The single-instance operator pipe is disposed/recreated after each
    // request. Windows can report ENOENT/EBUSY in that interval. Retry only
    // before connection, never after sending a request, on the expected pipe.
    const deadline=performance.now()+2500;
    for (;;) {
      try {return await requestOnce(suffix,payload);}
      catch(error) {
        if(suffix!=='OperatorV1'||!error.beforeConnect
            ||!['ENOENT','EBUSY'].includes(error.code)||performance.now()>=deadline)
          throw error;
        await delay(40);
      }
    }
  }
  async function inspect() {
    const nonce=randomBytes(32).toString('base64url');
    const envelope=JSON.parse(await request('OperatorV1',{protocol,op:'comparison_inspect',nonce,...scope}));
    assert.equal(envelope.protocol,protocol);
    const bytes=Buffer.from(envelope.payload_b64,'base64');
    assert.ok(bytes.length<=12000);
    assert.equal(verify('sha256',bytes,pin,Buffer.from(envelope.signature_b64,'base64')),true);
    const result=JSON.parse(bytes.toString('utf8'));
    assert.equal(result.nonce,nonce);assert.equal(result.op,'comparison_inspect');
    assert.equal(result.status,'operator_comparison_preview_no_approval');
    assert.equal(result.service_signed,true);
    assert.equal(result.human_approval_verified,false);assert.equal(result.claim_written,false);
    for(const [key,value] of Object.entries(scope))assert.equal(result.meaning[key],value);
    assert.equal(result.meaning.revisionSha,manifest.revisionSha);
    assert.equal(result.total,2);assert.equal(result.claims.length,2);
    assert.equal(result.claims[0].value,'Existing synthetic fact');
    assert.equal(result.claims[1].value,result.meaning.canonicalFact);
    assert.equal(result.claims[1].exact_duplicate,true);
    for(const row of result.claims)assert.equal(hash(row.value),row.value_sha256);
    assert.match(result.comparison_sha256,/^[0-9a-f]{64}$/);
    return result.meaning.reviewSnapshotSha256;
  }
  const before=await inspect();
  console.log("PASS initial signed comparison");
  for(const op of ['begin','complete','enroll_begin','enroll_key','enroll_finish',
    'reaffirm_begin','reaffirm_complete','publish_begin','publish_complete',
    'read_begin','read_complete','ci_read_begin','ci_read_complete','ci_read_revoke']) {
    const base={protocol,op,nonce:randomBytes(32).toString('base64url')};
    // Exercise the actual operation shapes, not only malformed requests.
    const dummy='A'.repeat(43);
    const assertion={credentialId:dummy,type:'public-key',clientDataJSON:dummy,authenticatorData:dummy,signature:dummy};
    const fields=op==='ci_read_revoke'?{}:op==='enroll_key'
      ?{ticketId:dummy,clientDataJSON:dummy,authenticatorData:dummy,credentialId:dummy}
      :op.endsWith('_complete')||op==='complete'||op==='enroll_finish'
        ?{ticketId:dummy,assertion}:scope;
    assert.equal(await request('OperatorV1',{...base,...fields}),null,op);
  }
  assert.equal(await request('OperatorV1',{protocol,op:'comparison_inspect',nonce:randomBytes(32).toString('base64url'),...scope,branch:'foreign'}),null);
  assert.equal(await request('OperatorV1',{protocol,op:'comparison_inspect',nonce:randomBytes(32).toString('base64url'),...scope,decision:'confirm'}),null);
  console.log('PASS operation and scope denials');
  for(const suffix of ['ReadV1','DirectReadCiV1','UserReadCiV1','ReadOnceCiV1']) {
    await assert.rejects(request(suffix,{}),error=>error.code==='ENOENT',suffix);
  }
  assert.equal(await inspect(),before);
  console.log('PASS absent read pipes and unchanged comparison');
  // Change only a disposable pinned CI copy. A live preview must refuse
  // a different snapshot, even though the service remains running.
  const changed=new DatabaseSync(snapshot);
  try {changed.prepare("UPDATE claims SET value_text=? WHERE id='a'").run('Changed synthetic fact');}
  finally {changed.close();}
  assert.equal(await request('OperatorV1',{protocol,op:'comparison_inspect',nonce:randomBytes(32).toString('base64url'),...scope}),null);
  console.log('PASS changed snapshot denied');
  const ledger=new DatabaseSync(join(root,'review-authority.sqlite3'),{readOnly:true});
  try {
    const tables=ledger.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    assert.ok(tables.some(row=>row.name==='review_requests'));
    for(const {name} of tables) {
      assert.match(name,/^[a-z_]+$/);
      assert.equal(ledger.prepare('SELECT COUNT(*) AS n FROM "'+name+'"').get().n,0,name);
    }
  } finally {ledger.close();}
  const source=new DatabaseSync(snapshot,{readOnly:true});
  try {
    assert.equal(source.prepare('SELECT COUNT(*) AS n FROM claims').get().n,5);
    assert.equal(source.prepare('SELECT status FROM memory_evidence_proposals').get().status,'pending');
  } finally {source.close();}
  console.log('PASS signed SCM comparison, denied operations, absent read pipes, empty ledger');
}
