import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const VERSION = '1.0.0';
const SOURCE_REVISION = '9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5';
const USER_ID = 'memory-ratchet';

function output(value) {
  if (typeof value === 'string') return value.trim();
  if (Buffer.isBuffer(value)) return value.toString('utf8').trim();
  return '';
}

function defaultExecute(args) {
  const result = spawnSync(process.env.LONGMEMORY_BIN ?? 'longmemory', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const parts = [output(result.stderr), output(result.stdout)].filter(Boolean);
    if (result.signal) parts.push(`signal ${result.signal}`);
    if (Number.isInteger(result.status)) parts.push(`exit ${result.status}`);
    throw new Error(parts.join('\n') || 'longmemory command failed');
  }
  return output(result.stdout);
}

function metadataFor(event) {
  return {
    event_id: event.id,
    harness: event.harness,
    session_id: event.session_id,
    branch: event.branch,
    revision_sha: event.revision_sha,
  };
}

export function createLongMemoryAdapter({
  execute = defaultExecute,
  databasePath = null,
} = {}) {
  let dbPath = databasePath;

  function run(args) {
    return execute(args);
  }

  function common(projectId, repoPath) {
    if (!dbPath) throw new Error('LongMemory adapter is not set up');
    return [
      '--cwd', repoPath,
      '--db', dbPath,
      '--project', projectId,
      '--user', USER_ID,
    ];
  }

  return {
    metadata: {
      candidate: {
        name: 'LongMemory',
        version: VERSION,
        source_revision: SOURCE_REVISION,
      },
      adapter_revision: 'longmemory-core-v1',
      network_required: false,
    },

    async reset() {
      // Every benchmark case gets a fresh fixture root, so the default database
      // path is fresh as well. An injected databasePath is owned by the caller.
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

      for (const [projectId, repoPath] of projects) {
        run(['init', ...common(projectId, repoPath)]);
      }
    },

    async ingest(event) {
      const args = [
        'ingest',
        ...common(event.project_id, event.repo_path),
        '--text', event.content,
        '--type', event.type,
        '--source', event.source,
        '--at', event.at,
        '--metadata-json', JSON.stringify(metadataFor(event)),
      ];
      const raw = run(args);
      return JSON.parse(raw);
    },

    async recall(request) {
      const raw = run([
        'recall',
        request.query,
        ...common(request.project_id, request.repo_path),
        '--mode', 'strict',
        '--k', String(request.limit ?? 10),
      ]);
      const payload = JSON.parse(raw);
      return {
        ...payload,
        items: Array.isArray(payload.items) ? payload.items : [],
      };
    },

    async inspectState() {
      return { database_path: dbPath };
    },

    async teardown() {
      // Database lifetime is the fixture lifetime.
    },
  };
}
