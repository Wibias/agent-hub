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

const DEFAULT_LOCK_STALE_MS = 5 * 60 * 1000;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function defaultHubRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function defaultHooksPath() {
  return join(homedir(), '.codex', 'hooks.json');
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

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      'Could not parse existing Codex hooks JSON: '
      + (error instanceof Error ? error.message : String(error)),
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Codex hooks root must be a JSON object');
  }
  if (
    parsed.hooks !== undefined
    && (
      !parsed.hooks
      || typeof parsed.hooks !== 'object'
      || Array.isArray(parsed.hooks)
    )
  ) {
    throw new Error('Codex hooks root.hooks must be a JSON object');
  }

  return {
    ...parsed,
    hooks: { ...(parsed.hooks ?? {}) },
  };
}

function hookCommandText(hook) {
  return [
    typeof hook?.command === 'string' ? hook.command : '',
    typeof hook?.commandWindows === 'string' ? hook.commandWindows : '',
  ].join('\n');
}

function isPromptMemoryHook(hook) {
  return /memory-engine[\\/]adapters[\\/]codex-hook-cli\.mjs/i.test(
    hookCommandText(hook),
  );
}

function isEmbeddingLauncherHook(hook) {
  return /memory-engine[\\/]embedding-worker-launcher\.mjs/i.test(
    hookCommandText(hook),
  );
}

function analyzeManagedEvent(entries, predicate, desiredEntry, eventName) {
  if (entries === undefined) {
    return {
      event: eventName,
      action: 'install',
      managedHooksFound: 0,
      managedEntriesFound: 0,
      mixedEntries: 0,
      unrelatedHooksPreserved: 0,
      exactDefinitionPresent: false,
      reasons: ['missing_managed_hook'],
    };
  }
  if (!Array.isArray(entries)) {
    throw new Error('hooks.' + eventName + ' must be an array');
  }

  let managedHooksFound = 0;
  let managedEntriesFound = 0;
  let mixedEntries = 0;
  let unrelatedHooksPreserved = 0;
  let exactDefinitionPresent = false;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (!Array.isArray(entry.hooks)) continue;

    const managed = entry.hooks.filter((hook) => predicate(hook));
    const unrelated = entry.hooks.length - managed.length;
    managedHooksFound += managed.length;
    unrelatedHooksPreserved += unrelated;
    if (managed.length > 0) {
      managedEntriesFound += 1;
      if (unrelated > 0) mixedEntries += 1;
      if (stableJson(entry) === stableJson(desiredEntry)) {
        exactDefinitionPresent = true;
      }
    }
  }

  const reasons = [];
  if (managedHooksFound === 0) {
    reasons.push('missing_managed_hook');
  } else {
    if (managedHooksFound > 1 || managedEntriesFound > 1) {
      reasons.push('duplicate_managed_hooks');
    }
    if (mixedEntries > 0) {
      reasons.push('managed_hook_shares_entry_with_unrelated_hooks');
    }
    if (!exactDefinitionPresent) {
      reasons.push('managed_definition_differs');
    }
  }

  const current = (
    managedHooksFound === 1
    && managedEntriesFound === 1
    && mixedEntries === 0
    && exactDefinitionPresent
  );

  return {
    event: eventName,
    action: current ? 'current' : managedHooksFound === 0 ? 'install' : 'normalize',
    managedHooksFound,
    managedEntriesFound,
    mixedEntries,
    unrelatedHooksPreserved,
    exactDefinitionPresent,
    reasons,
  };
}

function stripManagedHooks(entries, predicate, eventName) {
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) {
    throw new Error('hooks.' + eventName + ' must be an array');
  }

  const result = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      result.push(entry);
      continue;
    }
    if (!Array.isArray(entry.hooks)) {
      result.push(entry);
      continue;
    }

    const remaining = entry.hooks.filter((hook) => !predicate(hook));
    if (remaining.length === entry.hooks.length) {
      result.push(entry);
      continue;
    }
    if (remaining.length > 0) {
      result.push({ ...entry, hooks: remaining });
    }
  }
  return result;
}

function promptEntry({ hubRoot, nodePath }) {
  const script = resolve(
    hubRoot,
    'memory-engine',
    'adapters',
    'codex-hook-cli.mjs',
  );
  const args = [
    '--ignore-memory-env',
    '--explicit-memory-requests',
    '--hybrid-recall',
    '--candidate-capture',
    '--auto-pipeline',
  ].join(' ');
  return {
    hooks: [{
      type: 'command',
      command: `node ${quote(script)} ${args}`,
      commandWindows: `${quote(nodePath)} ${quote(script)} ${args}`,
      timeout: 10,
      statusMessage: 'Recalling project memory',
      additionalContextLimit: 2500,
    }],
  };
}

