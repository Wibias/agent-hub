import { spawnSync } from 'node:child_process';

const MEMSPEC_VERSION = '0.11.0';
const MEMSPEC_SOURCE_REVISION = '7c0a47f36d75585db0701b9828592433a0fa1c7b';
const MEMORY_ID = /ms_[A-Z0-9]{26}/g;

function outputText(value) {
  if (typeof value === 'string') return value.trim();
  if (Buffer.isBuffer(value)) return value.toString('utf8').trim();
  return '';
}

export function formatExecFailure(error) {
  const parts = [];
  const stderr = outputText(error?.stderr);
  const stdout = outputText(error?.stdout);
  if (stderr) parts.push(`stderr: ${stderr}`);
  if (stdout) parts.push(`stdout: ${stdout}`);
  if (typeof error?.signal === 'string' && error.signal.length > 0) parts.push(`signal ${error.signal}`);
  if (Number.isInteger(error?.status)) parts.push(`exit ${error.status}`);
  if (parts.length === 0) parts.push(typeof error?.message === 'string' ? error.message : String(error));
  return parts.join('\n');
}

export function executeMemspec(args, {
  spawn = spawnSync,
  bin = process.env.MEMSPEC_BIN ?? 'memspec',
} = {}) {
  const result = spawn(bin, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new Error(formatExecFailure({
      ...result,
      message: result.error.message,
    }), { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(formatExecFailure({
      ...result,
      message: `memspec exited with status ${result.status}`,
    }));
  }
  return outputText(result.stdout);
}

function defaultExecute(args) {
  return executeMemspec(args);
}

function titleFor(event) {
  const first = String(event.content ?? '').split(/\r?\n/, 1)[0].trim();
  const title = first.length > 0 ? first : event.type;
  return title.slice(0, 120);
}

function typeFor(event) {
  switch (event.type) {
    case 'decision':
    case 'rejection':
    case 'approval':
      return 'decision';
    default:
      return 'fact';
  }
}

function repositoryRelativeSource(source) {
  if (typeof source !== 'string' || source.length === 0) return null;
  if (source.includes(':') || source.startsWith('/') || source.startsWith('\\')) return null;
  if (!source.includes('/')) return null;
  return source;
}

function firstMemoryId(text) {
  const ids = String(text).match(MEMORY_ID) ?? [];
  if (ids.length === 0) throw new Error(`memspec output did not contain a memory id: ${text}`);
  return ids[0];
}

function replacementMemoryId(text) {
  const match = String(text).match(/→\s*(ms_[A-Z0-9]{26})/u);
  if (!match) throw new Error(`memspec supersede output did not contain a replacement id: ${text}`);
  return match[1];
}

function sourceFor(event) {
  return typeof event.source === 'string' && event.source.length > 0
    ? event.source
    : `${event.harness ?? 'agent'}:${event.session_id ?? event.id}`;
}

export function createMemspecAdapter({ execute = defaultExecute } = {}) {
  const eventToMemory = new Map();
  const initialisedRoots = new Set();

  function run(args) {
    return execute(args);
  }

  function remember(event, extra = []) {
    const args = [
      'remember',
      typeFor(event),
      titleFor(event),
      '--cwd',
      event.repo_path,
      '--body',
      event.content,
      '--source',
      sourceFor(event),
    ];

    const anchor = repositoryRelativeSource(event.source);
    if (anchor) args.push('--anchor', anchor);

    const conflictTargets = event.relations?.conflicts_with ?? [];
    const conflicts = conflictTargets
      .map((eventId) => eventToMemory.get(eventId))
      .filter(Boolean);
    if (conflicts.length > 0) args.push('--conflicts-with', ...conflicts);

    args.push(...extra);
    const output = run(args);
    const id = firstMemoryId(output);
    eventToMemory.set(event.id, id);
    return { id, output };
  }

  return {
    metadata: {
      candidate: {
        name: 'memspec',
        version: MEMSPEC_VERSION,
        source_revision: MEMSPEC_SOURCE_REVISION,
      },
      adapter_revision: 'memspec-core-v1',
      network_required: false,
    },

    async reset() {
      eventToMemory.clear();
      initialisedRoots.clear();
    },

    async setup(prepared) {
      const roots = new Set([
        prepared.current?.repo_path,
        ...(prepared.events ?? []).map((event) => event.repo_path),
      ].filter(Boolean));

      for (const root of roots) {
        if (initialisedRoots.has(root)) continue;
        run([
          'init',
          '--cwd',
          root,
          '--no-interactive',
          '--skip-import',
          '--skip-patch',
          '--no-install-hooks',
        ]);
        initialisedRoots.add(root);
      }
    },

    async ingest(event) {
      const supersedes = event.relations?.supersedes ?? [];
      if (supersedes.length > 0) {
        const targetIds = supersedes.map((eventId) => {
          const id = eventToMemory.get(eventId);
          if (!id) throw new Error(`${event.id} supersedes unknown event ${eventId}`);
          return id;
        });

        const args = [
          'supersede',
          targetIds[0],
          '--cwd',
          event.repo_path,
          '--reason',
          `Superseded by ${event.id}: ${event.content}`,
          '--body',
          event.content,
          '--title',
          titleFor(event),
          '--source',
          sourceFor(event),
        ];
        if (targetIds.length > 1) args.push('--merge-from', targetIds.slice(1).join(','));

        const output = run(args);
        const id = replacementMemoryId(output);
        eventToMemory.set(event.id, id);
        return { id, output };
      }

      const rejects = event.relations?.rejects ?? [];
      for (const rejectedEventId of rejects) {
        const rejectedId = eventToMemory.get(rejectedEventId);
        if (!rejectedId) throw new Error(`${event.id} rejects unknown event ${rejectedEventId}`);
        run([
          'supersede',
          rejectedId,
          '--cwd',
          event.repo_path,
          '--reason',
          `Rejected by ${event.id}: ${event.content}`,
          '--source',
          sourceFor(event),
        ]);
      }

      return remember(event);
    },

    async recall(request) {
      const limit = request.limit ?? 10;
      const output = run([
        'search',
        request.query,
        '--cwd',
        request.repo_path,
        '--limit',
        String(limit),
        '--json',
        '--full',
      ]);
      const payload = JSON.parse(output);
      return {
        ...payload,
        items: payload.results ?? [],
      };
    },

    async exportMemory(request) {
      return run([
        'export',
        '--cwd',
        request.repo_path,
        '--format',
        'jsonl',
        '--include-superseded',
      ]);
    },

    async inspectState() {
      return {
        event_to_memory: Object.fromEntries(eventToMemory),
        initialised_roots: [...initialisedRoots],
      };
    },

    async teardown() {
      // Fixture roots are unique per case. Cleanup is owned by the benchmark
      // runner so the adapter cannot hide candidate state before scoring.
    },
  };
}
