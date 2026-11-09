import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const SCHEMA = 'reference-graph.p48-local-authenticated-coordinator.v1';
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const HOST = '127.0.0.1';
const MAX_ENVELOPE_BYTES = 16000;

function safeHeaders(response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'none'");
  response.setHeader('Referrer-Policy', 'no-referrer');
}
function respond(response, status, body, json = false) {
  safeHeaders(response);
  response.writeHead(status, {
    'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    Connection: 'close',
  });
  response.end(body);
}
function digest(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}
function authenticated(request, expectedDigest) {
  const raw = request.rawHeaders ?? [];
  let count = 0;
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i].toLowerCase() === 'authorization') count++;
  }
  if (count !== 1) return false;
  const value = request.headers.authorization;
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return false;
  const token = value.slice(7);
  return TOKEN.test(token) && timingSafeEqual(digest(token), expectedDigest);
}

/**
 * A read-only, bearer-authenticated LAB coordinator on 127.0.0.1.
 * It has no signer, mutation routes, production credentials or P11 import.
 *
 * Never expose/proxy this cleartext loopback endpoint to other hosts.
 */
export async function startP48AuthenticatedLabCoordinator({
  store, readBearerToken, host = HOST, port = 0,
} = {}) {
  if (host !== HOST || !Number.isInteger(port) || port < 0 || port > 65535
    || typeof readBearerToken !== 'string' || !TOKEN.test(readBearerToken)
    || typeof store?.readSignedState !== 'function') {
    throw new TypeError('P48 requires an isolated loopback and signed-state reader');
  }
  const expected = digest(readBearerToken);
  const server = createServer((request, response) => {
    if (request.url !== '/state') {
      respond(response, 404, 'not-found');
      return;
    }
    if (request.method !== 'GET') {
      respond(response, 405, 'read-only');
      return;
    }
    if (!authenticated(request, expected)) {
      respond(response, 403, 'forbidden');
      return;
    }
    if (request.headers['content-length'] !== undefined
      || request.headers['transfer-encoding'] !== undefined) {
      respond(response, 400, 'invalid-request');
      return;
    }
    try {
      // Every GET re-reads P47 durable OFF state and validates the signature.
      // Never cache an old permit across revocation or coordinator restart.
      const envelope = store.readSignedState();
      const body = JSON.stringify(envelope);
      if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > MAX_ENVELOPE_BYTES) {
        throw new Error('invalid envelope');
      }
      respond(response, 200, body, true);
    } catch {
      respond(response, 503, '{"blocked":true}', true);
    }
  });
  server.headersTimeout = 2000;
  server.requestTimeout = 2000;
  server.keepAliveTimeout = 100;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: HOST, port, exclusive: true }, resolve);
    });
  } catch {
    try { server.close(); } catch { /* binding already failed */ }
    throw new Error('P48 loopback bind failed');
  }
  const address = server.address();
  if (!address || address.address !== HOST) {
    server.close();
    throw new Error('P48 non-loopback binding refused');
  }
  let closed = false;
  return Object.freeze({
    schema_version: SCHEMA,
    endpoint: 'http://' + HOST + ':' + address.port + '/state',
    host: HOST,
    production_coordinator_deployed: false,
    activation_authorized: false,
    repository_default_graph_enabled: false,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise(resolve => server.close(resolve));
    },
  });
}