function sessionStartEntry({ hubRoot, nodePath }) {
  const script = resolve(
    hubRoot,
    'memory-engine',
    'embedding-worker-launcher.mjs',
  );
  const cacheDir = resolve(
    hubRoot,
    '.cache',
    'memory-engine',
    'e5',
  );
  return {
    matcher: 'startup|resume|clear|compact',
    hooks: [{
      type: 'command',
      command: `node ${quote(script)} --cache-dir ${quote(cacheDir)}`,
      commandWindows:
        `${quote(nodePath)} ${quote(script)} --cache-dir ${quote(cacheDir)}`,
      timeout: 45,
      async: true,
      statusMessage: 'Starting project memory embeddings',
    }],
  };
}

function stableJson(value) {
  return JSON.stringify(value);
}

export function planCodexMemoryHooks({
  existing,
  hubRoot = defaultHubRoot(),
  nodePath = process.execPath,
} = {}) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    throw new TypeError('existing must be a Codex hooks object');
  }
  if (!nonEmpty(hubRoot)) {
    throw new TypeError('hubRoot must be a non-empty string');
  }
  if (!nonEmpty(nodePath)) {
    throw new TypeError('nodePath must be a non-empty string');
  }

  const hooks = { ...(existing.hooks ?? {}) };
  const desiredPrompt = promptEntry({ hubRoot, nodePath });
  const desiredSession = sessionStartEntry({ hubRoot, nodePath });
  const diagnostics = {
    UserPromptSubmit: analyzeManagedEvent(
      hooks.UserPromptSubmit,
      isPromptMemoryHook,
      desiredPrompt,
      'UserPromptSubmit',
    ),
    SessionStart: analyzeManagedEvent(
      hooks.SessionStart,
      isEmbeddingLauncherHook,
      desiredSession,
      'SessionStart',
    ),
  };

  const promptBase = stripManagedHooks(
    hooks.UserPromptSubmit,
    isPromptMemoryHook,
    'UserPromptSubmit',
  );
  const sessionBase = stripManagedHooks(
    hooks.SessionStart,
    isEmbeddingLauncherHook,
    'SessionStart',
  );

  hooks.UserPromptSubmit = [
    ...promptBase,
    desiredPrompt,
  ];
  hooks.SessionStart = [
    ...sessionBase,
    desiredSession,
  ];

  const config = { ...existing, hooks };
  return {
    config,
    changed: stableJson(config) !== stableJson(existing),
    diagnostics,
  };
}

function backupName(path) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
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
    throw new Error(
      'Another Agent Hub memory hook installation is already in progress',
    );
  }

  unlinkSync(lockPath);
  return openSync(lockPath, 'wx');
}

function releaseInstallLock(fd, lockPath) {
  try {
    closeSync(fd);
  } finally {
    try {
      unlinkSync(lockPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

export function installCodexMemoryHooks({
  hooksPath = defaultHooksPath(),
  hubRoot = defaultHubRoot(),
  nodePath = process.execPath,
  apply = false,
  writeFile = writeFileSync,
} = {}) {
  const target = resolve(hooksPath);
  const root = resolve(hubRoot);
  const lockPath = target + '.agent-hub-memory.lock';

  const run = () => {
    const existing = readExistingHooks(target);
    const plan = planCodexMemoryHooks({
      existing,
      hubRoot: root,
      nodePath,
    });

    let backupPath = null;
    if (apply && plan.changed) {
      mkdirSync(dirname(target), { recursive: true });
      if (existsSync(target)) {
        backupPath = backupName(target);
        copyFileSync(target, backupPath);
      }
      writeFile(
        target,
        JSON.stringify(plan.config, null, 2) + '\n',
        'utf8',
      );
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
        SessionStart: true,
        UserPromptSubmit: true,
        autoPipeline: true,
      },
      plan: plan.diagnostics,
    };
  };

  if (!apply) return run();

  const fd = acquireInstallLock(lockPath);
  try {
    return run();
  } finally {
    releaseInstallLock(fd, lockPath);
  }
}

export function parseCodexMemoryHookInstallArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');

  const result = {
    apply: false,
    hooksPath: undefined,
    hubRoot: undefined,
    nodePath: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      result.apply = true;
      continue;
    }
    if (['--hooks', '--hub-root', '--node'].includes(arg)) {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error(arg + ' requires a path');
      if (arg === '--hooks') result.hooksPath = value;
      if (arg === '--hub-root') result.hubRoot = value;
      if (arg === '--node') result.nodePath = value;
      index += 1;
      continue;
    }
    throw new Error(
      'Unknown option: ' + arg
      + '\nUsage: node scripts/install-codex-memory-hooks.mjs '
      + '[--apply] [--hooks PATH] [--hub-root PATH] [--node PATH]',
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
    const options = parseCodexMemoryHookInstallArgs(argv);
    const result = installCodexMemoryHooks(options);
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
