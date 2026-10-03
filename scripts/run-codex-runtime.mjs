#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultHubRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function defaultManifestPath(hubRoot = defaultHubRoot()) {
  return join(
    resolve(hubRoot),
    'agent-runtime',
    'generated',
    'codex-runtime',
    'manifest.json',
  );
}

function readManifest(path) {
  if (!existsSync(path)) {
    throw new Error('Codex runtime manifest is missing: ' + path);
  }
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      'Could not read Codex runtime manifest: '
      + (error instanceof Error ? error.message : String(error)),
    );
  }
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.schemaVersion !== 2
    || value.host !== 'codex'
    || !Array.isArray(value.runtimes)
  ) {
    throw new Error('Unsupported Codex runtime manifest');
  }
  return value;
}

function validateSkillName(skill) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) {
    throw new Error('Unsafe or invalid skill name: ' + skill);
  }
  return skill;
}

function defaultCodexExecutable() {
  if (nonEmpty(process.env.CODEX_BIN)) return process.env.CODEX_BIN.trim();
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
}

export function planCodexRuntimeLaunch({
  skill,
  forwardedArgs = [],
  manifestPath = defaultManifestPath(),
  codexExecutable = defaultCodexExecutable(),
} = {}) {
  const safeSkill = validateSkillName(String(skill ?? ''));
  if (!Array.isArray(forwardedArgs)) {
    throw new TypeError('forwardedArgs must be an array');
  }
  if (!nonEmpty(codexExecutable)) {
    throw new TypeError('codexExecutable must be a non-empty string');
  }

  const manifest = readManifest(resolve(manifestPath));
  const runtime = manifest.runtimes.find((entry) => entry?.skill === safeSkill);
  if (!runtime) {
    throw new Error('No Codex runtime mapping exists for skill: ' + safeSkill);
  }

  const reasoning = runtime.mapped?.reasoning;
  if (!['low', 'medium', 'high', 'xhigh'].includes(reasoning)) {
    throw new Error(
      'Codex runtime mapping has no supported reasoning value for skill: '
      + safeSkill,
    );
  }

  return {
    schemaVersion: 1,
    host: 'codex',
    skill: safeSkill,
    executable: codexExecutable,
    reasoning,
    unmapped: runtime.unmapped ?? {},
    args: [
      '-c',
      `model_reasoning_effort="${reasoning}"`,
      ...forwardedArgs,
    ],
  };
}

export function runCodexRuntime({
  skill,
  forwardedArgs = [],
  manifestPath = defaultManifestPath(),
  codexExecutable = defaultCodexExecutable(),
  dryRun = false,
  spawnProcess = spawnSync,
} = {}) {
  const plan = planCodexRuntimeLaunch({
    skill,
    forwardedArgs,
    manifestPath,
    codexExecutable,
  });

  if (dryRun) {
    return {
      ...plan,
      launched: false,
      exitCode: null,
    };
  }

  if (typeof spawnProcess !== 'function') {
    throw new TypeError('spawnProcess must be a function');
  }

  const result = spawnProcess(
    plan.executable,
    plan.args,
    {
      stdio: 'inherit',
      shell: false,
      windowsHide: false,
    },
  );

  if (result?.error) throw result.error;
  const exitCode = Number.isInteger(result?.status) ? result.status : 0;
  return {
    ...plan,
    launched: true,
    exitCode,
  };
}

export function parseCodexRuntimeArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');

  let skill = null;
  let codexExecutable;
  let manifestPath;
  let dryRun = false;
  const forwardedArgs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      forwardedArgs.push(...argv.slice(index + 1));
      break;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--codex' || arg === '--manifest') {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error(arg + ' requires a value');
      if (arg === '--codex') codexExecutable = value;
      if (arg === '--manifest') manifestPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(
        'Unknown launcher option: ' + arg
        + '\nUse -- before Codex arguments.',
      );
    }
    if (skill !== null) {
      throw new Error('Only one skill name may be supplied before --');
    }
    skill = arg;
  }

  if (!nonEmpty(skill)) {
    throw new Error(
      'Usage: node scripts/run-codex-runtime.mjs '
      + '<skill> [--dry-run] [--codex PATH] [-- <codex args>]',
    );
  }

  return {
    skill,
    forwardedArgs,
    codexExecutable,
    manifestPath,
    dryRun,
  };
}

export function main({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const parsed = parseCodexRuntimeArgs(argv);
    const result = runCodexRuntime(parsed);
    if (parsed.dryRun) {
      stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
    if (result.exitCode !== 0) process.exitCode = result.exitCode;
  } catch (error) {
    stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 2;
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
