import {
  access,
  readFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  applyCodexNativeMemoryIsolation,
  planCodexNativeMemoryIsolation,
} from '../memory-engine/codex-native-memory-isolation.mjs';
import {
  auditCodexState,
} from '../memory-engine/codex-state-audit.mjs';

function parseArgs(argv, env = process.env) {
  let codexHome = env.CODEX_HOME || join(homedir(), '.codex');
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--apply') {
      apply = true;
      continue;
    }

    if (arg === '--codex-home') {
      const value = argv[index + 1];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error('--codex-home requires a path');
      }
      codexHome = value;
      index += 1;
      continue;
    }

    throw new Error('unknown argument: ' + arg);
  }

  return {
    apply,
    codexHome: resolve(codexHome),
  };
}

async function readConfig(configPath) {
  try {
    return {
      exists: true,
      text: await readFile(configPath, 'utf8'),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        exists: false,
        text: '',
      };
    }
    throw error;
  }
}

function directMemoryNames(audit) {
  return audit.directMemory.map((entry) => entry.name).sort();
}

function arraysEqual(left, right) {
  return (
    left.length === right.length
    && left.every((value, index) => value === right[index])
  );
}

export async function runCodexNativeMemoryIsolation({
  argv = process.argv.slice(2),
  env = process.env,
  log = console.log,
} = {}) {
  const options = parseArgs(argv, env);
  const configPath = join(options.codexHome, 'config.toml');

  const beforeAudit = await auditCodexState({
    codexHome: options.codexHome,
  });
  const beforeDirectMemory = directMemoryNames(beforeAudit);
  const config = await readConfig(configPath);
  const plan = planCodexNativeMemoryIsolation(config.text);

  if (!options.apply) {
    const output = {
      type: 'codex_native_memory_isolation',
      mode: 'dry-run',
      codex_home: options.codexHome,
      config_path: configPath,
      config_exists: config.exists,
      changed: plan.changed,
      before: plan.before,
      after: plan.after,
      backup_required: config.exists && plan.changed,
      direct_memory_preserved: true,
      direct_memory: beforeDirectMemory,
      next_step: plan.changed
        ? 'rerun with --apply after reviewing this plan'
        : 'native Codex memory is already isolated by config',
    };

    log(JSON.stringify(output));
    return output;
  }

  const applied = await applyCodexNativeMemoryIsolation({
    codexHome: options.codexHome,
  });

  const afterAudit = await auditCodexState({
    codexHome: options.codexHome,
  });
  const afterDirectMemory = directMemoryNames(afterAudit);

  if (!arraysEqual(beforeDirectMemory, afterDirectMemory)) {
    throw new Error(
      'Direct native-memory surfaces changed unexpectedly during config isolation',
    );
  }

  if (applied.backupPath) {
    await access(applied.backupPath);
  }

  const output = {
    type: 'codex_native_memory_isolation',
    mode: 'apply',
    codex_home: options.codexHome,
    config_path: applied.configPath,
    changed: applied.changed,
    backup_path: applied.backupPath,
    settings: applied.settings,
    direct_memory_preserved: true,
    direct_memory: afterDirectMemory,
    restart_required: applied.changed,
    next_step: applied.changed
      ? 'restart Codex before verifying effective memory behavior'
      : 'native Codex memory is already isolated by config',
  };

  log(JSON.stringify(output));
  return output;
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  runCodexNativeMemoryIsolation().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
