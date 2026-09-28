import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const VERSION = '5.0.0';
const SOURCE_REVISION = 'e7cc087666fd3d01a5727f8a67e7b9e745fca904';

function text(value) {
  if (typeof value === 'string') return value.trim();
  if (Buffer.isBuffer(value)) return value.toString('utf8').trim();
  return '';
}

function executeKage(args) {
  const result = spawnSync(process.env.KAGE_BIN ?? 'kage', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const parts = [text(result.stderr), text(result.stdout)].filter(Boolean);
    if (result.signal) parts.push(`signal ${result.signal}`);
    if (Number.isInteger(result.status)) parts.push(`exit ${result.status}`);
    throw new Error(parts.join('\n') || 'kage command failed');
  }
  return text(result.stdout);
}

function memoryType(event) {
  switch (event.type) {
    case 'decision':
    case 'rejection':
    case 'approval':
      return 'decision';
    case 'tool_result':
    case 'code_observation':
    case 'document_read':
    case 'noise_memory':
    case 'noise_session':
    case 'candidate_memory':
    case 'inference':
    case 'proposal':
    default:
      return 'reference';
  }
}

function repoPath(source) {
  if (typeof source !== 'string') return null;
  if (source.includes(':') || source.startsWith('/') || source.startsWith('\\')) return null;
  return source.includes('/') ? source : null;
}

export function parsePacketId(document) {
  const frontmatter = String(document).match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
  const textBlock = frontmatter?.[1] ?? String(document);
  const match = textBlock.match(/^x-kage-id:\s*["']?([^"'\r\n]+)["']?\s*$/m);
  if (!match) throw new Error('Kage packet does not contain x-kage-id');
  return match[1].trim();
}

function defaultPacketIdFromOutput(output, event) {
  const match = String(output).match(/Captured (?:session|repo-local|personal) learning:\s*(.+)$/m);
  if (!match) throw new Error(`Kage learn output did not name a packet path: ${output}`);
  const rawPath = match[1].trim();
  const packetPath = isAbsolute(rawPath) ? rawPath : resolve(event.repo_path, rawPath);
  return parsePacketId(readFileSync(packetPath, 'utf8'));
}

export function createKageAdapter({
  execute = executeKage,
  packetIdFromOutput = defaultPacketIdFromOutput,
} = {}) {
  const eventToPacket = new Map();
  const initialised = new Set();

  function run(args) {
    return execute(args);
  }

  function learn(event) {
    const args = [
      'learn',
      '--project',
      event.repo_path,
      '--learning',
      event.content,
      '--type',
      memoryType(event),
    ];
    const path = repoPath(event.source);
    if (path) args.push('--paths', path);

    const output = run(args);
    const packetId = packetIdFromOutput(output, event);
    eventToPacket.set(event.id, packetId);
    return { packetId, output };
  }

  return {
    metadata: {
      candidate: {
        name: 'Kage',
        version: VERSION,
        source_revision: SOURCE_REVISION,
      },
      adapter_revision: 'kage-core-v1',
      network_required: false,
    },

    async reset() {
      eventToPacket.clear();
      initialised.clear();
    },

    async setup(prepared) {
      const roots = new Set([
        prepared.current?.repo_path,
        ...(prepared.events ?? []).map((event) => event.repo_path),
      ].filter(Boolean));
      for (const root of roots) {
        if (initialised.has(root)) continue;
        run(['init', '--project', root]);
        initialised.add(root);
      }
    },

    async ingest(event) {
      const created = learn(event);

      for (const relation of ['supersedes', 'rejects']) {
        for (const targetEvent of event.relations?.[relation] ?? []) {
          const oldId = eventToPacket.get(targetEvent);
          if (!oldId) throw new Error(`${event.id} references unknown event ${targetEvent}`);
          run([
            'supersede',
            '--project',
            event.repo_path,
            '--packet',
            oldId,
            '--replacement',
            created.packetId,
            '--reason',
            `${relation} by ${event.id}`,
            '--json',
          ]);
        }
      }
      return created;
    },

    async recall(request) {
      const args = [
        'recall',
        request.query,
        '--project',
        request.repo_path,
        '--limit',
        String(request.limit ?? 10),
        '--json',
      ];
      const payload = JSON.parse(run(args));
      return {
        ...payload,
        items: payload.memories ?? payload.results ?? payload.packets ?? [],
      };
    },

    async inspectState() {
      return { event_to_packet: Object.fromEntries(eventToPacket) };
    },

    async teardown() {
      // Fixture lifecycle belongs to the benchmark runner.
    },
  };
}
