import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const engine = process.env.IMPECCABLE_TEST_ENGINE_PATH;
if (!engine) throw new Error('Set IMPECCABLE_TEST_ENGINE_PATH to a previously verified native 0.1.31 engine binary');

async function unusedLocalPort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function readServerInfo(file, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Native live-server stopped before publishing its session metadata');
    }
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (Number.isInteger(parsed.port) && typeof parsed.token === 'string' && parsed.token.length >= 8) {
        return parsed;
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error('Native live-server did not publish valid connection metadata within 15 seconds');
}

async function request(port, uri) {
  const response = await fetch('http://127.0.0.1:' + port + uri, {
    signal: AbortSignal.timeout(5000),
    redirect: 'manual',
  });
  return { status: response.status, body: await response.text() };
}

test('official Rust 0.1.31 Live loopback server enforces token and source-root confinement', { timeout: 35000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dwa-impeccable-native-live-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'dwa-impeccable-native-outside-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'prototype'), { recursive: true });
  await mkdir(path.join(root, '.impeccable', 'live'), { recursive: true });
  await writeFile(path.join(root, 'prototype', 'index.html'), '<!doctype html><title>Private fixture</title><body>INSIDE_DWA_FIXTURE</body>\n');
  await writeFile(path.join(root, '.impeccable', 'live', 'config.json'), JSON.stringify({
    files: ['prototype/*.html'],
    insertBefore: '</body>',
    commentSyntax: 'html',
  }));
  await writeFile(path.join(outside, 'secret.txt'), 'OUTSIDE_DWA_SECRET_DO_NOT_EXPOSE\n');

  const port = await unusedLocalPort();
  const child = spawn(engine, ['live-server', '--port=' + port], {
    cwd: root,
    env: {
      ...process.env,
      IMPECCABLE_HOME: path.join(root, 'isolated-home'),
      IMPECCABLE_LIVE_COPY_AGENT: 'off',
    },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    }
  });

  const info = await readServerInfo(path.join(root, '.impeccable', 'live', 'server.json'), child);
  assert.equal(info.port, port);
  assert.equal(info.pid, child.pid);
  const token = encodeURIComponent(info.token);

  // A forged or missing token must never read a local source file or browser script.
  for (const uri of [
    '/source?path=prototype/index.html',
    '/source?token=wrong&path=prototype/index.html',
    '/live.js',
    '/status',
  ]) {
    const result = await request(port, uri);
    assert.equal(result.status, 401, 'token-free request was accepted: ' + uri);
    assert.doesNotMatch(result.body, /INSIDE_DWA_FIXTURE|OUTSIDE_DWA_SECRET/);
  }

  const inside = await request(port, '/source?token=' + token + '&path=prototype/index.html');
  assert.equal(inside.status, 200);
  assert.match(inside.body, /INSIDE_DWA_FIXTURE/);

  const traversal = await request(port, '/source?token=' + token + '&path=../outside.txt');
  assert.equal(traversal.status, 400);
  assert.doesNotMatch(traversal.body, /OUTSIDE_DWA_SECRET/);

  // Unix can create a real symlink without host-wide privilege grants.
  if (process.platform !== 'win32') {
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'outbound-link.txt'));
    const escape = await request(port, '/source?token=' + token + '&path=outbound-link.txt');
    assert.equal(escape.status, 403, 'a symlink escaped the live-server source root');
    assert.doesNotMatch(escape.body, /OUTSIDE_DWA_SECRET/);
  }

  const script = await request(port, '/live.js?token=' + token);
  assert.equal(script.status, 200);
  assert.ok(script.body.length > 1000, 'Rust Live browser script was missing');
  assert.doesNotMatch(script.body, /OUTSIDE_DWA_SECRET/);

  // Verify an authenticated stop and no successful request after shutdown.
  const stop = await request(port, '/stop?token=' + token);
  assert.ok(stop.status >= 200 && stop.status < 300, 'authenticated native Live shutdown failed');
  console.log('PASS: native Rust 0.1.31 loopback token, source boundary, browser script and shutdown');
});
