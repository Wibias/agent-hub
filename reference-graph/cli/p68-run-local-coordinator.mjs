#!/usr/bin/env node
import { createPrivateKey, sign } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createP68DurableCoordinatorStore, startP68LoopbackCoordinator }
  from '../p68-durable-https-coordinator.mjs';

const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const KEYS = ['schema_version','scope','state_directory','repository_sha',
  'owner_public_key_path','owner_public_key_sha256',
  'response_signer_private_key_path','tls_private_key_path','tls_certificate_path'];
const SCOPE = ['mode','default_off','production_route_wiring'];
function fail() { throw new TypeError('P68 local operator BLOCKED'); }
function exact(v,n) {
  return v && typeof v === 'object' && !Array.isArray(v)
    && JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...n].sort());
}
function safeFile(path, max, privateOnly = false) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')
    || path.length > 4096) fail();
  const full = resolve(path);
  try {
    const stat = lstatSync(full);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > max
      || realpathSync(full) !== full) fail();
    // Windows file ACLs must be checked by the host. POSIX private keys
    // require owner-only permissions, otherwise this lab process refuses.
    if (privateOnly && process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail();
    const text = readFileSync(full, 'utf8');
    if (Buffer.byteLength(text) !== stat.size) fail();
    return text;
  } catch { fail(); }
}
export function planP68LocalOperator({
  argv = process.argv.slice(2), env = process.env,
  read = safeFile, clock = () => new Date(),
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== '--manifest'
    || typeof read !== 'function' || typeof clock !== 'function'
    || env?.P68_ALLOW_LOCAL_OPERATOR !== '1'
    || !TOKEN.test(env.P68_LAB_READ_TOKEN ?? '')) fail();
  let conf;
  try { conf = JSON.parse(read(argv[1], 8192)); } catch { fail(); }
  if (!exact(conf,KEYS)
    || conf.schema_version !== 'reference-graph.p68-lab-operator.v1'
    || !exact(conf.scope,SCOPE)
    || conf.scope.mode !== 'isolated-integration-canary'
    || conf.scope.default_off !== true
    || conf.scope.production_route_wiring !== false
    || !SHA40.test(conf.repository_sha)
    || !SHA64.test(conf.owner_public_key_sha256 ?? '')
    || typeof conf.state_directory !== 'string'
    || !isAbsolute(conf.state_directory)) fail();
  const ownerPublicKeyPem = read(conf.owner_public_key_path, 8192);
  const privatePem = read(conf.response_signer_private_key_path, 8192, true);
  const tlsPrivateKey = read(conf.tls_private_key_path, 8192, true);
  const tlsCertificate = read(conf.tls_certificate_path, 8192);
  let signer;
  try {
    signer = createPrivateKey(privatePem);
    if (signer.asymmetricKeyType !== 'ed25519') fail();
  } catch { fail(); }
  return {
    store: createP68DurableCoordinatorStore({
      directory:conf.state_directory,
      repositorySha:conf.repository_sha, ownerPublicKeyPem,
      ownerPublicKeySha256:conf.owner_public_key_sha256, clock,
    }),
    repositorySha:conf.repository_sha,readToken:env.P68_LAB_READ_TOKEN,
    signResponse:bytes=>sign(null,bytes,signer).toString('base64'),
    tls:{key:tlsPrivateKey,cert:tlsCertificate},
    clock,host:'127.0.0.1',port:0,
  };
}
export async function runP68LocalOperator({
  argv = process.argv.slice(2), env = process.env,
  read = safeFile, clock = () => new Date(),stdout = process.stdout,
} = {}) {
  const plan=planP68LocalOperator({argv,env,read,clock});
  const current=plan.store.readPolicy();
  // OFF is acceptable. An unreadable/corrupt policy blocks startup.
  if (!['off','canary'].includes(current.status)) fail();
  const server=await startP68LoopbackCoordinator(plan);
  stdout.write(JSON.stringify({
    schema_version:'reference-graph.p68-local-coordinator-listening.v1',
    endpoint:server.endpoint,
    current_mode:current.status,
    production_graph_activated:false,
    activation_authorized:false,
  })+'\n');
  return server;
}

const isCli=process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const server=await runP68LocalOperator();
    const shutdown=()=>{server.close().catch(()=>{process.exitCode=2;});};
    process.once('SIGINT',shutdown);
    process.once('SIGTERM',shutdown);
  } catch {
    process.stderr.write('P68 local coordinator BLOCKED\n');
    process.exitCode=2;
  }
}
