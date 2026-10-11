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
import { fileURLToPath } from 'node:url';

const DEFAULT_LOCK_STALE_MS = 5 * 60 * 1000;

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
    && (!parsed.hooks || typeof parsed.hooks !== 'object' || Array.isArray(parsed.hooks))
  ) {
    throw new Error('Codex hooks root.hooks must be a JSON object');
  }
  return { ...parsed, hooks: { ...(parsed.hooks ?? {}) } };
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
    throw new Error('Another Agent Hub memory hook installation is already in progress');
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

function assertPlan(plan, name) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError(name + ' must return a plan object');
  }
  if (!plan.config || typeof plan.config !== 'object' || Array.isArray(plan.config)) {
    throw new TypeError(name + ' plan must contain config');
  }
  return plan;
}

export function installCodexCombinedMemoryHooks({
  hooksPath = defaultHooksPath(),
  hubRoot = defaultHubRoot(),
  nodePath = process.execPath,
  model = null,
  reasoningEffort = 'medium',
  judgeTimeoutMs = 120_000,
  apply = false,
  planCoreHooks,
  planPassiveHooks,
  writeFile = writeFileSync,
} = {}) {
  if (typeof planCoreHooks !== 'function') {
    throw new TypeError('planCoreHooks must be a function');
  }
  if (typeof planPassiveHooks !== 'function') {
    throw new TypeError('planPassiveHooks must be a function');
  }
  if (!nonEmpty(hubRoot)) throw new TypeError('hubRoot must be a non-empty string');
  if (!nonEmpty(nodePath)) throw new TypeError('nodePath must be a non-empty string');
  if (typeof apply !== 'boolean') throw new TypeError('apply must be a boolean');

  const target = resolve(hooksPath);
  const root = resolve(hubRoot);
  const lockPath = target + '.agent-hub-memory-combined.lock';

  const run = () => {
    const existing = readExistingHooks(target);
    const core = assertPlan(planCoreHooks({
      existing,
      hubRoot: root,
      nodePath,
    }), 'planCoreHooks');
    const passive = assertPlan(planPassiveHooks({
      existing: core.config,
      hubRoot: root,
      nodePath,
      model,
      reasoningEffort,
      judgeTimeoutMs,
    }), 'planPassiveHooks');
    const finalConfig = passive.config;
    const changed = stableJson(finalConfig) !== stableJson(existing);

    let backupPath = null;
    if (apply && changed) {
      mkdirSync(dirname(target), { recursive: true });
      if (existsSync(target)) {
        backupPath = backupName(target);
        copyFileSync(target, backupPath);
      }
      writeFile(target, JSON.stringify(finalConfig, null, 2) + '\n', 'utf8');
    }

    return {
      schemaVersion: 1,
      hooksPath: target,
      hubRoot: root,
      nodePath,
      wouldChange: changed,
      applied: apply && changed,
      backupPath,
      hookTrustRequired: changed,
      managed: {
        SessionStart: true,
        UserPromptSubmit: true,
        PostToolUse: true,
        Stop: true,
        SubagentStop: true,
        candidateCapture: true,
        agentDecisionCapture: true,
        autoPipeline: true,
        coreMemory: true,
        passiveRunExtraction: true,
        ...(core.managed ?? {}),
        ...(passive.managed ?? {}),
      },
      plan: {
        core: core.diagnostics ?? core.plan ?? null,
        passive: passive.diagnostics ?? passive.plan ?? null,
      },
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
