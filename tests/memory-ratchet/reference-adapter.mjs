import { execFileSync } from 'node:child_process';
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

function gitBlobOid(repoPath, revisionSha, path) {
  const output = execFileSync(
    'git',
    ['-C', repoPath, 'ls-tree', '-z', revisionSha, '--', path],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  if (output.length === 0) return null;

  const record = output.split('\0', 1)[0];
  const tab = record.indexOf('\t');
  if (tab < 0) throw new Error(`unexpected git ls-tree output for ${path}`);

  const [mode, type, oid] = record.slice(0, tab).split(/\s+/);
  const returnedPath = record.slice(tab + 1);
  if (!mode || !type || !oid || returnedPath !== path) {
    throw new Error(`unexpected git ls-tree record for ${path}`);
  }
  return oid;
}

export function createReferenceMemoryAdapter() {
  let engine = null;
  let projectRepos = new Map();

  return {
    metadata: {
      candidate: {
        name: 'memory-engine-reference',
        version: '0.2.0-git-freshness',
        source_revision: 'workspace',
      },
      adapter_revision: 'reference-git-freshness-v1',
      network_required: false,
    },

    async reset() {
      if (engine) engine.close();
      engine = null;
      projectRepos = new Map();
    },

    async setup(prepared) {
      const dbPath = join(dirname(prepared.current.repo_path), '.memory-engine-reference.sqlite3');
      engine = new MemoryEngine({ dbPath });

      const projects = new Map();
      projects.set(prepared.current.project_id, prepared.current.repo_path);
      for (const event of prepared.events) {
        if (!projects.has(event.project_id)) projects.set(event.project_id, event.repo_path);
      }
      projectRepos = projects;

      for (const [projectId] of projects) {
        engine.registerProject({
          projectId,
          repoIdentity: projectId,
        });
      }
    },

    async ingest(event) {
      if (!engine) throw new Error('reference memory adapter is not set up');

      const path = repositoryPath(event.source);
      const blobOid = path
        ? gitBlobOid(event.repo_path, event.revision_sha, path)
        : null;
      if (path && !blobOid) {
        throw new Error(`repository evidence path missing at observed revision: ${path}`);
      }

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
          path,
          blobOid,
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

      const repoPath = request.repo_path ?? projectRepos.get(request.project_id);
      if (!repoPath) throw new Error(`missing repository path for ${request.project_id}`);

      for (const path of engine.repositoryPaths({
        projectId: request.project_id,
        branch: request.branch,
      })) {
        engine.recordRepositoryPathState({
          projectId: request.project_id,
          branch: request.branch,
          path,
          commitSha: request.revision_sha,
          blobOid: gitBlobOid(repoPath, request.revision_sha, path),
        });
      }

      const common = {
        projectId: request.project_id,
        branch: request.branch,
        query: request.query,
        revisionSha: request.revision_sha,
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
      projectRepos = new Map();
    },
  };
}
