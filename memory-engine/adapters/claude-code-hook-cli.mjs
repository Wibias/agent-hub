#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryEngine } from '../index.mjs';
import { memoryRestoreLocked } from '../memory-maintenance-lock.mjs';
import { createMemoryProtocol } from '../protocol.mjs';
import {
  createClaudeCodeMemoryHookAdapter,
} from './claude-code-hooks.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultExecFile(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function canonicalizeClaudeCodeGitRemote(value) {
  if (!nonEmpty(value)) return null;
  const remote = value.trim();

  let host;
  let repoPath;

  const scpLike = remote.match(/^[^@\s]+@([^:\s]+):(.+)$/);
  if (scpLike) {
    host = scpLike[1];
    repoPath = scpLike[2];
  } else {
    let parsed;
    try {
      parsed = new URL(remote);
    } catch {
      return null;
    }
    host = parsed.hostname;
    repoPath = parsed.pathname;
  }

  host = String(host || '').trim().toLowerCase();
  repoPath = String(repoPath || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');

  if (!host || !repoPath || /\s/.test(repoPath)) return null;
  const segments = repoPath.split('/').filter(Boolean);
  if (
    segments.length < 2
    || segments.some((segment) => segment === '.' || segment === '..')
  ) {
    return null;
  }

  return `${host}/${segments.join('/')}`;
}

export function defaultClaudeCodeMemoryDbPath({
  env = process.env,
  platform = process.platform,
  homeDir = homedir(),
} = {}) {
  if (platform === 'win32') {
    const localAppData = nonEmpty(env.LOCALAPPDATA)
      ? env.LOCALAPPDATA.trim()
      : win32.join(homeDir, 'AppData', 'Local');
    return win32.join(localAppData, 'agent-hub', 'memory.sqlite3');
  }

  const stateHome = nonEmpty(env.XDG_STATE_HOME)
    ? env.XDG_STATE_HOME.trim()
    : join(homeDir, '.local', 'state');
  return join(stateHome, 'agent-hub', 'memory.sqlite3');
}

export function parseClaudeCodeMemoryConfig(env = process.env, options = {}) {
  const ignoreMemoryEnv = options.ignoreMemoryEnv === true;
  const dbPath = !ignoreMemoryEnv && nonEmpty(env.AGENT_HUB_MEMORY_DB)
    ? env.AGENT_HUB_MEMORY_DB.trim()
    : defaultClaudeCodeMemoryDbPath({ env, ...options });

  return {
    dbPath,
    projectId: !ignoreMemoryEnv && nonEmpty(env.AGENT_HUB_MEMORY_PROJECT_ID)
      ? env.AGENT_HUB_MEMORY_PROJECT_ID.trim()
      : null,
    repoIdentity: !ignoreMemoryEnv
      && nonEmpty(env.AGENT_HUB_MEMORY_REPO_IDENTITY)
      ? env.AGENT_HUB_MEMORY_REPO_IDENTITY.trim()
      : null,
  };
}

export function parseClaudeCodeHookCliOptions(argv = []) {
  if (!Array.isArray(argv)) {
    throw new TypeError('argv must be an array');
  }
  return {
    ignoreMemoryEnv: argv.includes('--ignore-memory-env'),
  };
}

export function resolveClaudeCodeProjectScope({
  event,
  config,
  execFile = defaultExecFile,
} = {}) {
  if (!config || typeof config !== 'object') {
    throw new TypeError('config must be an object');
  }

  if (nonEmpty(config.projectId)) {
    return {
      projectId: config.projectId.trim(),
      repoIdentity: nonEmpty(config.repoIdentity)
        ? config.repoIdentity.trim()
        : config.projectId.trim(),
      canonicalRemote: null,
    };
  }

  if (nonEmpty(config.repoIdentity)) {
    const repoIdentity = config.repoIdentity.trim();
    return {
      projectId: repoIdentity,
      repoIdentity,
      canonicalRemote: null,
    };
  }

  const cwd = event?.cwd;
  if (!nonEmpty(cwd)) {
    throw new Error(
      'Claude Code hook event has no cwd for repository identity discovery',
    );
  }
  if (typeof execFile !== 'function') {
    throw new TypeError('execFile must be a function');
  }

  const repoPath = String(
    execFile('git', ['-C', cwd, 'rev-parse', '--show-toplevel']),
  ).trim();
  if (!repoPath) {
    throw new Error('Git repository root could not be resolved');
  }

  let remote;
  try {
    remote = String(
      execFile('git', ['-C', repoPath, 'remote', 'get-url', 'origin']),
    ).trim();
  } catch {
    throw new Error(
      'Git origin remote is required for repository identity discovery',
    );
  }

  const repoIdentity = canonicalizeClaudeCodeGitRemote(remote);
  if (!repoIdentity) {
    throw new Error(
      'Git origin remote cannot be converted to a safe repository identity',
    );
  }

  return {
    projectId: repoIdentity,
    repoIdentity,
    canonicalRemote: repoIdentity,
  };
}

export async function runClaudeCodeMemoryHook({
  event,
  env = process.env,
  configOptions = {},
  resolveProjectScope = resolveClaudeCodeProjectScope,
  fileExists = existsSync,
  createEngine = (options) => new MemoryEngine(options),
  createProtocol = createMemoryProtocol,
  createAdapter = createClaudeCodeMemoryHookAdapter,
  restoreLocked = memoryRestoreLocked,
} = {}) {
  let memory = null;

  try {
    const config = parseClaudeCodeMemoryConfig(env, configOptions);
    if (!fileExists(config.dbPath)) return null;

    const scope = resolveProjectScope({
      event,
      config,
    });

    if (restoreLocked({ dbPath: config.dbPath })) return null;

    memory = createEngine({ dbPath: config.dbPath });
    if (
      typeof memory.getProject !== 'function'
      || memory.getProject(scope.projectId) === null
    ) {
      return null;
    }

    const protocol = createProtocol({ memory });
    const adapter = createAdapter({
      protocol,
      memory,
      projectId: scope.projectId,
    });

    return await adapter.handle(event);
  } catch {
    return null;
  } finally {
    if (memory && typeof memory.close === 'function') {
      try {
        memory.close();
      } catch {
        // Hook teardown must not turn a successful prompt into a failure.
      }
    }
  }
}

async function readStdin(stream = process.stdin) {
  stream.setEncoding('utf8');
  let raw = '';
  for await (const chunk of stream) {
    raw += chunk;
  }
  return raw;
}

async function main() {
  try {
    const raw = await readStdin();
    const event = JSON.parse(raw);
    const output = await runClaudeCodeMemoryHook({
      event,
      configOptions: parseClaudeCodeHookCliOptions(process.argv.slice(2)),
    });
    if (output !== null) {
      process.stdout.write(`${JSON.stringify(output)}\n`);
    }
  } catch {
    // Claude Code command hooks are fail-soft here: exit 0 with no output.
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  await main();
}
