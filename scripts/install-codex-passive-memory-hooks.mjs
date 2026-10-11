#!/usr/bin/env node
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildCodexPassiveMemoryHookEntries } from '../memory-engine/codex-passive-memory-hook-config.mjs';

const DEFAULT_LOCK_STALE_MS = 5 * 60 * 1000;
const MANAGED_EVENTS = ['UserPromptSubmit', 'PostToolUse', 'Stop'];

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultHubRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function defaultHooksPath() {
  return join(homedir(), '.codex', 'hooks.json');
}

function stableJson(value) {
  return JSON.stringify(value);
}

function hookCommandText(hook) {
  return [
    typeof hook?.command === 'string' ? hook.command : '',
    typeof hook?.commandWindows === 'string' ? hook.commandWindows : '',
  ].join('\n');
}

function isPassiveMemoryHook(hook) {
  return /memory-engine[\\/]adapters[\\/]codex-passive-memory-hook-cli\.mjs/iu.test(
    hookCommandText(hook),
  );
}

function readExistingHooks(path) {
  if (!existsSync(path)) return { hooks: {} };
  const info = lstatSync(path);
  if (info.isSymbolicLink()) {
    throw new Error('Refusing to modify symlinked Codex hooks file: ' + path);
  }
  if (!info.isFile()) {
    throw new Error('Codex hooks path is not a file: ' + path);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Codex hooks root must be a JSON object');
  }
  if (
    parsed.hooks !== undefined
    && (!parsed.hooks || typeof parsed.hooks !== 'object' || Array.isArray(parsed.hooks))
  ) {
    throw new Error('Codex hooks root.hooks must be a JSON object');
  }
  return { ...parsed, hooks: { ...(parsed.hooks ?? {}) } };
}

function stripPassiveHooks(entries, eventName) {
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) {
    throw new Error('hooks.' + eventName + ' must be an array');
  }
  const output = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Array.isArray(entry.hooks)) {
      output.push(entry);
      continue;
    }
    const hooks = entry.hooks.filter((hook) => !isPassiveMemoryHook(hook));
    if (hooks.length === entry.hooks.length) output.push(entry);
    else if (hooks.length > 0) output.push({ ...entry, hooks });
  }
  return output;
}

function eventDiagnostic(currentEntries, desiredEntry, eventName) {
  const entries = currentEntries === undefined ? [] : currentEntries;
  if (!Array.isArray(entries)) {
    throw new Error('hooks.' + eventName + ' must be an array');
  }
  const managed = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.hooks)) continue;
    for (const hook of entry.hooks) {
      if (isPassiveMemoryHook(hook)) managed.push({ entry, hook });
    }
  }
  const exact = entries.some((entry) => stableJson(entry) === stableJson(desiredEntry));
  const current = managed.length === 1 && exact;
  return {
    event: eventName,
    action: current ? 'current' : managed.length === 0 ? 'install' : 'normalize',
    managedHooksFound: managed.length,
    exactDefinitionPresent: exact,
    reasons: current
      ? []
      : [
          ...(managed.length === 0 ? ['missing_managed_hook'] : []),
          ...(managed.length > 1 ? ['duplicate_managed_hooks'] : []),
          ...(managed.length > 0 && !exact ? ['managed_definition_differs'] : []),
        ],
  };
}

export function planCodexPassiveMemoryHooks({
  existing,
  hubRoot = defaultHubRoot(),
  nodePath = process.execPath,
  model = null,
  reasoningEffort = 'medium',
  judgeTimeoutMs = 120_000,
} = {}) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    throw new TypeError('existing must be a Codex hooks object');
  }
  if (!nonEmpty(hubRoot)) throw new TypeError('hubRoot must be a non-empty string');
  if (!nonEmpty(nodePath)) throw new TypeError('nodePath must be a non-empty string');

  const hooks = { ...(existing.hooks ?? {}) };
  const desired = buildCodexPassiveMemoryHookEntries({
    hubRoot,
    nodePath,
    model,
    reasoningEffort,
    judgeTimeoutMs,
  });
  const diagnostics = {};

  for (const eventName of MANAGED_EVENTS) {
    diagnostics[eventName] = eventDiagnostic(
      hooks[eventName],
      desired[eventName],
      eventName,
    );
    hooks[eventName] = [
      ...stripPassiveHooks(hooks[eventName], eventName),
      desired[eventName],
    ];
  }

  const config = { ...existing, hooks };
  return {
    config,
    changed: stableJson(config) !== stableJson(existing),
    diagnostics,
  };
}

