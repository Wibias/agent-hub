import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const VERSION = '1.0.0';
const SOURCE_REVISION = 'ee9953c15a977343eb783de0b9f217aaf46e5b4e';
const GUARD_USES = ['planning', 'answer', 'external_action', 'destructive_action'];
const BRIDGE = fileURLToPath(new URL('./midas_bridge.py', import.meta.url));

function output(value) {
  if (typeof value === 'string') return value.trim();
  if (Buffer.isBuffer(value)) return value.toString('utf8').trim();
  return '';
}

function defaultExecute(payload) {
  const result = spawnSync(process.env.MIDAS_PYTHON ?? 'python3', [BRIDGE], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const parts = [output(result.stderr), output(result.stdout)].filter(Boolean);
    if (result.signal) parts.push(`signal ${result.signal}`);
    if (Number.isInteger(result.status)) parts.push(`exit ${result.status}`);
    throw new Error(parts.join('\n') || 'Midas bridge failed');
  }
  const text = output(result.stdout);
  return text ? JSON.parse(text) : {};
}

function cleanEvent(event) {
  return {
    id: event.id,
    at: event.at,
    harness: event.harness,
    session_id: event.session_id,
    project_id: event.project_id,
    branch: event.branch,
    revision_sha: event.revision_sha,
    repo_path: event.repo_path,
    type: event.type,
    content: event.content,
    source: event.source,
  };
}

export function createMidasAdapter({
  execute = defaultExecute,
  databasePath = null,
} = {}) {
  let dbPath = databasePath;
  let latestEpoch = null;
  const projects = new Map();

  function run(payload) {
    return execute(payload);
  }

  return {
    metadata: {
      candidate: {
        name: 'Midas',
        version: VERSION,
        source_revision: SOURCE_REVISION,
      },
      adapter_revision: 'midas-sdk-v1',
      network_required: false,
    },

    async reset() {
      latestEpoch = null;
      projects.clear();
    },

    async setup(prepared) {
      if (!dbPath) {
        dbPath = join(dirname(prepared.current.repo_path), '.memory-ratchet-midas.sqlite3');
      }
      projects.set(prepared.current.project_id, prepared.current.repo_path);
      for (const event of prepared.events ?? []) {
        if (!projects.has(event.project_id)) projects.set(event.project_id, event.repo_path);
      }
      return run({
        op: 'setup',
        db_path: dbPath,
        projects: [...projects].map(([project_id, repo_path]) => ({ project_id, repo_path })),
      });
    },

    async ingest(event) {
      const epoch = Date.parse(event.at) / 1000;
      if (Number.isFinite(epoch)) latestEpoch = latestEpoch === null ? epoch : Math.max(latestEpoch, epoch);
      return run({
        op: 'ingest',
        db_path: dbPath,
        event: cleanEvent(event),
      });
    },

    async recall(request) {
      const payload = run({
        op: 'recall',
        db_path: dbPath,
        query: request.query,
        project_id: request.project_id,
        branch: request.branch,
        revision_sha: request.revision_sha,
        limit: request.limit ?? 10,
        now: latestEpoch,
        guard_uses: GUARD_USES,
      });
      return {
        ...payload,
        items: payload.hits ?? [],
      };
    },

    async inspectState() {
      return {
        database_path: dbPath,
        projects: Object.fromEntries(projects),
        latest_epoch: latestEpoch,
      };
    },

    async teardown() {
      // SQLite lifecycle is owned by the fixture root.
    },
  };
}
