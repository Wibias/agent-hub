#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs } from './lib.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  defaultP17ActivationStatePath,
  readP17RawState,
} from '../../../reference-graph/p17-local-runtime-actuator.mjs';

const ACTIVATION_FLAG = 'REFERENCE_GRAPH_QUICK_RUNTIME';
const ACTIVATION_VALUE = 'graph';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_QUERY_PATH = join(SCRIPT_DIR, 'query.mjs');
const P69_QUERY_PATH = join(SCRIPT_DIR, 'query-host-runtime.mjs');

// Only a trusted local Windows installer creates this per-user OFF binding.
// A caller-specified path can SELECT a probe, never authorize Graph.
function hostBinding(env) {
  if (typeof env.AGENTHUB_P69_BINDING_FILE === 'string'
    && env.AGENTHUB_P69_BINDING_FILE.trim()) {
    return env.AGENTHUB_P69_BINDING_FILE;
  }
  return typeof env.LOCALAPPDATA === 'string' && env.LOCALAPPDATA.trim()
    ? join(env.LOCALAPPDATA, 'AgentsHub', 'ReferenceGraphHost-P68', 'p69-host-binding.json')
    : null;
}

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

  const profile = parseArgs(argv).profile || 'standard';
  const binding = hostBinding(env);
  const useHost = (profile === 'standard' || profile === 'deep')
    && binding !== null && existsSync(binding);
  if (useHost) {
    childEnv.AGENTHUB_P69_BINDING_FILE = binding;
  } else {
    delete childEnv.AGENTHUB_P69_BINDING_FILE;
  }

  return {
    executable: nodeExecutable,
    args: [useHost && queryPath === DEFAULT_QUERY_PATH ? P69_QUERY_PATH : queryPath, ...argv],
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
