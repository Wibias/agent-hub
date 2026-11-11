import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync,
  readdirSync, realpathSync, writeSync } from 'node:fs';
import { createServer } from 'node:https';
import { isAbsolute, join, resolve } from 'node:path';

const PROJECT = 'vrznfnxzlxaavpqbzbzd';
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/;
const FILE = 'p68-owner-approved-canary.json';
const OFF = 'p68-permanent-off-intent';
const OWNER_KEYS = [
  'schema_version', 'repository_sha', 'project_ref', 'mode', 'profiles',
  'canary_percent', 'cohort_salt', 'generation', 'issued_at', 'expires_at',
  'default_off', 'production_route_wiring',
];
const RESP_KEYS = [
  'schema_version', 'repository_sha', 'project_ref', 'nonce', 'generation',
  'status', 'profiles', 'canary_percent', 'cohort_salt', 'issued_at', 'expires_at',
];

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function blocked() { throw new Error('P68 coordinator state BLOCKED'); }
function directoryOf(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) blocked();
  const full = resolve(path);
  let stat;
  try {
    stat = lstatSync(full);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(full) !== full) blocked();
  } catch { blocked(); }
  return full;
}
function readApproved(root) {
  const path = join(root, FILE);
  if (!existsSync(path)) return null;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 8192) blocked();
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch { blocked(); }
}
function hasOff(root) {
  try {
    lstatSync(join(root, OFF));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    return true;
  }
}
function writeExclusive(root, name, data) {
  let fd;
  try {
    fd = openSync(join(root, name), 'wx', 0o600);
    writeSync(fd, data, null, 'utf8');
    fsyncSync(fd);
  } catch { blocked(); }
  finally { if (fd !== undefined) closeSync(fd); }
  let dir;
  try {
    dir = openSync(root, 'r');
    fsyncSync(dir);
  } catch { blocked(); }
  finally { if (dir !== undefined) closeSync(dir); }
}

/**
 * One-owner-grant, then OFF-only durable coordinator store.
 * No key is generated or stored. The caller supplies the already pinned
 * independent OWNER verification key. A signed canary is lab-scoped only.
 */
export function createP68DurableCoordinatorStore({
  directory, repositorySha, ownerPublicKeyPem, ownerPublicKeySha256,
  clock = () => new Date(),
} = {}) {
  if (!HEX40.test(repositorySha ?? '') || !HEX64.test(ownerPublicKeySha256 ?? '')
    || typeof clock !== 'function') throw new TypeError('P68 owner trust missing');
  let key;
  try {
    key = createPublicKey(ownerPublicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519'
      || createHash('sha256').update(key.export({ type: 'spki', format: 'der' }))
        .digest('hex') !== ownerPublicKeySha256) blocked();
  } catch { throw new TypeError('P68 owner key rejected'); }
  function verifyGrant(envelope) {
    if (!exact(envelope, ['payload_json', 'signature_base64'])
      || typeof envelope.payload_json !== 'string'
      || Buffer.byteLength(envelope.payload_json) > 4096
      || !SIGNATURE.test(envelope.signature_base64 ?? '')) blocked();
    const sig = Buffer.from(envelope.signature_base64, 'base64');
    if (sig.length !== 64 || sig.toString('base64') !== envelope.signature_base64
      || !verify(null, Buffer.from(envelope.payload_json), key, sig)) blocked();
    let grant;
    try { grant = JSON.parse(envelope.payload_json); } catch { blocked(); }
    if (!exact(grant, OWNER_KEYS)
      || grant.schema_version !== 'reference-graph.p68-owner-canary-grant.v1'
      || grant.repository_sha !== repositorySha || grant.project_ref !== PROJECT
      || grant.mode !== 'isolated-integration-canary'
      || grant.default_off !== true || grant.production_route_wiring !== false
      || !Array.isArray(grant.profiles) || grant.profiles.length < 1
      || grant.profiles.length > 2 || new Set(grant.profiles).size !== grant.profiles.length
      || grant.profiles.some(profile => !['standard', 'deep'].includes(profile))
      || !Number.isInteger(grant.canary_percent) || grant.canary_percent < 1
      || grant.canary_percent > 5 || !HEX32.test(grant.cohort_salt ?? '')
      || !Number.isSafeInteger(grant.generation) || grant.generation < 1
      || typeof grant.issued_at !== 'string' || typeof grant.expires_at !== 'string') blocked();
    const start = Date.parse(grant.issued_at), end = Date.parse(grant.expires_at);
    if (!Number.isFinite(start) || !Number.isFinite(end)
      || new Date(start).toISOString() !== grant.issued_at
      || new Date(end).toISOString() !== grant.expires_at
      || end <= start || end - start > 600_000) blocked();
    return grant;
  }
  return Object.freeze({
    seedSignedLabCanary(envelope) {
      const root = directoryOf(directory);
      if (hasOff(root) || readdirSync(root).length !== 0) blocked();
      const grant = verifyGrant(envelope);
      const now = clock().valueOf();
      if (!Number.isFinite(now) || now < Date.parse(grant.issued_at) - 500
        || now >= Date.parse(grant.expires_at)) blocked();
      writeExclusive(root, FILE, JSON.stringify(envelope));
      if (hasOff(root)) blocked();
      return { seeded: true, production_graph_activated: false };
    },
    revokePermanently() {
      const root = directoryOf(directory);
      if (!hasOff(root)) writeExclusive(root, OFF, 'OFF\n');
      return { revoked: true, production_graph_activated: false };
    },
    readPolicy() {
      const root = directoryOf(directory);
      // OFF marker wins even if the permit is unreadable or not yet written.
      if (hasOff(root)) {
        let generation = 2;
        try {
          const env = readApproved(root);
          if (env) generation = verifyGrant(env).generation + 1;
        } catch { /* OFF is still authoritative */ }
        return { status: 'off', generation, profiles: [], canary_percent: 0,
          cohort_salt: '0'.repeat(32) };
      }
      const env = readApproved(root);
      if (!env) return { status: 'off', generation: 1,
        profiles: [], canary_percent: 0, cohort_salt: '0'.repeat(32) };
      const grant = verifyGrant(env);
      const now = clock().valueOf();
      if (!Number.isFinite(now)) blocked();
      const permitted = now >= Date.parse(grant.issued_at) - 500
        && now < Date.parse(grant.expires_at);
      if (hasOff(root) || !permitted) return {
        status: 'off', generation: grant.generation + 1,
        profiles: [], canary_percent: 0, cohort_salt: grant.cohort_salt,
      };
      return { status: 'canary', generation: grant.generation,
        profiles: [...grant.profiles], canary_percent: grant.canary_percent,
        cohort_salt: grant.cohort_salt };
    },
  });
}
function tokenDigest(token) { return createHash('sha256').update(token).digest(); }
function headerCount(req, name) {
  let n = 0;
  for (let i=0;i<(req.rawHeaders?.length ?? 0);i+=2) {
    if (req.rawHeaders[i].toLowerCase() === name) n++;
  }
  return n;
}
function send(res, code, body, json = false) {
  res.writeHead(code, {
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Connection': 'close',
  });
  res.end(body);
}
/**
 * TLS 1.3 loopback-only, read-only P67-compatible coordinator.
 * A separate trusted operator must provision TLS keys, read token and the
 * state RESPONSE signing callback. No signing/release credential is generated.
 * No HTTP mutation/release route exists.
 */