function backupName(path) {
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  return path + '.backup-' + stamp;
}

function acquireInstallLock(lockPath, {
  staleAfterMs = DEFAULT_LOCK_STALE_MS,
  now = Date.now,
} = {}) {
  mkdirSync(dirname(lockPath), { recursive: true });
  try {
    return openSync(lockPath, 'wx');
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  let info;
  try {
    info = statSync(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return openSync(lockPath, 'wx');
    throw error;
  }
  if ((now() - info.mtimeMs) <= staleAfterMs) {
    throw new Error('Another passive memory hook installation is already in progress');
  }
  unlinkSync(lockPath);
  return openSync(lockPath, 'wx');
}

function releaseInstallLock(fd, lockPath) {
  try {
    closeSync(fd);
  } finally {
    try { unlinkSync(lockPath); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

export function installCodexPassiveMemoryHooks({
  hooksPath = defaultHooksPath(),
  hubRoot = defaultHubRoot(),
  nodePath = process.execPath,
  model = null,
  reasoningEffort = 'medium',
  judgeTimeoutMs = 120_000,
  apply = false,
  writeFile = writeFileSync,
} = {}) {
  const target = resolve(hooksPath);
  const root = resolve(hubRoot);
  const lockPath = target + '.agent-hub-passive-memory.lock';

  const run = () => {
    const existing = readExistingHooks(target);
    const plan = planCodexPassiveMemoryHooks({
      existing,
      hubRoot: root,
      nodePath,
      model,
      reasoningEffort,
      judgeTimeoutMs,
    });
    let backupPath = null;
    if (apply && plan.changed) {
      mkdirSync(dirname(target), { recursive: true });
      if (existsSync(target)) {
        backupPath = backupName(target);
        copyFileSync(target, backupPath);
      }
      writeFile(target, JSON.stringify(plan.config, null, 2) + '\n', 'utf8');
    }
    return {
      schemaVersion: 1,
      hooksPath: target,
      hubRoot: root,
      nodePath,
      wouldChange: plan.changed,
      applied: apply && plan.changed,
      backupPath,
      hookTrustRequired: plan.changed,
      managed: {
        UserPromptSubmit: true,
        PostToolUse: true,
        Stop: true,
        passiveRunExtraction: true,
      },
      plan: plan.diagnostics,
    };
  };

  if (!apply) return run();
  const fd = acquireInstallLock(lockPath);
  try { return run(); }
  finally { releaseInstallLock(fd, lockPath); }
}

export function parseCodexPassiveHookInstallArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  const result = {
    apply: false,
    hooksPath: undefined,
    hubRoot: undefined,
    nodePath: undefined,
    model: null,
    reasoningEffort: 'medium',
    judgeTimeoutMs: 120_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') { result.apply = true; continue; }
    if (['--hooks', '--hub-root', '--node', '--model', '--reasoning-effort', '--judge-timeout-ms'].includes(arg)) {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error(arg + ' requires a value');
      if (arg === '--hooks') result.hooksPath = value;
      if (arg === '--hub-root') result.hubRoot = value;
      if (arg === '--node') result.nodePath = value;
      if (arg === '--model') result.model = value;
      if (arg === '--reasoning-effort') {
        if (!['low', 'medium', 'high'].includes(value)) {
          throw new Error('--reasoning-effort requires low, medium, or high');
        }
        result.reasoningEffort = value;
      }
      if (arg === '--judge-timeout-ms') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error('--judge-timeout-ms requires a positive integer');
        }
        result.judgeTimeoutMs = parsed;
      }
      index += 1;
      continue;
    }
    throw new Error('Unknown option: ' + arg);
  }
  return result;
}

export function main({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const result = installCodexPassiveMemoryHooks(
      parseCodexPassiveHookInstallArgs(argv),
    );
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
