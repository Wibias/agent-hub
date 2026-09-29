import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION = '1.0.0';
const SOURCE_REVISION = '9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5';
const TENANT_ID = 'memory-ratchet';
const ORGANIZATION_ID = 'memory-ratchet';
const CONNECTOR_PREFIX = 'memory-ratchet-git';

async function defaultLoadModule() {
  const modulePath = process.env.LONGMEMORY_MODULE;
  if (!modulePath) {
    throw new Error('LONGMEMORY_MODULE must point to the pinned LongMemory dist/index.js');
  }
  return import(pathToFileURL(modulePath).href);
}

function isRepoPath(source) {
  return typeof source === 'string'
    && source.length > 0
    && !source.includes(':')
    && !source.startsWith('/')
    && !source.startsWith('\\')
    && source.includes('/');
}

function kindFor(event) {
  switch (event.type) {
    case 'decision':
    case 'rejection':
      return 'decision';
    case 'approval':
      return 'deployment';
    case 'code_observation':
      return 'code_fact';
    case 'document_read':
      return 'reference';
    case 'proposal':
      return 'reference';
    case 'inference':
    case 'tool_result':
    case 'noise_memory':
    case 'noise_session':
    case 'candidate_memory':
    default:
      return 'manual_fact';
  }
}

function subjectiveFor(event) {
  return new Set([
    'proposal',
    'inference',
    'noise_memory',
    'noise_session',
    'candidate_memory',
  ]).has(event.type);
}

function sourceTypeFor(event) {
  if (isRepoPath(event.source)) return 'local_file';
  if (event.type === 'tool_result') return 'tool';
  if (typeof event.harness === 'string' && event.harness.length > 0) return event.harness;
  return 'memory-ratchet';
}

function sourceConnector(projectId) {
  return {
    id: `${CONNECTOR_PREFIX}:${projectId}`,
    name: `Memory Ratchet Git source ${projectId}`,
    source_type: 'git',
    async connect() {},
    async disconnect() {},
    async testConnection() { return true; },
  };
}

function projectConfig(projectId, repoPath, dbPath) {
  return {
    tenant_id: TENANT_ID,
    organization_id: ORGANIZATION_ID,
    project_id: projectId,
    name: projectId,
    description: `Memory Ratchet fixture project at ${repoPath}`,
    store: 'sqlite',
    db_path: dbPath,
    max_context_tokens: 2048,
  };
}

export function createLongMemoryAdapter({
  loadModule = defaultLoadModule,
  databasePath = null,
} = {}) {
  let manager = null;
  let dbPath = databasePath;
  const projectRepos = new Map();
  const connectorIds = new Map();
  const eventTopics = new Map();
  const eventContents = new Map();

  function topicFor(event) {
    const relationTargets = [
      ...(event.relations?.supersedes ?? []),
      ...(event.relations?.conflicts_with ?? []),
      ...(event.relations?.rejects ?? []),
    ];
    for (const target of relationTargets) {
      const topic = eventTopics.get(target);
      if (topic) return topic;
    }
    if (isRepoPath(event.source)) return event.source;
    return event.id;
  }

  function projectEvent(event) {
    const topic = topicFor(event);
    const sourceBacked = isRepoPath(event.source);
    const rejected = (event.relations?.rejects ?? [])
      .map((id) => eventContents.get(id))
      .filter(Boolean);

    const translated = {
      id: event.id,
      kind: kindFor(event),
      text: event.content,
      topic,
      at: Date.parse(event.at),
      observed_at: Date.parse(event.at),
      source_type: sourceTypeFor(event),
      source_id: event.source,
      external_id: event.id,
      subjective: subjectiveFor(event),
      replace_current: event.relations?.conflicts_with?.length
        ? false
        : event.relations?.supersedes?.length
          ? true
          : undefined,
      alternatives_rejected: rejected.length > 0 ? rejected : undefined,
      metadata: {
        event_id: event.id,
        harness: event.harness,
        session_id: event.session_id,
      },
    };

    if (sourceBacked) {
      translated.repo = basename(event.repo_path);
      translated.branch = event.branch;
      translated.commit = event.revision_sha;
      translated.file_path = event.source;
    }

    return translated;
  }

  return {
    metadata: {
      candidate: {
        name: 'LongMemory',
        version: VERSION,
        source_revision: SOURCE_REVISION,
      },
      adapter_revision: 'longmemory-project-v2',
      network_required: false,
    },

    async reset() {
      if (manager) await manager.close();
      manager = null;
      projectRepos.clear();
      connectorIds.clear();
      eventTopics.clear();
      eventContents.clear();
    },

    async setup(prepared) {
      if (!dbPath) {
        dbPath = join(dirname(prepared.current.repo_path), '.memory-ratchet-longmemory.db');
      }

      const projects = new Map();
      projects.set(prepared.current.project_id, prepared.current.repo_path);
      for (const event of prepared.events ?? []) {
        if (!projects.has(event.project_id)) projects.set(event.project_id, event.repo_path);
      }

      const api = await loadModule();
      if (typeof api.createProjectMemory !== 'function') {
        throw new Error('Pinned LongMemory module does not export createProjectMemory');
      }

      const first = projects.entries().next().value;
      manager = await api.createProjectMemory(projectConfig(first[0], first[1], dbPath));

      for (const [projectId, repoPath] of projects) {
        projectRepos.set(projectId, repoPath);
        await manager.createProject(projectConfig(projectId, repoPath, dbPath));

        const connectorId = `${CONNECTOR_PREFIX}:${projectId}`;
        connectorIds.set(projectId, connectorId);
        const currentRef = projectId === prepared.current.project_id
          ? prepared.current.revision_sha
          : null;
        await manager.linkSourceToProject(projectId, {
          connector_id: connectorId,
          connector: sourceConnector(projectId),
          label: basename(repoPath),
          current_ref: currentRef,
          world_kind: 'repositories',
        });
      }
    },

    async ingest(event) {
      if (!manager) throw new Error('LongMemory adapter is not set up');
      const translated = projectEvent(event);
      const id = await manager.ingestProjectEvent(event.project_id, translated);
      eventTopics.set(event.id, translated.topic);
      eventContents.set(event.id, event.content);
      return { id };
    },

    async recall(request) {
      if (!manager) throw new Error('LongMemory adapter is not set up');
      const connectorId = connectorIds.get(request.project_id);
      if (connectorId && request.revision_sha) {
        manager.setProjectSourceRef(request.project_id, connectorId, request.revision_sha);
      }

      const result = await manager.recallProject(
        request.project_id,
        {
          text: request.query,
          k: request.limit ?? 10,
          token_budget: 2048,
        },
        'project_strict',
      );

      return {
        ...result,
        items: result.memories ?? [],
      };
    },

    async inspectState() {
      return {
        database_path: dbPath,
        projects: Object.fromEntries(projectRepos),
        event_topics: Object.fromEntries(eventTopics),
      };
    },

    async teardown() {
      if (manager) await manager.close();
      manager = null;
    },
  };
}
