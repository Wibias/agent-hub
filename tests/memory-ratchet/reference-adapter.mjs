import { dirname, join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';

function repositoryPath(source) {
  if (typeof source !== 'string' || source.length === 0) return null;
  if (source.includes(':') || source.startsWith('/') || source.startsWith('\\')) return null;
  return source.includes('/') ? source : null;
}

function sourceKind(event) {
  if (repositoryPath(event.source)) return 'repository';
  if (typeof event.source === 'string') {
    if (event.source.startsWith('session:')) return 'session';
    if (event.source.startsWith('tool:')) return 'tool';
    if (event.source.startsWith('agent:')) return 'agent';
  }
  return 'event';
}

function claimId(eventId) {
  return `claim:${eventId}`;
}

export function createReferenceMemoryAdapter() {
  let engine = null;

  return {
    metadata: {
      candidate: {
        name: 'memory-engine-reference',
        version: '0.1.0-foundation',
        source_revision: 'workspace',
      },
      adapter_revision: 'reference-foundation-v1',
      network_required: false,
    },

    async reset() {
      if (engine) engine.close();
      engine = null;
    },

    async setup(prepared) {
      const dbPath = join(dirname(prepared.current.repo_path), '.memory-engine-reference.sqlite3');
      engine = new MemoryEngine({ dbPath });

      const projects = new Map();
      projects.set(prepared.current.project_id, prepared.current.repo_path);
      for (const event of prepared.events) {
        if (!projects.has(event.project_id)) projects.set(event.project_id, event.repo_path);
      }

      for (const [projectId] of projects) {
        engine.registerProject({
          projectId,
          repoIdentity: projectId,
        });
      }
    },

    async ingest(event) {
      if (!engine) throw new Error('reference memory adapter is not set up');

      return engine.ingest({
        evidence: {
          id: `evidence:${event.id}`,
          projectId: event.project_id,
          harness: event.harness,
          sessionId: event.session_id,
          sourceKind: sourceKind(event),
          sourceRef: event.source,
          capturedAt: event.at,
          branch: event.branch,
          commitSha: event.revision_sha,
          path: repositoryPath(event.source),
          blobOid: null,
          content: event.content,
          authorityClass: 'unclassified',
          metadata: {
            event_id: event.id,
            event_type: event.type,
            revision: event.revision,
          },
        },
        claim: {
          id: claimId(event.id),
          kind: event.type,
          subject: event.type,
          predicate: 'states',
          value: event.content,
          branchScope: event.branch,
          createdAt: event.at,
        },
        lifecycle: {
          supersedes: (event.relations?.supersedes ?? []).map(claimId),
          rejects: (event.relations?.rejects ?? []).map(claimId),
        },
      });
    },

    async recall(request) {
      if (!engine) throw new Error('reference memory adapter is not set up');

      const common = {
        projectId: request.project_id,
        branch: request.branch,
        query: request.query,
        limit: request.limit ?? 10,
      };
      const current = engine.recall({ ...common, mode: 'current' });
      const historical = engine.recall({ ...common, mode: 'historical' });

      return {
        ...current,
        history: historical.items,
      };
    },

    async teardown() {
      if (engine) engine.close();
      engine = null;
    },
  };
}
