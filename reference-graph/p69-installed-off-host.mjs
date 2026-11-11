import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { isAbsolute, resolve } from 'node:path';

const PROJECT = 'vrznfnxzlxaavpqbzbzd';
const HOST_COMMIT = '477282f0eba1a848d06d928c70890fb0add784b8';
const PIN = /^[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const CONFIG_KEYS = [
  'schema_version', 'project_ref', 'coordinator_commit', 'endpoint',
  'server_certificate_path', 'signer_public_key_path',
  'signer_spki_sha256', 'read_token_path',
];
const STATE_KEYS = [
  'schema_version', 'repository_sha', 'project_ref', 'nonce', 'generation',
  'status', 'profiles', 'canary_percent', 'cohort_salt', 'issued_at', 'expires_at',
];
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function safeFile(path, maxBytes) {
  if (typeof path !== 'string' || !isAbsolute(path)
    || path.includes('\0') || path.length > 4096) throw Error('invalid path');
  const full = resolve(path);
  const stat = lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1
    || stat.size > maxBytes || realpathSync(full) !== full) throw Error('invalid file');
  const raw = readFileSync(full);
  if (raw.length !== stat.size) throw Error('changed file');
  return raw.toString('utf8');
}
function readConfig(file) {
  const value = JSON.parse(safeFile(file, 8192));
  if (!exact(value, CONFIG_KEYS)
    || value.schema_version !== 'reference-graph.p69-off-host-binding.v1'
    || value.project_ref !== PROJECT || value.coordinator_commit !== HOST_COMMIT
    || !PIN.test(value.signer_spki_sha256 ?? '')) throw Error('wrong binding');
  const endpoint = new URL(value.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== '127.0.0.1'
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname !== '/state' || !/^\d{1,5}$/.test(endpoint.port)
    || +endpoint.port < 1 || +endpoint.port > 65535) throw Error('non-local host');
  return { value, endpoint };
}
function stateValid(envelope, nonce, signer, now) {
  if (!exact(envelope, ['payload_json','signature_base64'])
    || typeof envelope.payload_json !== 'string'
    || Buffer.byteLength(envelope.payload_json) > 4096
    || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature_base64 ?? '')) return false;
  const signature = Buffer.from(envelope.signature_base64, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== envelope.signature_base64
    || !verify(null, Buffer.from(envelope.payload_json), signer, signature)) return false;
  const state = JSON.parse(envelope.payload_json);
  const issued = Date.parse(state?.issued_at), expires = Date.parse(state?.expires_at);
  return exact(state, STATE_KEYS)
    && state.schema_version === 'reference-graph.p67-shared-state.v1'
    && state.repository_sha === HOST_COMMIT && state.project_ref === PROJECT
    && state.nonce === nonce && Number.isSafeInteger(state.generation)
    && state.generation >= 1 && state.status === 'off'
    && Array.isArray(state.profiles) && state.profiles.length === 0
    && state.canary_percent === 0
    && /^[0-9a-f]{32}$/.test(state.cohort_salt)
    && Number.isFinite(issued) && Number.isFinite(expires)
    && new Date(issued).toISOString() === state.issued_at
    && new Date(expires).toISOString() === state.expires_at
    && issued <= now + 500 && now - issued <= 5000
    && expires > now && expires - issued <= 10000;
}
async function httpsGet(endpoint, ca, token, nonce, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: '127.0.0.1', port: Number(endpoint.port), path: '/state',
      method: 'GET', agent: false, rejectUnauthorized: true,
      ca, servername: 'localhost',
      headers: {
        Authorization: 'Bearer ' + token,
        'X-P67-Nonce': nonce,
        'Cache-Control': 'no-store',
      },
    }, res => {
      if (res.statusCode !== 200) {
        res.resume(); reject(Error('state HTTP rejected')); return;
      }
      const parts = [];
      let bytes = 0;
      res.on('data', part => {
        bytes += part.length;
        if (bytes > 8192) req.destroy(Error('state too large'));
        else parts.push(part);
      });
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); }
        catch { reject(Error('state JSON invalid')); }
      });
      res.on('error', reject);
    });
    req.once('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(Error('state timeout')));
    req.end();
  });
}
/**
 * Read-only bridge from the REAL AgentHub Standard/Deep CLI to the already
 * installed P68 Windows host. This code deliberately accepts ONLY signed OFF.
 *
 * Important: A P68 lab 'canary' response never authorizes production Graph.
 * No P30 service key, Graph fetch, owner permit or activation is used here.
 * Missing/broken coordinator produces Legacy, never a new Graph route.
 */
export async function probeP69InstalledOffHost({
  configPath, clock = () => new Date(), timeoutMs = 1600,
  read = safeFile, transport = httpsGet,
} = {}) {
  try {
    if (typeof configPath !== 'string' || !isAbsolute(configPath)
      || typeof clock !== 'function' || typeof read !== 'function'
      || typeof transport !== 'function' || !Number.isInteger(timeoutMs)
      || timeoutMs < 100 || timeoutMs > 3000) throw Error('P69 config invalid');
    // Do not accept arbitrary environment-provided network hosts or trust pins.
    const { value, endpoint } = readConfig(configPath);
    const ca = read(value.server_certificate_path, 8192);
    const signer = createPublicKey(read(value.signer_public_key_path, 8192));
    if (signer.asymmetricKeyType !== 'ed25519'
      || createHash('sha256').update(signer.export({type:'spki',format:'der'}))
        .digest('hex') !== value.signer_spki_sha256) throw Error('P69 signer pin');
    const token = read(value.read_token_path, 256).trim();
    if (!TOKEN.test(token)) throw Error('P69 token invalid');
    const nonce = randomBytes(16).toString('hex');
    const envelope = await transport(endpoint, ca, token, nonce, timeoutMs);
    if (!stateValid(envelope, nonce, signer, clock().valueOf())) {
      throw Error('P69 unsigned, invalid or non-OFF state');
    }
    return { connected: true, signed_off: true, graph_activation_authorized: false };
  } catch {
    return { connected: false, signed_off: false, graph_activation_authorized: false };
  }
}
