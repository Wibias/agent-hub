import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { applyP17LocalActivation } from '../../reference-graph/p17-local-runtime-actuator.mjs';
import {
  planP17QueryRuntime,
  runP17QueryRuntime,
} from '../../knowledge/design-references/scripts/query-runtime.mjs';

const HASH = 'a'.repeat(64);

async function tempStatePath() {
  const dir = await mkdtemp(join(tmpdir(), 'reference-graph-p17-query-'));
  return join(dir, 'activation-state-v1.json');
}

async function graphState() {
  const statePath = await tempStatePath();
  await applyP17LocalActivation({
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    grant_payload_hash: HASH,
    consumption_id: 'consume-query-runtime',
  }, { statePath });
  return statePath;
}

test('P17 query runtime preserves argument order and projects exact graph mode from durable state', async () => {
  const statePath = await graphState();
  const argv = ['--profile', 'quick', '--surface', 'dashboard', '--job', 'compare', '--platform', 'web', '--dimensions', 'motion'];
  const plan = await planP17QueryRuntime({
    argv,
    env: { KEEP_ME: 'yes', REFERENCE_GRAPH_QUICK_RUNTIME: 'legacy' },
    statePath,
    nodeExecutable: '/node',
    queryPath: '/query.mjs',
  });

  assert.equal(plan.executable, '/node');
  assert.deepEqual(plan.args, ['/query.mjs', ...argv]);
  assert.equal(plan.mode, 'graph');
  assert.equal(plan.env.REFERENCE_GRAPH_QUICK_RUNTIME, 'graph');
  assert.equal(plan.env.KEEP_ME, 'yes');
});

test('missing durable state overrides a conflicting caller graph environment back to legacy', async () => {
  const statePath = await tempStatePath();
  const plan = await planP17QueryRuntime({
    argv: ['--profile', 'quick'],
    env: { REFERENCE_GRAPH_QUICK_RUNTIME: 'graph', KEEP_ME: 'yes' },
    statePath,
    nodeExecutable: '/node',
    queryPath: '/query.mjs',
  });

  assert.equal(plan.mode, 'legacy');
  assert.equal(Object.hasOwn(plan.env, 'REFERENCE_GRAPH_QUICK_RUNTIME'), false);
  assert.equal(plan.env.KEEP_ME, 'yes');
});

test('malformed durable state fails closed and cannot inherit graph from the caller', async () => {
  const statePath = await tempStatePath();
  await writeFile(statePath, JSON.stringify({ mode: 'graph', unexpected: true }), 'utf8');
  const plan = await planP17QueryRuntime({
    argv: [],
    env: { REFERENCE_GRAPH_QUICK_RUNTIME: 'graph' },
    statePath,
    nodeExecutable: '/node',
    queryPath: '/query.mjs',
  });

  assert.equal(plan.mode, 'legacy');
  assert.equal(Object.hasOwn(plan.env, 'REFERENCE_GRAPH_QUICK_RUNTIME'), false);
});

test('P17 query runtime forwards the exact child exit code without a shell', async () => {
  const calls = [];
  const statePath = await tempStatePath();
  const result = await runP17QueryRuntime({
    argv: ['--profile', 'standard'],
    env: { KEEP_ME: 'yes' },
    statePath,
    nodeExecutable: '/node',
    queryPath: '/query.mjs',
    spawnProcess(executable, args, options) {
      calls.push({ executable, args, options });
      return { status: 7, signal: null, error: null };
    },
  });

  assert.deepEqual(result, { mode: 'legacy', exitCode: 7 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.stdio, 'inherit');
  assert.equal(calls[0].options.env.KEEP_ME, 'yes');
  assert.equal(Object.hasOwn(calls[0].options.env, 'REFERENCE_GRAPH_QUICK_RUNTIME'), false);
});

test('documented production design-reference commands use the P17 projection wrapper', () => {
  for (const path of [
    'skills/design-with-ai/references/reference-library.md',
    'knowledge/build-index.mjs',
    'knowledge/index.json',
    'knowledge/INDEX.md',
  ]) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /knowledge\/design-references\/scripts\/query-runtime\.mjs/);
    assert.doesNotMatch(source, /node knowledge\/design-references\/scripts\/query\.mjs/);
  }
});
