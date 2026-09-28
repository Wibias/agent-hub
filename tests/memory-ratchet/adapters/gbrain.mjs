import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const VERSION = '0.59.3.0';
const SOURCE_REVISION = '6bb88d128d70fef364444ec71f449f5a2cbd45ee';

function output(value) {
  if (typeof value === 'string') return value.trim();
  if (Buffer.isBuffer(value)) return value.toString('utf8').trim();
  return '';
}

function executeGBrain(args, options = {}) {
  const result = spawnSync(process.env.GBRAIN_BIN ?? 'gbrain', args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NO_COLOR: '1',
      TERM: 'dumb',
      ...(options.env ?? {}),
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const parts = [output(result.stderr), output(result.stdout)].filter(Boolean);
    if (result.signal) parts.push(`signal ${result.signal}`);
    if (Number.isInteger(result.status)) parts.push(`exit ${result.status}`);
    throw new Error(parts.join('\n') || 'gbrain command failed');
  }
  return output(result.stdout);
}

function kindFor(event) {
  switch (event.type) {
    case 'decision':
    case 'rejection':
    case 'approval':
      return 'commitment';
    case 'proposal':
    case 'inference':
    case 'noise_memory':
    case 'noise_session':
    case 'candidate_memory':
      return 'belief';
    default:
      return 'fact';
  }
}

function provenanceFor(event) {
  const pieces = [
    event.source,
    event.harness ? `harness=${event.harness}` : null,
    event.session_id ? `session=${event.session_id}` : null,
    event.branch ? `branch=${event.branch}` : null,
    event.revision_sha ? `commit=${event.revision_sha}` : null,
  ].filter(Boolean);
  return pieces.join(' | ').slice(0, 500);
}

export function createGBrainAdapter({
  execute = executeGBrain,
  brainHome = null,
} = {}) {
  let home = brainHome;
  const sources = new Map();

  function run(args, { cwd, source } = {}) {
    if (!home) throw new Error('GBrain adapter is not set up');
    return execute(args, {
      cwd,
      env: {
        GBRAIN_HOME: home,
        ...(source ? { GBRAIN_SOURCE: source } : {}),
      },
    });
  }

  return {
    metadata: {
      candidate: {
        name: 'GBrain',
        version: VERSION,
        source_revision: SOURCE_REVISION,
      },
      adapter_revision: 'gbrain-verbs-v1',
      network_required: false,
    },

    async reset() {
      sources.clear();
      // Every benchmark case receives a new fixture root. The default brain
      // home therefore starts clean without adapter-side data deletion.
    },

    async setup(prepared) {
      if (!home) {
        home = join(dirname(prepared.current.repo_path), '.memory-ratchet-gbrain');
      }

      run([
        'init',
        '--pglite',
        '--no-embedding',
        '--db-only',
      ], { cwd: dirname(prepared.current.repo_path) });

      const projects = new Map();
      projects.set(prepared.current.project_id, prepared.current.repo_path);
      for (const event of prepared.events ?? []) {
        if (!projects.has(event.project_id)) projects.set(event.project_id, event.repo_path);
      }

      for (const [projectId, repoPath] of projects) {
        run([
          'sources',
          'add',
          projectId,
          '--path',
          repoPath,
          '--no-federated',
          '--no-harden',
        ], { cwd: repoPath });
        sources.set(projectId, repoPath);
      }
    },

    async ingest(event) {
      const raw = run([
        'remember',
        event.content,
        '--provenance',
        provenanceFor(event),
        '--kind',
        kindFor(event),
        '--visibility',
        'world',
        '--json',
      ], {
        cwd: event.repo_path,
        source: event.project_id,
      });
      return JSON.parse(raw);
    },

    async recall(request) {
      const raw = run([
        'recall',
        '--query',
        request.query,
        '--source',
        request.project_id,
        '--limit',
        String(request.limit ?? 10),
        '--budget-tokens',
        '2048',
        '--json',
      ], {
        cwd: request.repo_path,
      });
      const payload = JSON.parse(raw);
      return {
        ...payload,
        items: Array.isArray(payload.facts) ? payload.facts : [],
      };
    },

    async inspectState() {
      return {
        brain_home: home,
        sources: Object.fromEntries(sources),
      };
    },

    async teardown() {
      // PGLite lifetime is the fixture lifetime.
    },
  };
}
