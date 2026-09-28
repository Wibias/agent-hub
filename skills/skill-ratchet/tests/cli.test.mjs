import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('repository Skill Ratchet CLI exposes deterministic preflight and validate only', async () => {
  const testsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(testsDir, '../../..');
  const cli = path.join(repoRoot, 'scripts', 'skill-ratchet.mjs');
  const { stdout } = await execFileAsync(process.execPath, [cli, 'help'], { cwd: repoRoot });

  assert.match(stdout, /preflight --query/);
  assert.match(stdout, /validate --skill-root/);
  assert.doesNotMatch(stdout, /\bqualify\b/);
  assert.doesNotMatch(stdout, /codex/i);
});

test('successful structural validation prints a bounded strong-agent review prompt and weaker-run edits', async () => {
  const testsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(testsDir, '../../..');
  const cli = path.join(repoRoot, 'scripts', 'skill-ratchet.mjs');
  const skillRoot = path.join(repoRoot, 'skills', 'skill-ratchet');
  const { stdout } = await execFileAsync(process.execPath, [
    cli,
    'validate',
    '--skill-root', skillRoot,
  ], { cwd: repoRoot });

  assert.match(stdout, /Skill Ratchet structural validation: PASS/);
  assert.match(stdout, /Copy this prompt into the strong agent:/);
  assert.match(stdout, /This is the STRONG model review\./);
  assert.match(stdout, /one bounded review/i);
  assert.match(stdout, /Do not execute the canonical cases one by one/i);
  assert.match(stdout, /Do not create fixtures/i);
  assert.match(stdout, /strong\.json/);
  assert.match(stdout, new RegExp(skillRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(stdout, /For the weaker agent, use the exact same prompt and change only:/);
  assert.match(stdout, /This is the WEAKER model review\./);
  assert.match(stdout, /weaker\.json/);
  assert.match(stdout, /--run-evidence/);
  assert.doesNotMatch(stdout, /Run D1-D3 and N1-N3/);
  assert.doesNotMatch(stdout, /Run A1-A6/);
});
