import { MemoryEngine } from '../index.mjs';
import { createMemoryProtocol } from '../protocol.mjs';
import { createCodexMemoryHookAdapter } from './codex-hooks.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseCodexMemoryConfig(env = process.env) {
  const dbPath = env.AGENT_HUB_MEMORY_DB;
  const projectId = env.AGENT_HUB_MEMORY_PROJECT_ID;
  if (!nonEmpty(dbPath) || !nonEmpty(projectId)) return null;

  return {
    dbPath,
    projectId,
    repoIdentity: nonEmpty(env.AGENT_HUB_MEMORY_REPO_IDENTITY)
      ? env.AGENT_HUB_MEMORY_REPO_IDENTITY
      : projectId,
    capturePrompts: env.AGENT_HUB_MEMORY_CAPTURE_PROMPTS === 'true',
  };
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

export async function runCodexMemoryHook({
  event,
  env = process.env,
  createEngine = (options) => new MemoryEngine(options),
  createProtocol = createMemoryProtocol,
  createAdapter = createCodexMemoryHookAdapter,
} = {}) {
  const config = parseCodexMemoryConfig(env);
  if (config === null) return null;

  let memory = null;
  try {
    memory = createEngine({ dbPath: config.dbPath });

    if (!memory.getProject(config.projectId)) {
      memory.registerProject({
        projectId: config.projectId,
        repoIdentity: config.repoIdentity,
      });
    }

    const protocol = createProtocol({
      memory,
      classifyAuthority: classifyCodexAuthority,
    });
    const adapter = createAdapter({
      protocol,
      memory,
      projectId: config.projectId,
      capturePrompts: config.capturePrompts,
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
