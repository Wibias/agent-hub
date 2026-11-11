import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import {
  createP67HttpsStateReader, createP67SharedStateVerifier,
} from '../../../reference-graph/p67-server-profile-adapter.mjs';

const [endpoint, caFile, publicKeyFile, keySha, repositorySha, isoNow] = process.argv.slice(2);
const bearer = process.env.P68_TEST_READ_TOKEN;
if (!bearer) throw Error('P68 worker requires test bearer');
const ca = readFileSync(caFile, 'utf8');
const fetchImpl = (url, opts) => new Promise((resolve, reject) => {
  const u = new URL(url);
  const req = httpsRequest({
    hostname:u.hostname, port:u.port, path:u.pathname, method:opts.method,
    headers:opts.headers, ca, rejectUnauthorized:true, servername:'localhost',
  }, response => {
    let body='';
    response.setEncoding('utf8');
    response.on('data',chunk => {body+=chunk;});
    response.on('end',()=>resolve({
      ok:response.statusCode===200,status:response.statusCode,
      text:async()=>body,
    }));
  });
  req.once('error',reject);
  if (opts.signal) {
    if (opts.signal.aborted) req.destroy(Error('aborted'));
    else opts.signal.addEventListener('abort',()=>req.destroy(Error('aborted')),{once:true});
  }
  req.end();
});
const reader = createP67HttpsStateReader({
  endpoint,readToken:bearer,fetchImpl,timeoutMs:1200,
});
const verifier=createP67SharedStateVerifier({
  repositorySha,trustedPublicKeyPem:readFileSync(publicKeyFile,'utf8'),
  trustedPublicKeySha256:keySha,clock:()=>new Date(isoNow),
});
const nonce=randomBytes(16).toString('hex');
const payload=await reader({nonce});
const result=verifier.verify(payload,nonce);
console.log(JSON.stringify({
  status:result.status,generation:result.generation,
  project:result.project_ref,allowed:result.status==='canary',
}));
