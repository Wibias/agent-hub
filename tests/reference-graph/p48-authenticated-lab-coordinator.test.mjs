import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createP47DurableLabRevocation } from '../../reference-graph/p47-durable-lab-revocation.mjs';
import { startP48AuthenticatedLabCoordinator } from '../../reference-graph/p48-authenticated-lab-coordinator.mjs';

const repoSha = '83a3794cc54d2f2d129b83e8e672e18b35f11cff';
const labId = 'p48-loopback-auth-lab-20261109';
const pair = generateKeyPairSync('ed25519');
const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
const publicKeySha256 = createHash('sha256')
  .update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const scope = {
  mode: 'isolated-shadow-rehearsal', default_off: true,
  production_route_wiring: false, profiles: ['standard', 'deep'],
};
const fixedClock = () => new Date('2026-11-09T19:10:02.000Z');
const fixture = fileURLToPath(new URL('./fixtures/p48-auth-lab-worker.mjs', import.meta.url));
const token = () => randomBytes(32).toString('base64url');

function signed(decision = 'shadow-probe-only', sequence = 1) {
  const payload_json = JSON.stringify({
    schema_version: 'reference-graph.p46-lab-lease.v1',
    repository: 'Wibias/agent-hub',
    repository_sha: repoSha, project_ref: 'vrznfnxzlxaavpqbzbzd',
    lab_id: labId, scope: 'isolated-shadow-rehearsal',
    profiles: ['standard', 'deep'], sequence, decision,
    issued_at: '2026-11-09T19:10:00.000Z',
    expires_at: '2026-11-09T19:10:06.000Z', default_off: true,
  });
  return {
    schema_version: 'reference-graph.p46-signed-lab-envelope.v1',
    payload_json,
    signature_base64: sign(null, Buffer.from(payload_json), pair.privateKey).toString('base64'),
  };
}
function store(dir) {
  return createP47DurableLabRevocation({
    directory: dir, scope, publicKeyPem,
    publicKeySha256, expectedRepositorySha: repoSha,
    expectedLabId: labId, clock: fixedClock,
  });
}
function worker(endpoint, bearer, mode = 'exact') {
  const child = spawn(process.execPath, [
    fixture, endpoint,
    Buffer.from(publicKeyPem, 'utf8').toString('base64url'),
    publicKeySha256, repoSha, labId, mode,
  ], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, P48_LAB_READ_TOKEN: bearer },
  });
  let output = '', stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', text => { output += text; });
  child.stderr.on('data', text => { stderr += text; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) reject(new Error('P48 worker failure: ' + stderr.slice(0, 150)));
      else resolve(output.trim().split('\n'));
    });
  });
  return { child, done, output: () => output };
}
async function fetchRaw(endpoint, method, headers = []) {
  const url = new URL(endpoint);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method, headers, agent: false,
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
    });
    request.once('error', reject);
    request.end();
  });
}
function init() {
  const dir = mkdtempSync(join(tmpdir(), 'p48-coordinator-'));
  const state = store(dir);
  state.seedLabPermit(signed());
  return { dir, state, bearer: token() };
}

test('P48 refuses non-loopback bind, weak token and missing signed-state store', async () => {
  await assert.rejects(startP48AuthenticatedLabCoordinator({
    store: { readSignedState: () => signed() },
    readBearerToken: token(), host: '0.0.0.0',
  }), /isolated loopback/);
  await assert.rejects(startP48AuthenticatedLabCoordinator({
    store: { readSignedState: () => signed() },
    readBearerToken: 'short',
  }), /isolated loopback/);
  await assert.rejects(startP48AuthenticatedLabCoordinator({
    store: {}, readBearerToken: token(),
  }), /isolated loopback/);
});

