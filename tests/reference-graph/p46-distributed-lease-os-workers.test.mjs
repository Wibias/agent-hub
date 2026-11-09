import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sha = '83a3794cc54d2f2d129b83e8e672e18b35f11cff';
const labId = 'p46-loopback-lab-20261109';
const key = generateKeyPairSync('ed25519');
const publicPem = key.publicKey.export({ type: 'spki', format: 'pem' });
const keyPin = createHash('sha256')
  .update(key.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const fixture = fileURLToPath(new URL('./fixtures/p46-lab-worker.mjs', import.meta.url));
const payload = {
  schema_version: 'reference-graph.p46-lab-lease.v1',
  repository: 'Wibias/agent-hub', repository_sha: sha,
  project_ref: 'vrznfnxzlxaavpqbzbzd', lab_id: labId,
  scope: 'isolated-shadow-rehearsal', profiles: ['standard', 'deep'],
  sequence: 1, decision: 'shadow-probe-only',
  issued_at: '2026-11-09T19:10:00.000Z',
  expires_at: '2026-11-09T19:10:06.000Z',
  default_off: true,
};
function signed(patch = {}) {
  const payload_json = JSON.stringify({ ...payload, ...patch });
  return {
    schema_version: 'reference-graph.p46-signed-lab-envelope.v1',
    payload_json,
    signature_base64: sign(null, Buffer.from(payload_json), key.privateKey).toString('base64'),
  };
}
async function coordinator(state) {
  const server = createServer((req, res) => {
    if (req.url !== '/state' || req.method !== 'GET') {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200).end(JSON.stringify(state.current));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, endpoint: 'http://127.0.0.1:' + server.address().port + '/state' };
}
function worker(endpoint, mode = 'exact') {
  const child = spawn(process.execPath, [
    fixture, endpoint,
    Buffer.from(publicPem, 'utf8').toString('base64url'),
    keyPin, sha, labId, mode,
  ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', t => { output += t; });
  child.stderr.on('data', t => { stderr += t; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) reject(new Error('P46 test worker exited ' + code + ': ' + stderr.slice(0, 120)));
      else resolve(output.trim().split('\n'));
    });
  });
  return { child, done, output: () => output };
}
test('P46 independently started OS workers honor shared signed revocation', { timeout: 15000 }, async () => {
  const state = { current: signed() };
  const { server, endpoint } = await coordinator(state);
  try {
    const [a, b] = await Promise.all([worker(endpoint).done, worker(endpoint).done]);
    for (const lines of [a, b]) {
      const result = JSON.parse(lines.at(-1));
      assert.equal(result.outcome, 'exact');
      assert.equal(result.authorized, false);
      assert.equal(result.source, 'legacy-control');
    }
    state.current = signed({ decision: 'revoked', sequence: 2 });
    const restart = JSON.parse((await worker(endpoint).done).at(-1));
    assert.equal(restart.outcome, 'blocked');
    assert.equal(restart.latched, true);
    assert.equal(restart.authorized, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('P46 signed coordinator revocation aborts separate worker during HTTP-shadow activity', { timeout: 15000 }, async () => {
  const state = { current: signed() };
  const { server, endpoint } = await coordinator(state);
  const w = worker(endpoint, 'pending');
  try {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('P46 worker did not start')), 8000);
      const check = () => {
        if (w.output().includes('STARTED\n')) {
          clearTimeout(deadline);
          resolve();
        }
      };
      w.child.stdout.on('data', check);
      check();
    });
    state.current = signed({ decision: 'revoked', sequence: 2 });
    const lines = await w.done;
    assert.equal(lines[0], 'STARTED');
    const verdict = JSON.parse(lines.at(-1));
    assert.equal(verdict.outcome, 'blocked');
    assert.equal(verdict.latched, true);
    assert.equal(verdict.authorized, false);
  } finally {
    w.child.kill();
    await new Promise(resolve => server.close(resolve));
  }
});
test('P46 coordinator connection failure denies newly started worker', { timeout: 15000 }, async () => {
  const state = { current: signed() };
  const { server, endpoint } = await coordinator(state);
  await new Promise(resolve => server.close(resolve));
  const verdict = JSON.parse((await worker(endpoint).done).at(-1));
  assert.equal(verdict.outcome, 'blocked');
  assert.equal(verdict.latched, true);
  assert.equal(verdict.authorized, false);
});
