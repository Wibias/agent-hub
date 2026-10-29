#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GraphRecallShadowStore } from '../graph-recall-shadow-store.mjs';
import {
  parseCodexHookCliOptions as parseCoreCodexHookCliOptions,
  parseCodexMemoryConfig,
  runCodexMemoryHook as runCoreCodexMemoryHook,
} from './codex-hook-cli-core.mjs';
import {
  createCodexMemoryHookAdapter,
} from './codex-hooks.mjs';

export * from './codex-hook-cli-core.mjs';

export function parseCodexHookCliOptions(argv = []) {
  const options = parseCoreCodexHookCliOptions(argv);
  if (argv.includes('--graph-recall-shadow')) {
    options.graphRecallShadow = true;
  }
  return options;
}

function graphRecallShadowIntent(configOptions, env) {
  return (
    configOptions?.graphRecallShadow === true
    || env?.AGENT_HUB_MEMORY_GRAPH_RECALL_SHADOW === 'true'
  );
}

function graphRecallShadowEnabled(configOptions, env) {
  return (
    configOptions?.graphRecallShadow === true
    || (
      configOptions?.ignoreMemoryEnv !== true
      && env?.AGENT_HUB_MEMORY_GRAPH_RECALL_SHADOW === 'true'
    )
  );
}

export async function runCodexMemoryHook({
  env = process.env,
  configOptions = {},
  createAdapter = createCodexMemoryHookAdapter,
  createGraphRecallShadowStore = (options) => new GraphRecallShadowStore(options),
  ...rest
} = {}) {
  const intent = graphRecallShadowIntent(configOptions, env);
  if (!intent) {
    return runCoreCodexMemoryHook({
      ...rest,
      env,
      configOptions,
      createAdapter,
    });
  }

  const enabled = graphRecallShadowEnabled(configOptions, env);
  let graphRecallShadowStore = null;
  if (enabled) {
    try {
      const config = parseCodexMemoryConfig(env, configOptions);
      graphRecallShadowStore = createGraphRecallShadowStore({
        rootDir: join(dirname(config.dbPath), 'shadow-replay'),
      });
    } catch {
      graphRecallShadowStore = null;
    }
  }
  const effective = enabled && graphRecallShadowStore !== null;

  return runCoreCodexMemoryHook({
    ...rest,
    env,
    configOptions,
    createAdapter(adapterOptions) {
      return createAdapter({
        ...adapterOptions,
        graphRecallShadow: effective,
        graphRecallShadowStore,
      });
    },
  });
}

async function readStdin(stream = process.stdin) {
  stream.setEncoding('utf8');
  let raw = '';
  for await (const chunk of stream) raw += chunk;
  return raw;
}

async function main() {
  try {
    const raw = await readStdin();
    const event = JSON.parse(raw);
    const output = await runCodexMemoryHook({
      event,
      configOptions: parseCodexHookCliOptions(process.argv.slice(2)),
    });
    if (output !== null) {
      process.stdout.write(`${JSON.stringify(output)}\n`);
    }
  } catch {
    // Codex command hooks are fail-soft here: exit 0 with no output.
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) await main();
