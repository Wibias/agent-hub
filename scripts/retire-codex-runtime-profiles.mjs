#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  lstatSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultCodexHome(env = process.env) {
  if (nonEmpty(env.CODEX_HOME)) return resolve(env.CODEX_HOME.trim());
  return join(homedir(), '.codex');
}

function legacyProfileNames(codexHome) {
  if (!existsSync(codexHome)) return [];
  const info = lstatSync(codexHome);
  if (info.isSymbolicLink()) {
    throw new Error('Refusing symlinked CODEX_HOME: ' + codexHome);
  }
  if (!info.isDirectory()) {
    throw new Error('CODEX_HOME is not a directory: ' + codexHome);
  }

  return readdirSync(codexHome)
    .filter((name) => (
      /^agent-hub-[a-z0-9]+(?:-[a-z0-9]+)*\.config\.toml$/.test(name)
    ))
    .sort();
}

function validateManagedFile(path) {
  const info = lstatSync(path);
  if (info.isSymbolicLink()) {
    throw new Error('Refusing symlinked legacy Agent Hub profile: ' + path);
  }
  if (!info.isFile()) {
    throw new Error('Legacy Agent Hub profile is not a regular file: ' + path);
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function planLegacyCodexProfileRetirement({
  codexHome = defaultCodexHome(),
} = {}) {
  const targetDir = resolve(codexHome);
  const profiles = legacyProfileNames(targetDir).map((file) => {
    const path = join(targetDir, file);
    validateManagedFile(path);
    return {
      file,
      path,
      action: 'backup_remove',
    };
  });

  return {
    schemaVersion: 1,
    host: 'codex',
    codexHome: targetDir,
    profiles,
    wouldChange: profiles.length > 0,
  };
}

export function retireLegacyCodexProfiles({
  codexHome = defaultCodexHome(),
  apply = false,
} = {}) {
  const plan = planLegacyCodexProfileRetirement({ codexHome });
  const backups = [];

  if (apply && plan.wouldChange) {
    const stamp = timestamp();
    for (const entry of plan.profiles) {
      validateManagedFile(entry.path);
      const backupPath = entry.path + '.retired-backup-' + stamp;
      copyFileSync(entry.path, backupPath);
      unlinkSync(entry.path);
      backups.push({
        file: entry.file,
        path: backupPath,
      });
    }
  }

  return {
    ...plan,
    applied: apply && plan.wouldChange,
    backups,
    note: plan.wouldChange
      ? 'Legacy mutable Agent Hub Codex profiles are no longer used by the runtime launcher.'
      : null,
  };
}

export function parseRetireArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  const result = {
    apply: false,
    codexHome: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      result.apply = true;
      continue;
    }
    if (arg === '--codex-home') {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error('--codex-home requires a path');
      result.codexHome = value;
      index += 1;
      continue;
    }
    throw new Error(
      'Unknown option: ' + arg
      + '\nUsage: node scripts/retire-codex-runtime-profiles.mjs '
      + '[--apply] [--codex-home PATH]',
    );
  }

  return result;
}

export function main({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const options = parseRetireArgs(argv);
    const result = retireLegacyCodexProfiles(options);
    stdout.write(JSON.stringify(result, null, 2) + '\n');
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
