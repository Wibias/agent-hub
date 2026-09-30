#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryEngine } from '../index.mjs';
import { createMemoryProtocol } from '../protocol.mjs';
import {
  createCodexMemoryHookAdapter,
  parseExplicitMemoryPrompt,
  resolveActiveDirectUserMemoryTarget,
} from './codex-hooks.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultExecFile(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function canonicalizeGitRemote(value) {
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

export function defaultCodexMemoryDbPath({
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

export function parseCodexMemoryConfig(env = process.env, options = {}) {
  const ignoreMemoryEnv = options.ignoreMemoryEnv === true;
  const dbPath = !ignoreMemoryEnv && nonEmpty(env.AGENT_HUB_MEMORY_DB)
    ? env.AGENT_HUB_MEMORY_DB.trim()
    : defaultCodexMemoryDbPath({ env, ...options });

  return {
    dbPath,
    projectId: !ignoreMemoryEnv && nonEmpty(env.AGENT_HUB_MEMORY_PROJECT_ID)
      ? env.AGENT_HUB_MEMORY_PROJECT_ID.trim()
      : null,
    repoIdentity: !ignoreMemoryEnv && nonEmpty(env.AGENT_HUB_MEMORY_REPO_IDENTITY)
      ? env.AGENT_HUB_MEMORY_REPO_IDENTITY.trim()
      : null,
    capturePrompts: !ignoreMemoryEnv
      && env.AGENT_HUB_MEMORY_CAPTURE_PROMPTS === 'true',
  };
}

export function resolveCodexProjectScope({
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
    throw new Error('Codex hook event has no cwd for repository identity discovery');
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
    throw new Error('Git origin remote is required for repository identity discovery');
  }

  const repoIdentity = canonicalizeGitRemote(remote);
  if (!repoIdentity) {
    throw new Error('Git origin remote cannot be converted to a safe repository identity');
  }

  return {
    projectId: repoIdentity,
    repoIdentity,
    canonicalRemote: repoIdentity,
  };
}

function defaultEnsureDbDirectory(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
}

function classifyCodexAuthority(channel) {
  if (
    channel?.sourceKind === 'session'
    && channel?.metadata?.event_type === 'user_prompt'
  ) {
    return 'user_direct';
  }
  return 'unclassified';
}

function authorizeCodexExplicitMemoryClaim({
  memory,
  evidence,
  claim,
  lifecycle,
}) {
  const parsed = parseExplicitMemoryPrompt(evidence?.content_redacted);
  if (
    evidence?.harness !== 'codex'
    || evidence?.source_kind !== 'session'
    || evidence?.authority_class !== 'user_direct'
    || evidence?.metadata?.event_type !== 'user_prompt'
    || evidence?.metadata?.explicit_memory !== true
    || parsed === null
    || claim?.subject !== 'user memory'
    || claim?.branchScope !== evidence?.branch
    || !Array.isArray(lifecycle?.supersedes)
    || !Array.isArray(lifecycle?.rejects)
    || !Array.isArray(lifecycle?.conflictsWith)
    || lifecycle.conflictsWith.length !== 0
  ) {
    return false;
  }

  if (parsed.mode === 'remember') {
    return (
      claim?.kind === 'user_direct'
      && claim?.predicate === 'states'
      && claim?.value === evidence.content_redacted
      && lifecycle.supersedes.length === 0
      && lifecycle.rejects.length === 0
    );
  }

  if (parsed.mode === 'forget') {
    if (
      evidence?.metadata?.explicit_memory_mode !== 'forget'
      || claim?.kind !== 'memory_control'
      || claim?.predicate !== 'forgets'
      || claim?.state !== 'expired'
      || lifecycle.supersedes.length !== 0
      || lifecycle.rejects.length !== 1
    ) {
      return false;
    }

    if (parsed.ref !== undefined) {
      const target = resolveActiveDirectUserMemoryTarget(memory, {
        projectId: evidence?.project_id,
        branch: evidence?.branch,
        ref: parsed.ref,
      });
      return (
        target !== null
        && target.id === lifecycle.rejects[0]
        && claim?.value === target.value_text
      );
    }

    const target = memory.getClaim(lifecycle.rejects[0]);
    return (
      target !== null
      && target?.project_id === evidence?.project_id
      && target?.branch_scope === evidence?.branch
      && target?.state === 'active'
      && target?.kind === 'user_direct'
      && target?.subject === 'user memory'
      && target?.predicate === 'states'
      && target?.value === parsed.value
      && claim?.value === parsed.value
    );
  }

  if (
    parsed.mode !== 'replace'
    || evidence?.metadata?.explicit_memory_mode !== 'replace'
    || claim?.kind !== 'user_direct'
    || claim?.predicate !== 'states'
    || claim?.value !== parsed.newValue
    || lifecycle.supersedes.length !== 1
    || lifecycle.rejects.length !== 0
  ) {
    return false;
  }

  if (parsed.oldRef !== undefined) {
    const target = resolveActiveDirectUserMemoryTarget(memory, {
      projectId: evidence?.project_id,
      branch: evidence?.branch,
      ref: parsed.oldRef,
    });
    return (
      target !== null
      && target.id === lifecycle.supersedes[0]
    );
  }

  const target = memory.getClaim(lifecycle.supersedes[0]);
  return (
    target !== null
    && target?.project_id === evidence?.project_id
    && target?.branch_scope === evidence?.branch
    && target?.state === 'active'
    && target?.kind === 'user_direct'
    && target?.subject === 'user memory'
    && target?.predicate === 'states'
    && target?.value === parsed.oldValue
  );
}

export async function runCodexMemoryHook({
  event,
  env = process.env,
  configOptions = {},
  createEngine = (options) => new MemoryEngine(options),
  createProtocol = createMemoryProtocol,
  createAdapter = createCodexMemoryHookAdapter,
  resolveProjectScope = resolveCodexProjectScope,
  ensureDbDirectory = defaultEnsureDbDirectory,
} = {}) {
  const config = parseCodexMemoryConfig(env, configOptions);

  let memory = null;
  try {
    const scope = resolveProjectScope({ event, config });
    if (
      configOptions.ignoreMemoryEnv === true
      || !nonEmpty(env.AGENT_HUB_MEMORY_DB)
    ) {
      ensureDbDirectory(config.dbPath);
    }
    memory = createEngine({ dbPath: config.dbPath });

    if (!memory.getProject(scope.projectId)) {
      const registration = {
        projectId: scope.projectId,
        repoIdentity: scope.repoIdentity,
      };
      if (scope.canonicalRemote !== null) {
        registration.canonicalRemote = scope.canonicalRemote;
      }
      memory.registerProject(registration);
    }

    const protocol = createProtocol({
      memory,
      classifyAuthority: classifyCodexAuthority,
      authorizeClaim: (args) => authorizeCodexExplicitMemoryClaim({
        memory,
        ...args,
      }),
    });
    const adapter = createAdapter({
      protocol,
      memory,
      projectId: scope.projectId,
      capturePrompts: config.capturePrompts,
      explicitMemoryRequests: configOptions.explicitMemoryRequests === true,
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
    const output = await runCodexMemoryHook({
      event,
      configOptions: {
        ignoreMemoryEnv: process.argv.slice(2).includes('--ignore-memory-env'),
        explicitMemoryRequests: process.argv
          .slice(2)
          .includes('--explicit-memory-requests'),
      },
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

if (isMain) {
  await main();
}
