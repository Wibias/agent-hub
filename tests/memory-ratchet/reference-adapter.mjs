import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

import {
  MemoryEngine,
  evaluateReliance,
} from '../../memory-engine/index.mjs';
import { createAuthorityPolicy } from '../../memory-engine/authority.mjs';

function repositoryPath(source, { repoPath = null, revisionSha = null } = {}) {
  if (typeof source !== 'string' || source.length === 0) return null;
  if (source.includes(':') || source.startsWith('/') || source.startsWith('\\')) return null;
  if (source.includes('/')) return source;
  if (!repoPath || !revisionSha) return null;
  return gitBlobOid(repoPath, revisionSha, source) ? source : null;
}

function sourceKind(event, path) {
  if (path) return 'repository';
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

const AUTHORITY_POLICY = createAuthorityPolicy({
  trustedRepositoryPaths: [
    'AGENTS.md',
    'CONTEXT.md',
    '.agents/**',
    'docs/adr/**',
    'docs/runtime.md',
  ],
});

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
  if (type !== 'blob') return null;
  return oid;
}

export function createReferenceMemoryAdapter({ clock } = {}) {
  let engine = null;
  let projectRepos = new Map();

  return {
    metadata: {
      candidate: {
        name: 'memory-engine-reference',
        version: '0.4.0-action-approvals',
        source_revision: 'workspace',
      },
      adapter_revision: 'reference-action-approvals-v1',
      network_required: false,
    },

    async reset() {
      if (engine) engine.close();
      engine = null;
      projectRepos = new Map();
    },

    async setup(prepared) {
      const dbPath = join(dirname(prepared.current.repo_path), '.memory-engine-reference.sqlite3');
      engine = new MemoryEngine({ dbPath, clock });

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

      const path = repositoryPath(event.source, {
        repoPath: event.repo_path,
        revisionSha: event.revision_sha,
      });
      const blobOid = path
        ? gitBlobOid(event.repo_path, event.revision_sha, path)
        : null;
      if (path && !blobOid) {
        throw new Error(`repository evidence path missing at observed revision: ${path}`);
      }

      const kind = sourceKind(event, path);
      const authorityClass = AUTHORITY_POLICY.classify({
        eventType: event.type,
        sourceKind: kind,
        sourceRef: event.source,
      });

      const ingested = engine.ingest({
        evidence: {
          id: `evidence:${event.id}`,
          projectId: event.project_id,
          harness: event.harness,
          sessionId: event.session_id,
          sourceKind: kind,
          sourceRef: event.source,
          capturedAt: event.at,
          branch: event.branch,
          commitSha: event.revision_sha,
          path,
          blobOid,
          content: event.content,
          authorityClass,
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
          state: event.type === 'approval' ? 'candidate' : undefined,
          branchScope: event.branch,
          createdAt: event.at,
          validFrom: event.type === 'approval' ? event.at : null,
          validUntil: event.authority?.valid_until ?? null,
        },
        lifecycle: {
          supersedes: (event.relations?.supersedes ?? []).map(claimId),
          rejects: (event.relations?.rejects ?? []).map(claimId),
          conflictsWith: (event.relations?.conflicts_with ?? []).map(claimId),
        },
      });

      let approval = null;
      if (event.authority) {
        if (event.type !== 'approval') {
          throw new Error('structured action authority requires an approval event');
        }
        if (event.authority.one_time !== true) {
          throw new Error('reference adapter only accepts bounded one-time fixture approvals');
        }

        approval = engine.recordApproval({
          id: `approval:${event.id}`,
          projectId: event.project_id,
          action: event.authority.action,
          target: event.authority.target,
          environment: event.authority.environment,
          issuedAt: event.at,
          expiresAt: event.authority.valid_until,
          maxUses: 1,
          sourceEvidenceId: `evidence:${event.id}`,
        });
      }

      return {
        ...ingested,
        approval,
      };
    },

    async authorizeAction(request) {
      if (!engine) throw new Error('reference memory adapter is not set up');
      return engine.authorizeAction({
        projectId: request.project_id,
        action: request.action,
        target: request.target,
        environment: request.environment,
        artifact: request.artifact ?? null,
        constraints: request.constraints ?? {},
        consume: request.consume ?? false,
      });
    },

    async listApprovals({ project_id: projectId }) {
      if (!engine) throw new Error('reference memory adapter is not set up');
      return engine.listApprovals({ projectId });
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
        reliance: {
          planning: evaluateReliance({ ...current, use: 'planning' }),
          answer: evaluateReliance({ ...current, use: 'answer' }),
          project_policy: evaluateReliance({ ...current, use: 'project_policy' }),
        },
      };
    },

    async teardown() {
      if (engine) engine.close();
      engine = null;
      projectRepos = new Map();
    },
  };
}
