import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseCodexRuntimeArgs,
  planCodexRuntimeLaunch,
  runCodexRuntime,
} from '../../scripts/run-codex-runtime.mjs';

function writeManifest(root) {
  const dir = join(root, 'codex-runtime');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify({
    schemaVersion: 2,
    host: 'codex',
    activation: {
      mode: 'cli-override',
      command: 'node scripts/run-codex-runtime.mjs <skill> [-- <codex args>]',
      precedence: 'cli-override',
    },
    mappedRuntimeFields: ['reasoning'],
    unmappedRuntimeFields: ['isolation', 'mutation'],
    runtimes: [
      {
        skill: 'diagnose',
        mapped: { reasoning: 'high' },
        unmapped: { isolation: 'prefer' },
      },
      {
        skill: 'writing-ticks',
        mapped: { reasoning: 'low' },
        unmapped: {},
      },
    ],
    unrendered: [],
  }, null, 2));
  return path;
}

test('runtime launch injects only reasoning as a highest-precedence CLI override', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-runtime-plan-'));
  try {
    const manifestPath = writeManifest(root);
    const plan = planCodexRuntimeLaunch({
      skill: 'diagnose',
      manifestPath,
      codexExecutable: 'codex.exe',
      forwardedArgs: ['--search'],
    });

    assert.equal(plan.skill, 'diagnose');
    assert.equal(plan.reasoning, 'high');
    assert.deepEqual(plan.unmapped, { isolation: 'prefer' });
    assert.deepEqual(plan.args, [
      '-c',
      'model_reasoning_effort="high"',
      '--search',
    ]);
    assert.ok(!plan.args.includes('--profile'));
    assert.ok(!plan.args.includes('--model'));
    assert.ok(!plan.args.some((arg) => /^model=/.test(arg)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime launch preserves Codex subcommands after the injected config override', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-runtime-exec-'));
  try {
    const manifestPath = writeManifest(root);
    const plan = planCodexRuntimeLaunch({
      skill: 'writing-ticks',
      manifestPath,
      codexExecutable: 'codex',
      forwardedArgs: ['exec', 'reply with ok'],
    });
    assert.deepEqual(plan.args, [
      '-c',
      'model_reasoning_effort="low"',
      'exec',
      'reply with ok',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime dry-run never spawns Codex', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-runtime-dry-'));
  try {
    const manifestPath = writeManifest(root);
    let spawns = 0;
    const result = runCodexRuntime({
      skill: 'diagnose',
      manifestPath,
      codexExecutable: 'codex.exe',
      dryRun: true,
      spawnProcess() {
        spawns += 1;
        return { status: 0 };
      },
    });

    assert.equal(result.launched, false);
    assert.equal(result.exitCode, null);
    assert.equal(spawns, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime launch uses inherited stdio and exact executable without shell mediation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-runtime-spawn-'));
  try {
    const manifestPath = writeManifest(root);
    let call = null;
    const result = runCodexRuntime({
      skill: 'diagnose',
      manifestPath,
      codexExecutable: 'C:\\Codex\\codex.exe',
      forwardedArgs: ['--search'],
      spawnProcess(executable, args, options) {
        call = { executable, args, options };
        return { status: 7 };
      },
    });

    assert.equal(result.launched, true);
    assert.equal(result.exitCode, 7);
    assert.deepEqual(call.executable, 'C:\\Codex\\codex.exe');
    assert.equal(call.options.stdio, 'inherit');
    assert.equal(call.options.shell, false);
    assert.deepEqual(call.args, [
      '-c',
      'model_reasoning_effort="high"',
      '--search',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime launch fails closed for unknown skills and malformed reasoning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-codex-runtime-invalid-'));
  try {
    const manifestPath = writeManifest(root);
    assert.throws(
      () => planCodexRuntimeLaunch({
        skill: 'missing-skill',
        manifestPath,
        codexExecutable: 'codex',
      }),
      /No Codex runtime mapping exists/,
    );
    assert.throws(
      () => planCodexRuntimeLaunch({
        skill: '../escape',
        manifestPath,
        codexExecutable: 'codex',
      }),
      /invalid skill name/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime launcher parser separates launcher args from Codex args', () => {
  assert.deepEqual(
    parseCodexRuntimeArgs([
      'diagnose',
      '--dry-run',
      '--codex', 'C:\\Codex\\codex.exe',
      '--',
      'exec',
      '--search',
      'hello',
    ]),
    {
      skill: 'diagnose',
      forwardedArgs: ['exec', '--search', 'hello'],
      codexExecutable: 'C:\\Codex\\codex.exe',
      manifestPath: undefined,
      dryRun: true,
    },
  );

  assert.throws(
    () => parseCodexRuntimeArgs(['diagnose', '--search']),
    /Use -- before Codex arguments/,
  );
});
