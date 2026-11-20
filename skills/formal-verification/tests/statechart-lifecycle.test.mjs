import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../statechart/scripts');
const [major, minor] = process.versions.node.split('.').map(Number);
const tsReady = major >= 24 || (major === 23 && minor >= 6) ||
  (major === 22 && minor >= 18);

async function settles(child, timeoutMs = 15000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let timeout;
  try {
    await Promise.race([
      once(child, 'exit'),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('process did not exit within timeout')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

test('janitor terminates a detached worker group and removes only supplied staging folders',
  { skip: tsReady ? false : 'requires Node 22.18+ TypeScript execution', timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'statechart-lifecycle-'));
    const stage = path.join(root, 'stage');
    const scratch = path.join(root, 'scratch');
    const keep = path.join(root, 'keep');
    await Promise.all([mkdir(stage), mkdir(scratch), mkdir(keep)]);
    const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    assert.ok(worker.pid && worker.pid > 0, 'detached worker PID must be known');
    let janitor;
    try {
      janitor = spawn(process.execPath, [
        '--disable-warning=ExperimentalWarning',
        path.join(scripts, 'janitor.ts'), String(worker.pid), stage, scratch,
      ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let err = '';
      janitor.stderr.setEncoding('utf8').on('data', (chunk) => { err += chunk; });
      // Empty stdin means the worker did not report clean exit.
      janitor.stdin.end();
      await settles(janitor);
      assert.equal(janitor.exitCode, 0, err);
      await settles(worker);
      for (const dir of [stage, scratch]) {
        await assert.rejects(access(dir), { code: 'ENOENT' });
      }
      await access(keep);
    } finally {
      if (janitor?.exitCode === null && janitor?.signalCode === null) janitor.kill('SIGKILL');
      if (worker.exitCode === null && worker.signalCode === null) {
        const { killGroup } = await import(pathToFileURL(path.join(scripts, 'kill.ts')).href);
        await killGroup(worker.pid);
        await settles(worker, 5000).catch(() => {});
      }
      await rm(root, { recursive: true, force: true });
    }
  });