export async function startP68LoopbackCoordinator({
  store, repositorySha, signResponse, readToken, tls, clock = () => new Date(),
  port = 0, host = '127.0.0.1',
} = {}) {
  if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 0 || port > 65535
    || !HEX40.test(repositorySha ?? '') || typeof store?.readPolicy !== 'function'
    || typeof signResponse !== 'function' || !TOKEN.test(readToken ?? '')
    || !tls || typeof tls.key !== 'string' || typeof tls.cert !== 'string'
    || typeof clock !== 'function') throw new TypeError('P68 secure loopback setup required');
  const expectedToken = tokenDigest(readToken);
  const server = createServer({
    key: tls.key, cert: tls.cert, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3',
  }, (req, res) => {
    if (req.url !== '/state') return send(res, 404, 'not-found');
    if (req.method !== 'GET') return send(res, 405, 'read-only');
    const auth = req.headers.authorization;
    if (headerCount(req, 'authorization') !== 1
      || typeof auth !== 'string' || !auth.startsWith('Bearer ')
      || !TOKEN.test(auth.slice(7))
      || !timingSafeEqual(tokenDigest(auth.slice(7)), expectedToken)) {
      return send(res, 403, 'forbidden');
    }
    if ((req.headers['content-length'] !== undefined
        && req.headers['content-length'] !== '0')
      || req.headers['transfer-encoding'] !== undefined
      || headerCount(req, 'x-p67-nonce') !== 1
      || !HEX32.test(req.headers['x-p67-nonce'] ?? '')) {
      return send(res, 400, 'invalid-request');
    }
    try {
      const policy = store.readPolicy();
      const now = clock();
      if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) blocked();
      const payload_json = JSON.stringify({
        schema_version: 'reference-graph.p67-shared-state.v1',
        repository_sha: repositorySha, project_ref: PROJECT,
        nonce: req.headers['x-p67-nonce'], generation: policy.generation,
        status: policy.status, profiles: policy.profiles,
        canary_percent: policy.canary_percent, cohort_salt: policy.cohort_salt,
        issued_at: now.toISOString(),
        expires_at: new Date(now.valueOf() + 3000).toISOString(),
      });
      const signature_base64 = signResponse(Buffer.from(payload_json, 'utf8'));
      if (!SIGNATURE.test(signature_base64 ?? '')
        || Buffer.byteLength(payload_json) > 4096) blocked();
      // Recheck durable state before response. A revoke during signing wins.
      const after = store.readPolicy();
      if (after.generation !== policy.generation || after.status !== policy.status) {
        return send(res, 503, '{"blocked":true}', true);
      }
      const response = JSON.stringify({payload_json,signature_base64});
      if (Buffer.byteLength(response) > 8192) blocked();
      return send(res, 200, response, true);
    } catch {
      return send(res, 503, '{"blocked":true}', true);
    }
  });
  server.headersTimeout = 2000;
  server.requestTimeout = 2000;
  server.keepAliveTimeout = 100;
  try {
    await new Promise((resolve,reject) => {
      server.once('error',reject);
      server.listen({host,port,exclusive:true},resolve);
    });
  } catch {
    try {server.close();} catch {}
    throw Error('P68 secure loopback bind failed');
  }
  const socket = server.address();
  if (socket?.address !== '127.0.0.1') {
    server.close();
    throw Error('P68 refused non-loopback bind');
  }
  let closed = false;
  return Object.freeze({
    endpoint: `https://127.0.0.1:${socket.port}/state`,
    port:socket.port, host,
    production_graph_activated: false,
    production_coordinator_deployed: false,
    close:async()=>{
      if (closed) return;
      closed=true;
      await new Promise(resolve=>server.close(resolve));
    },
  });
}