test('P48 authenticates one exact read-only GET and never reveals secrets in errors', { timeout: 15000 }, async () => {
  const f = init();
  let server;
  try {
    server = await startP48AuthenticatedLabCoordinator({
      store: f.state, readBearerToken: f.bearer,
    });
    assert.equal(server.host, '127.0.0.1');
    assert.equal(server.activation_authorized, false);
    const good = await fetchRaw(server.endpoint, 'GET', [
      'Authorization', 'Bearer ' + f.bearer,
    ]);
    assert.equal(good.status, 200);
    assert.deepEqual(JSON.parse(good.body), signed());
    assert.match(good.headers['cache-control'], /no-store/);
    for (const [method, headers, status] of [
      ['GET', [], 403],
      ['GET', ['Authorization', 'Bearer ' + token()], 403],
      ['GET', ['Authorization', 'Bearer ' + f.bearer, 'Authorization', 'Bearer ' + f.bearer], 403],
      ['POST', ['Authorization', 'Bearer ' + f.bearer], 405],
    ]) {
      const response = await fetchRaw(server.endpoint, method, headers);
      assert.equal(response.status, status);
      assert.equal(response.body.includes(f.bearer), false);
    }
    const wrong = await fetchRaw(server.endpoint.replace('/state', '/other'), 'GET');
    assert.equal(wrong.status, 404);
    assert.equal(server.production_coordinator_deployed, false);
  } finally {
    if (server) await server.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('P48 authenticated separate OS workers see persistent signed revoke after server restart', { timeout: 20000 }, async () => {
  const f = init();
  let server;
  try {
    server = await startP48AuthenticatedLabCoordinator({
      store: f.state, readBearerToken: f.bearer,
    });
    const [one, two] = await Promise.all([
      worker(server.endpoint, f.bearer).done,
      worker(server.endpoint, f.bearer).done,
    ]);
    for (const lines of [one, two]) {
      const report = JSON.parse(lines.at(-1));
      assert.equal(report.outcome, 'exact');
      assert.equal(report.source, 'legacy-control');
      assert.equal(report.activation_authorized, false);
    }
    f.state.revokeWithSignedState(signed('revoked', 2));
    await server.close();
    server = await startP48AuthenticatedLabCoordinator({
      store: store(f.dir), readBearerToken: f.bearer,
    });
    const after = JSON.parse((await worker(server.endpoint, f.bearer).done).at(-1));
    assert.equal(after.outcome, 'blocked');
    assert.equal(after.latched, true);
    assert.equal(after.activation_authorized, false);
  } finally {
    if (server) await server.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('P48 revocation interrupts an in-flight authenticated OS shadow worker', { timeout: 20000 }, async () => {
  const f = init();
  let server, w;
  try {
    server = await startP48AuthenticatedLabCoordinator({
      store: f.state, readBearerToken: f.bearer,
    });
    w = worker(server.endpoint, f.bearer, 'pending');
    await new Promise((resolve, reject) => {
      const wait = setTimeout(() => reject(new Error('P48 worker did not start')), 9000);
      const check = () => {
        if (w.output().includes('STARTED\n')) {
          clearTimeout(wait);
          resolve();
        }
      };
      w.child.stdout.on('data', check);
      check();
    });
    f.state.revokeWithSignedState(signed('revoked', 2));
    const report = JSON.parse((await w.done).at(-1));
    assert.equal(report.outcome, 'blocked');
    assert.equal(report.latched, true);
    assert.equal(report.activation_authorized, false);
  } finally {
    w?.child.kill();
    if (server) await server.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('P48 incomplete OFF intent and connection loss both fail closed for authorized workers', { timeout: 20000 }, async () => {
  const f = init();
  let server;
  try {
    server = await startP48AuthenticatedLabCoordinator({
      store: f.state, readBearerToken: f.bearer,
    });
    writeFileSync(join(f.dir, 'p47-revocation-intent'), 'partial', { flag: 'wx' });
    const response = await fetchRaw(server.endpoint, 'GET', [
      'Authorization', 'Bearer ' + f.bearer,
    ]);
    assert.equal(response.status, 503);
    assert.equal(JSON.parse((await worker(server.endpoint, f.bearer).done).at(-1)).outcome, 'blocked');
    const endpoint = server.endpoint;
    await server.close();
    server = null;
    const offline = JSON.parse((await worker(endpoint, f.bearer).done).at(-1));
    assert.equal(offline.outcome, 'blocked');
    assert.equal(offline.latched, true);
  } finally {
    if (server) await server.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('P48 worker bearer rotation denies old bearer after fresh coordinator start', { timeout: 15000 }, async () => {
  const f = init();
  let server;
  try {
    server = await startP48AuthenticatedLabCoordinator({
      store: f.state, readBearerToken: f.bearer,
    });
    const old = f.bearer;
    await server.close();
    const fresh = token();
    server = await startP48AuthenticatedLabCoordinator({
      store: store(f.dir), readBearerToken: fresh,
    });
    assert.equal(JSON.parse((await worker(server.endpoint, old).done).at(-1)).outcome, 'blocked');
    assert.equal(JSON.parse((await worker(server.endpoint, fresh).done).at(-1)).outcome, 'exact');
  } finally {
    if (server) await server.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
