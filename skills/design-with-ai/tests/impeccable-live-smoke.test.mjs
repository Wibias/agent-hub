import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(root, 'internal', 'impeccable', 'scripts', 'live-server.mjs');

async function waitForReady(child) {
  let output = '';
  let stderr = '';
  return new Promise((resolve, reject) => {
    const fail = (message) => {
      clearTimeout(timer);
      reject(new Error(message + (stderr ? ': ' + stderr.slice(-800) : '')));
    };
    const timer = setTimeout(() => fail('Live server readiness timeout'), 12000);
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
      const port = output.match(/Impeccable live server running on http:\/\/localhost:(\d+)/);
      const token = output.match(/Token: ([0-9a-f-]{36})/i);
      if (port && token) {
        clearTimeout(timer);
        resolve({ port: Number(port[1]), token: token[1] });
      }
    });
    child.once('error', (error) => fail('Live server spawn failed: ' + error.message));
    child.once('exit', (code) => fail('Live server exited before readiness: ' + code));
  });
}

test('explicit internal Live server serves authenticated browser assets on loopback and stops',
  { timeout: 25000 },
  async () => {
    const project = mkdtempSync(path.join(tmpdir(), 'dwa-live-smoke-'));
    const sentinel = path.join(project, 'index.html');
    writeFileSync(sentinel, '<main>original fixture</main>\n');
    const child = spawn(process.execPath, [serverScript], {
      cwd: project, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, IMPECCABLE_NO_UPDATE_CHECK: '1' },
    });
    try {
      const { port, token } = await waitForReady(child);
      const url = 'http://127.0.0.1:' + port;
      const req = (route) => fetch(url + route, { signal: AbortSignal.timeout(3500) });
      const health = await req('/health');
      assert.equal(health.status, 200);
      assert.equal((await health.json()).mode, 'variant');
      assert.equal((await req('/status')).status, 401);
      assert.equal((await req('/live.js')).status, 401);
      const status = await req('/status?token=' + encodeURIComponent(token));
      assert.equal(status.status, 200);
      assert.equal((await status.json()).status, 'ok');
      const script = await req('/live.js?token=' + encodeURIComponent(token));
      assert.equal(script.status, 200);
      assert.ok((await script.text()).length > 100, 'real bundled browser script must be served');
      assert.equal(readFileSync(sentinel, 'utf8'), '<main>original fixture</main>\n');
      // The stop endpoint may close the socket before a response is flushed.
      await req('/stop?token=' + encodeURIComponent(token)).catch(() => {});
      await Promise.race([
        once(child, 'exit'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Live server did not stop')), 4000)),
      ]);
      assert.equal(readFileSync(sentinel, 'utf8'), '<main>original fixture</main>\n');
    } finally {
      if (child.exitCode === null) child.kill('SIGTERM');
      // Give a caught shutdown the opportunity to complete before removing its cwd.
      if (child.exitCode === null) await Promise.race([
        once(child, 'exit').catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ]);
      rmSync(project, { recursive: true, force: true });
    }
  });
