import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const VERSION = '0.9.27';
const SOURCE_REVISION = 'a76224f0987ed8f3ea0e4961f3928736ded23f54';
const BASE_URL = 'http://127.0.0.1:3111';

function output(value) {
  if (typeof value === 'string') return value.trim();
  if (Buffer.isBuffer(value)) return value.toString('utf8').trim();
  return '';
}

function isRepositorySource(source) {
  return typeof source === 'string'
    && source.length > 0
    && !source.includes(':')
    && !source.startsWith('/')
    && !source.startsWith('\\')
    && source.includes('/');
}

function memoryType(event) {
  switch (event.type) {
    case 'decision':
    case 'rejection':
      return 'architecture';
    case 'approval':
      return 'workflow';
    default:
      return 'fact';
  }
}

function observedEvent(event) {
  return new Set(['tool_result', 'code_observation', 'document_read']).has(event.type);
}

function runtimeEnvironment(home, configPath) {
  return {
    ...process.env,
    HOME: home,
    CI: 'true',
    AGENTMEMORY_III_CONFIG: configPath,
    AGENTMEMORY_AUTO_COMPRESS: 'false',
    AGENTMEMORY_INJECT_CONTEXT: 'false',
    AGENTMEMORY_ALLOW_AGENT_SDK: 'false',
    CONSOLIDATION_ENABLED: 'false',
  };
}

async function waitFor(url, { timeoutMs = 60_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`agentmemory did not become ready: ${lastError?.message ?? 'timeout'}`);
}

async function waitUntilClosed(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1_000) });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function createFullServerRuntime() {
  const dist = process.env.AGENTMEMORY_DIST;
  if (!dist) {
    throw new Error('AGENTMEMORY_DIST must point to the pinned agentmemory dist directory');
  }

  let env = null;
  let runtimeRoot = null;
  let cliChild = null;

  return {
    async start(prepared) {
      runtimeRoot = join(dirname(prepared.current.repo_path), '.agentmemory-runtime');
      const home = join(runtimeRoot, 'home');
      const data = join(runtimeRoot, 'data');
      await mkdir(home, { recursive: true });
      await mkdir(data, { recursive: true });

      const bundledConfig = await readFile(join(dist, 'iii-config.yaml'), 'utf8');
      const config = bundledConfig
        .replace('./data/state_store.db', join(data, 'state_store.db'))
        .replace('./data/stream_store', join(data, 'stream_store'))
        .replace('- node dist/index.mjs', `- node ${join(dist, 'index.mjs')}`);
      const configPath = join(runtimeRoot, 'iii-config.yaml');
      await writeFile(configPath, config, 'utf8');

      env = runtimeEnvironment(home, configPath);
      cliChild = spawn(process.execPath, [join(dist, 'cli.mjs')], {
        cwd: runtimeRoot,
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      let earlyFailure = '';
      cliChild.stderr?.on('data', (chunk) => {
        if (earlyFailure.length < 16_384) earlyFailure += chunk.toString('utf8');
      });

      await waitFor(`${BASE_URL}/agentmemory/livez`).catch((error) => {
        const detail = earlyFailure.trim();
        throw new Error(detail ? `${error.message}\n${detail}` : error.message);
      });

      return { base_url: BASE_URL, runtime_root: runtimeRoot };
    },

    async request(method, path, body) {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }
      if (!response.ok) {
        throw new Error(`agentmemory ${method} ${path} failed with HTTP ${response.status}: ${text}`);
      }
      return payload;
    },

    async stop() {
      if (!env || !runtimeRoot) return;
      const stopped = spawnSync(process.execPath, [join(dist, 'cli.mjs'), 'stop', '--force'], {
        cwd: runtimeRoot,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15_000,
      });
      if (stopped.status !== 0 && cliChild && !cliChild.killed) {
        cliChild.kill('SIGTERM');
      }
      await waitUntilClosed(`${BASE_URL}/agentmemory/livez`);
      cliChild = null;
      env = null;
      runtimeRoot = null;
    },
  };
}

export function createAgentmemoryAdapter({ runtime = null } = {}) {
  let activeRuntime = runtime;
  const eventIds = new Map();

  async function ensureRuntime() {
    if (!activeRuntime) activeRuntime = await createFullServerRuntime();
    return activeRuntime;
  }

  return {
    metadata: {
      candidate: {
        name: 'agentmemory',
        version: VERSION,
        source_revision: SOURCE_REVISION,
      },
      adapter_revision: 'agentmemory-full-v1',
      network_required: false,
    },

    async reset() {
      eventIds.clear();
    },

    async setup(prepared) {
      const rt = await ensureRuntime();
      return rt.start(prepared);
    },

    async ingest(event) {
      const rt = await ensureRuntime();

      if (observedEvent(event)) {
        const observed = await rt.request('POST', '/agentmemory/observe', {
          hookType: 'post_tool_use',
          sessionId: event.session_id,
          project: event.project_id,
          cwd: event.repo_path,
          timestamp: event.at,
          data: {
            tool_name: event.source,
            tool_input: isRepositorySource(event.source)
              ? { file: event.source }
              : { event_id: event.id },
            tool_output: event.content,
          },
        });
        if (observed?.observationId) eventIds.set(event.id, observed.observationId);

        if (isRepositorySource(event.source)) {
          await rt.request('POST', '/agentmemory/session/commit', {
            sessionId: event.session_id,
            sha: event.revision_sha,
            branch: event.branch,
            repo: event.project_id,
            authoredAt: event.at,
            files: [event.source],
          });
        }
        return observed;
      }

      const body = {
        content: event.content,
        type: memoryType(event),
        project: event.project_id,
      };
      if (isRepositorySource(event.source)) body.files = [event.source];

      const saved = await rt.request('POST', '/agentmemory/remember', body);
      const id = saved?.memory?.id;
      if (id) eventIds.set(event.id, id);
      return saved;
    },

    async recall(request) {
      const rt = await ensureRuntime();
      const payload = await rt.request('POST', '/agentmemory/search', {
        query: request.query,
        project: request.project_id,
        cwd: request.repo_path,
        limit: request.limit ?? 10,
        format: 'full',
        token_budget: 4096,
      });
      return {
        ...payload,
        items: Array.isArray(payload?.results) ? payload.results : [],
      };
    },

    async inspectState() {
      return { event_ids: Object.fromEntries(eventIds) };
    },

    async teardown() {
      if (!activeRuntime) return;
      await activeRuntime.stop();
      if (!runtime) activeRuntime = null;
    },
  };
}
