#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  defaultP17ActivationStatePath,
  readP17RawState,
} from '../../../reference-graph/p17-local-runtime-actuator.mjs';

const ACTIVATION_FLAG = 'REFERENCE_GRAPH_QUICK_RUNTIME';
const ACTIVATION_VALUE = 'graph';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_QUERY_PATH = join(SCRIPT_DIR, 'query.mjs');

export async function planP17QueryRuntime({
  argv = [],
  env = process.env,
  statePath = defaultP17ActivationStatePath({ env }),
  nodeExecutable = process.execPath,
  queryPath = DEFAULT_QUERY_PATH,
} = {}) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  const state = await readP17RawState({ statePath });
  const childEnv = { ...env };
  delete childEnv[ACTIVATION_FLAG];

  const mode = state?.mode === 'graph' ? 'graph' : 'legacy';
  if (mode === 'graph') childEnv[ACTIVATION_FLAG] = ACTIVATION_VALUE;

  return {
    executable: nodeExecutable,
    args: [queryPath, ...argv],
    env: childEnv,
    mode,
  };
}

export async function runP17QueryRuntime({
  argv = process.argv.slice(2),
  env = process.env,
  statePath = defaultP17ActivationStatePath({ env }),
  nodeExecutable = process.execPath,
  queryPath = DEFAULT_QUERY_PATH,
  spawnProcess = spawnSync,
} = {}) {
  if (typeof spawnProcess !== 'function') {
    throw new TypeError('spawnProcess must be a function');
  }
  const plan = await planP17QueryRuntime({
    argv,
    env,
    statePath,
    nodeExecutable,
    queryPath,
  });
  const child = spawnProcess(plan.executable, plan.args, {
    env: plan.env,
    stdio: 'inherit',
    shell: false,
  });
  if (child?.error) throw child.error;
  if (!Number.isInteger(child?.status)) {
    throw new Error(`query runtime child did not exit normally${child?.signal ? ` (${child.signal})` : ''}`);
  }
  return { mode: plan.mode, exitCode: child.status };
}

const invokedAsMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedAsMain) {
  const result = await runP17QueryRuntime();
  process.exitCode = result.exitCode;
}
