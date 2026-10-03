#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultHubRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function defaultProfilesDir(hubRoot = defaultHubRoot()) {
  return join(
    resolve(hubRoot),
    'agent-runtime',
    'generated',
    'codex-profiles',
  );
}

function defaultCodexHome(env = process.env) {
  if (nonEmpty(env.CODEX_HOME)) return resolve(env.CODEX_HOME.trim());
  return join(homedir(), '.codex');
}

function readJsonFile(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      'Could not read Codex profile manifest: '
      + (error instanceof Error ? error.message : String(error)),
    );
  }
  return value;
}

function validateManifest(manifest) {
  if (
    !manifest
    || typeof manifest !== 'object'
    || Array.isArray(manifest)
    || manifest.schemaVersion !== 1
    || manifest.host !== 'codex'
    || !Array.isArray(manifest.profiles)
  ) {
    throw new Error('Unsupported Codex profile manifest');
  }

  const seenProfiles = new Set();
  const seenFiles = new Set();

  for (const entry of manifest.profiles) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Invalid Codex profile manifest entry');
    }
    const profile = String(entry.profile ?? '');
    const file = String(entry.file ?? '');
    if (!/^agent-hub-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile)) {
      throw new Error('Unsafe Codex profile name: ' + profile);
    }
    if (file !== profile + '.config.toml') {
      throw new Error('Codex profile file does not match profile name: ' + file);
    }
    if (basename(file) !== file) {
      throw new Error('Unsafe Codex profile file name: ' + file);
    }
    if (seenProfiles.has(profile) || seenFiles.has(file)) {
      throw new Error('Duplicate Codex profile manifest entry: ' + profile);
    }
    seenProfiles.add(profile);
    seenFiles.add(file);
  }

  return manifest;
}

function readRegularFile(path, label) {
  if (!existsSync(path)) return null;
  const info = lstatSync(path);
  if (info.isSymbolicLink()) {
    throw new Error('Refusing symlinked ' + label + ': ' + path);
  }
  if (!info.isFile()) {
    throw new Error(label + ' is not a regular file: ' + path);
  }
  return readFileSync(path);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function staleManagedFiles(codexHome, expectedFiles) {
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
      && !expectedFiles.has(name)
    ))
    .sort();
}

export function planCodexRuntimeProfiles({
  profilesDir = defaultProfilesDir(),
  codexHome = defaultCodexHome(),
} = {}) {
  const sourceDir = resolve(profilesDir);
  const targetDir = resolve(codexHome);
  const manifestPath = join(sourceDir, 'manifest.json');
  const manifest = validateManifest(readJsonFile(manifestPath));
  const expectedFiles = new Set(manifest.profiles.map((entry) => entry.file));

  const profiles = [];
  for (const entry of manifest.profiles) {
    const sourcePath = join(sourceDir, entry.file);
    const targetPath = join(targetDir, entry.file);
    const source = readRegularFile(sourcePath, 'generated Codex profile');
    if (source === null) {
      throw new Error('Generated Codex profile is missing: ' + sourcePath);
    }
    const target = readRegularFile(targetPath, 'installed Codex profile');

    profiles.push({
      skill: entry.skill,
      profile: entry.profile,
      file: entry.file,
      action: target === null
        ? 'install'
        : source.equals(target)
          ? 'current'
          : 'update',
      sourcePath,
      targetPath,
      reasoning: entry.mapped?.reasoning ?? null,
      unmapped: entry.unmapped ?? {},
    });
  }

  const stale = staleManagedFiles(targetDir, expectedFiles);
  return {
    schemaVersion: 1,
    host: 'codex',
    profilesDir: sourceDir,
    codexHome: targetDir,
    profiles,
    staleManagedProfiles: stale,
    wouldChange: profiles.some((entry) => entry.action !== 'current'),
  };
}

function writeManagedProfile(targetPath, content) {
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content);
}

export function installCodexRuntimeProfiles({
  profilesDir = defaultProfilesDir(),
  codexHome = defaultCodexHome(),
  apply = false,
} = {}) {
  const plan = planCodexRuntimeProfiles({ profilesDir, codexHome });
  const backups = [];

  if (apply && plan.wouldChange) {
    mkdirSync(plan.codexHome, { recursive: true });
    const stamp = timestamp();

    for (const entry of plan.profiles) {
      if (entry.action === 'current') continue;

      if (entry.action === 'update') {
        const backupPath = entry.targetPath + '.backup-' + stamp;
        copyFileSync(entry.targetPath, backupPath);
        backups.push({
          profile: entry.profile,
          path: backupPath,
        });
      }

      const source = readRegularFile(
        entry.sourcePath,
        'generated Codex profile',
      );
      writeManagedProfile(entry.targetPath, source);
    }
  }

  return {
    ...plan,
    applied: apply && plan.wouldChange,
    backups,
    pruneApplied: false,
    note: plan.staleManagedProfiles.length > 0
      ? 'Stale Agent Hub profile files were reported but not removed.'
      : null,
  };
}

export function parseCodexRuntimeProfileInstallArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');

  const result = {
    apply: false,
    profilesDir: undefined,
    codexHome: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      result.apply = true;
      continue;
    }
    if (arg === '--profiles-dir' || arg === '--codex-home') {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error(arg + ' requires a path');
      if (arg === '--profiles-dir') result.profilesDir = value;
      if (arg === '--codex-home') result.codexHome = value;
      index += 1;
      continue;
    }
    throw new Error(
      'Unknown option: ' + arg
      + '\nUsage: node scripts/install-codex-runtime-profiles.mjs '
      + '[--apply] [--profiles-dir PATH] [--codex-home PATH]',
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
    const options = parseCodexRuntimeProfileInstallArgs(argv);
    const result = installCodexRuntimeProfiles(options);
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
