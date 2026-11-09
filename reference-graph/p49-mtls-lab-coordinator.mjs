import { createHash, timingSafeEqual, X509Certificate } from 'node:crypto';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { checkServerIdentity } from 'node:tls';

const MAX_RESPONSE_BYTES = 16000;
const SHA256 = /^[a-f0-9]{64}$/;
const HOST = '127.0.0.1';

function thumbprint(raw) {
  return createHash('sha256').update(raw).digest();
}
function validPem(value) {
  return typeof value === 'string' && value.length > 100
    && value.length < 16000;
}
function pinnedPeer(socket, pinnedClientSha256) {
  if (!socket?.authorized) return false;
  const peer = socket.getPeerCertificate(true);
  if (!Buffer.isBuffer(peer?.raw)) return false;
  return timingSafeEqual(thumbprint(peer.raw),
    Buffer.from(pinnedClientSha256, 'hex'));
}
function respond(res, code, body, json = false) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.writeHead(code, {
    'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    Connection: 'close',
  });
  res.end(body);
}

/**
 * An mTLS test-only server. The server has a TLS private transport key but
 * NOT the Ed25519 LAB state signing key or any production secrets.
 *
 * host=0.0.0.0 is allowed only by explicit isolated-container intent;
 * the caller MUST place it in a Docker internal network with no host ports.
 */
export async function startP49MtlsLabCoordinator({
  store, tls, clientCertSha256, host = HOST, port = 0,
  isolatedContainerNetwork = false,
} = {}) {
  if (typeof store?.readSignedState !== 'function'
    || !tls || !validPem(tls.key) || !validPem(tls.cert) || !validPem(tls.ca)
    || !SHA256.test(clientCertSha256 ?? '')
    || !Number.isInteger(port) || port < 0 || port > 65535
    || !(host === HOST || (host === '0.0.0.0' && isolatedContainerNetwork === true))) {
    throw new TypeError('P49 requires a signed LAB reader and scoped mTLS transport');
  }
  const server = createHttpsServer({
    key: tls.key, cert: tls.cert, ca: tls.ca,
    requestCert: true, rejectUnauthorized: true,
    minVersion: 'TLSv1.3',
  }, (req, res) => {
    // No URLs, cert fields or private keys are logged.
    if (req.url !== '/state') return respond(res, 404, 'not-found');
    if (req.method !== 'GET') return respond(res, 405, 'read-only');
    if (!pinnedPeer(req.socket, clientCertSha256)) return respond(res, 403, 'forbidden');
    if (req.headers['transfer-encoding'] !== undefined
      || (req.headers['content-length'] !== undefined
        && req.headers['content-length'] !== '0')) {
      return respond(res, 400, 'body-disallowed');
    }
    try {
      const envelope = store.readSignedState();
      const body = JSON.stringify(envelope);
      if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
        throw new Error('invalid state');
      }
      respond(res, 200, body, true);
    } catch {
      respond(res, 503, '{"blocked":true}', true);
    }
  });
  server.headersTimeout = 2000;
  server.requestTimeout = 2000;
  server.keepAliveTimeout = 100;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host, port, exclusive: true }, resolve);
    });
  } catch {
    try { server.close(); } catch { /* never report details */ }
    throw new Error('P49 lab TLS listener BLOCKED');
  }
  const address = server.address();
  if (!address || address.address !== host) {
    server.close();
    throw new Error('P49 unexpected listener address');
  }
  let closed = false;
  return Object.freeze({
    schema_version: 'reference-graph.p49-mtls-lab-coordinator.v1',
    host, port: address.port,
    activation_authorized: false,
    repository_default_graph_enabled: false,
    production_coordinator_deployed: false,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise(resolve => server.close(resolve));
    },
  });
}

/**
 * Authenticated HTTPS read, explicitly pins the server's leaf certificate,
 * validates the SAN/host identity, and uses a client certificate and private
 * transport key. For P46 workers; does not itself authorize graph routing.
 */
export async function readP49MtlsSignedState({
  host = HOST, port, servername,
  ca, clientCert, clientKey, serverCertSha256,
  signal, timeoutMs = 1000,
} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535
    || typeof host !== 'string' || !/^[A-Za-z0-9.-]{1,255}$/.test(host)
    || typeof servername !== 'string' || !/^[a-zA-Z0-9.-]{1,255}$/.test(servername)
    || !validPem(ca) || !validPem(clientCert) || !validPem(clientKey)
    || !SHA256.test(serverCertSha256 ?? '')
    || !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 5000
    || (signal !== undefined && !(signal instanceof AbortSignal))
    || signal?.aborted) throw new Error('P49 mTLS state BLOCKED');
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('P49 mTLS state BLOCKED'));
    const req = httpsRequest({
      hostname: host, port, path: '/state', method: 'GET',
      ca, cert: clientCert, key: clientKey,
      servername, rejectUnauthorized: true, minVersion: 'TLSv1.3',
      agent: false, signal, timeout: timeoutMs,
      headers: { 'Cache-Control': 'no-store', Connection: 'close' },
      checkServerIdentity(name, cert) {
        const error = checkServerIdentity(name, cert);
        if (error) return error;
        if (!Buffer.isBuffer(cert?.raw)
          || !timingSafeEqual(thumbprint(cert.raw), Buffer.from(serverCertSha256, 'hex'))) {
          return new Error('P49 server certificate pin mismatch');
        }
        return undefined;
      },
    }, response => {
      let length = 0, body = '';
      if (response.statusCode !== 200) {
        response.resume();
        fail();
        return;
      }
      response.setEncoding('utf8');
      response.on('data', part => {
        length += Buffer.byteLength(part);
        if (length > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('P49 excessive response'));
          return;
        }
        body += part;
      });
      response.on('end', () => {
        try {
          if (length <= 0 || length > MAX_RESPONSE_BYTES) throw new Error('invalid body');
          const parsed = JSON.parse(body);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('invalid envelope');
          }
          resolve(parsed);
        } catch { fail(); }
      });
      response.on('error', fail);
    });
    req.once('timeout', () => req.destroy(new Error('P49 deadline exceeded')));
    req.once('error', fail);
    req.end();
  });
}
