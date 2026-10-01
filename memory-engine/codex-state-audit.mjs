import {
  readdir,
  readFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';

function normalizeEntryType(type) {
  if (type === 'file' || type === 'directory') return type;
  throw new TypeError('entry type must be file or directory');
}

export function classifyCodexStateEntry({ name, type }) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError('entry name must be a non-empty string');
  }
  const normalizedType = normalizeEntryType(type);
  const lower = name.toLowerCase();

  let classification = 'other';
  let directMemoryRisk = false;

  if (lower === 'auth.json' && normalizedType === 'file') {
    classification = 'auth';
  } else if (lower === 'config.toml' && normalizedType === 'file') {
    classification = 'runtime_config';
  } else if (lower === 'hooks.json' && normalizedType === 'file') {
    classification = 'hooks';
  } else if (
    (
      normalizedType === 'file'
      && /^(?:memories|memory)(?:[_-].*)?\.sqlite(?:3)?$/i.test(name)
    )
    || (
      normalizedType === 'directory'
      && (lower === 'memories' || lower === 'memory')
    )
  ) {
    classification = 'direct_memory';
    directMemoryRisk = true;
  } else if (
    (
      normalizedType === 'file'
      && (
        /^state(?:[_-].*)?\.sqlite(?:3)?$/i.test(name)
        || /^thread_history(?:[_-].*)?\.sqlite(?:3)?$/i.test(name)
        || lower === 'history.jsonl'
      )
    )
    || (
      normalizedType === 'directory'
      && [
        'sessions',
        'archived_sessions',
        'rollouts',
        'archived_rollouts',
      ].includes(lower)
    )
  ) {
    classification = 'conversation_state';
  } else if (
    normalizedType === 'file'
    && (
      /^goals(?:[_-].*)?\.sqlite(?:3)?$/i.test(name)
      || /^queue(?:[_-].*)?\.sqlite(?:3)?$/i.test(name)
      || /^logs?(?:[_-].*)?\.sqlite(?:3)?$/i.test(name)
    )
  ) {
    classification = 'persistent_runtime_state';
  } else if (
    (
      normalizedType === 'directory'
      && ['skills', 'rules', 'prompts'].includes(lower)
    )
    || (
      normalizedType === 'file'
      && ['agents.md', 'instructions.md'].includes(lower)
    )
  ) {
    classification = 'instruction_surface';
  }

  return {
    name,
    type: normalizedType,
    classification,
    directMemoryRisk,
  };
}

function allHookCommands(hooks) {
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return [];
  }

  const commands = [];
  for (const entries of Object.values(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const nested = Array.isArray(entry.hooks) ? entry.hooks : [];
      for (const hook of nested) {
        if (!hook || typeof hook !== 'object') continue;
        for (const key of ['command', 'commandWindows']) {
          if (
            typeof hook[key] === 'string'
            && hook[key].trim().length > 0
          ) {
            commands.push({
              eventEntry: entry,
              command: hook[key],
            });
          }
        }
      }
    }
  }
  return commands;
}

function eventCommands(hooks, eventName) {
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return [];
  }
  const event = hooks[eventName];
  if (!Array.isArray(event)) return [];

  const wrapped = { [eventName]: event };
  return allHookCommands(wrapped).map((entry) => entry.command);
}

export function inspectAgentHubHookConfiguration(hooks) {
  const eventMap = (
    hooks
    && typeof hooks === 'object'
    && !Array.isArray(hooks)
    && hooks.hooks
    && typeof hooks.hooks === 'object'
    && !Array.isArray(hooks.hooks)
  )
    ? hooks.hooks
    : hooks;

  const promptCommands = eventCommands(eventMap, 'UserPromptSubmit');
  const recallCommands = promptCommands.filter((command) => (
    /memory-engine[\\/]adapters[\\/]codex-hook-cli\.mjs/i.test(command)
  ));
  const startCommands = eventCommands(eventMap, 'SessionStart');
  const launcherCommands = startCommands.filter((command) => (
    /memory-engine[\\/]embedding-worker-launcher\.mjs/i.test(command)
  ));

  const recallText = recallCommands.join('\n');

  return {
    configured: recallCommands.length > 0,
    userPromptSubmit: recallCommands.length > 0,
    sessionStartLauncher: launcherCommands.length > 0,
    flags: {
      ignoreMemoryEnv: /(?:^|\s)--ignore-memory-env(?:\s|$)/.test(recallText),
      explicitMemoryRequests: /(?:^|\s)--explicit-memory-requests(?:\s|$)/.test(
        recallText,
      ),
      hybridRecall: /(?:^|\s)--hybrid-recall(?:\s|$)/.test(recallText),
    },
  };
}

async function readHooks(codexHome) {
  try {
    const raw = await readFile(resolve(codexHome, 'hooks.json'), 'utf8');
    return {
      hooks: JSON.parse(raw),
      error: null,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        hooks: null,
        error: null,
      };
    }
    return {
      hooks: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function auditStatus({
  directMemoryCount,
  agentHubHookConfigured,
}) {
  if (!agentHubHookConfigured && directMemoryCount > 0) {
    return 'agent_hub_hook_missing_with_legacy_memory';
  }
  if (!agentHubHookConfigured) {
    return 'agent_hub_hook_missing';
  }
  if (directMemoryCount > 0) {
    return 'legacy_memory_present';
  }
  return 'no_direct_legacy_memory_detected';
}

export async function auditCodexState({ codexHome }) {
  if (typeof codexHome !== 'string' || codexHome.trim().length === 0) {
    throw new TypeError('codexHome must be a non-empty string');
  }

  const resolvedHome = resolve(codexHome);
  const dirents = await readdir(resolvedHome, {
    withFileTypes: true,
  });

  const surfaces = dirents
    .filter((entry) => entry.isFile() || entry.isDirectory())
    .map((entry) => classifyCodexStateEntry({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));

  const directMemory = surfaces.filter(
    (entry) => entry.classification === 'direct_memory',
  );
  const conversationState = surfaces.filter(
    (entry) => entry.classification === 'conversation_state',
  );
  const persistentRuntimeState = surfaces.filter(
    (entry) => entry.classification === 'persistent_runtime_state',
  );
  const instructions = surfaces.filter(
    (entry) => entry.classification === 'instruction_surface',
  );
  const unknown = surfaces.filter(
    (entry) => entry.classification === 'other',
  );

  const hookRead = await readHooks(resolvedHome);
  const agentHubHook = inspectAgentHubHookConfiguration(hookRead.hooks);

  return {
    codexHome: resolvedHome,
    agentHubHook,
    hookReadError: hookRead.error,
    directMemory,
    conversationState,
    persistentRuntimeState,
    instructions,
    runtimeConfig: surfaces.filter(
      (entry) => entry.classification === 'runtime_config',
    ),
    hooks: surfaces.filter(
      (entry) => entry.classification === 'hooks',
    ),
    auth: surfaces.filter(
      (entry) => entry.classification === 'auth',
    ),
    unknown,
    surfaces,
    summary: {
      directMemorySurfaces: directMemory.length,
      conversationStateSurfaces: conversationState.length,
      persistentRuntimeStateSurfaces: persistentRuntimeState.length,
      instructionSurfaces: instructions.length,
      unknownSurfaces: unknown.length,
      agentHubHookConfigured: agentHubHook.configured,
      status: auditStatus({
        directMemoryCount: directMemory.length,
        agentHubHookConfigured: agentHubHook.configured,
      }),
    },
  };
}
