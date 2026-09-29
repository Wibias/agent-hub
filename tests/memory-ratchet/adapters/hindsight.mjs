import { openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const VERSION = '0.10.1';
const SOURCE_REVISION = 'f8950b0c07d9e34c76493dba802bb309f0ce60fd';
const BASE_URL = 'http://127.0.0.1:8888';

let sharedRuntimePromise = null;

function branchTag(branch) {
  return `branch:${branch}`;
}

function bankPath(projectId, suffix = '') {
  return `/v1/default/banks/${encodeURIComponent(projectId)}${suffix}`;
}

async function waitForHealth(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Hindsight did not become ready: ${lastError?.message ?? 'timeout'}`);
}

async function startSharedRuntime() {
  if (sharedRuntimePromise) return sharedRuntimePromise;

  sharedRuntimePromise = (async () => {
    const python = process.env.HINDSIGHT_PYTHON ?? 'python3';
    const logRoot = process.env.RUNNER_TEMP ?? tmpdir();
    const stdoutPath = join(logRoot, 'memory-ratchet-hindsight.stdout.log');
    const stderrPath = join(logRoot, 'memory-ratchet-hindsight.stderr.log');
    const stdoutFd = openSync(stdoutPath, 'a');
    const stderrFd = openSync(stderrPath, 'a');

    const env = {
      ...process.env,
      HINDSIGHT_API_HOST: '127.0.0.1',
      HINDSIGHT_API_PORT: '8888',
      HINDSIGHT_API_LOG_LEVEL: 'warning',
      HINDSIGHT_API_DATABASE_URL: `pg0://memory-ratchet-hindsight-${process.pid}`,
      HINDSIGHT_API_LLM_PROVIDER: 'none',
      HINDSIGHT_API_RETAIN_EXTRACTION_MODE: 'chunks',
      HINDSIGHT_API_EMBEDDINGS_PROVIDER: 'onnx',
      HINDSIGHT_API_RERANKER_PROVIDER: 'rrf',
    };

    const child = spawn(python, ['-m', 'hindsight_api.main'], {
      env,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
    closeSync(stdoutFd);
    closeSync(stderrFd);

    let exited = null;
    child.once('exit', (code, signal) => {
      exited = { code, signal };
    });

    child.unref();
    process.once('exit', () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // Best-effort cleanup only.
      }
    });

    await waitForHealth().catch((error) => {
      if (exited) {
        throw new Error(
          `${error.message}; server exited code=${exited.code} signal=${exited.signal}; logs: ${stderrPath}`,
        );
      }
      throw new Error(`${error.message}; logs: ${stderrPath}`);
    });

    return {
      async start() {
        return { base_url: BASE_URL };
      },

      async request(method, path, body) {
        const response = await fetch(`${BASE_URL}${path}`, {
          method,
          headers: body === undefined ? undefined : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
        const text = await response.text();
        let payload;
        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          payload = { raw: text };
        }

        if (method === 'DELETE' && response.status === 404) return payload;
        if (!response.ok) {
          throw new Error(
            `Hindsight ${method} ${path} failed with HTTP ${response.status}: ${text}`,
          );
        }
        return payload;
      },

      async stop() {
        // Shared server remains alive across cases. setup() resets the candidate
        // banks through Hindsight's own API before every case.
      },
    };
  })();

  return sharedRuntimePromise;
}

function cleanMetadata(event) {
  return {
    event_id: event.id,
    harness: event.harness,
    session_id: event.session_id,
    project_id: event.project_id,
    branch: event.branch,
    revision_sha: event.revision_sha,
    repo_path: event.repo_path,
    event_type: event.type,
    source: event.source,
  };
}

export function createHindsightAdapter({ runtime = null } = {}) {
  let activeRuntime = runtime;
  let latestTimestamp = null;
  const projects = new Set();

  async function ensureRuntime() {
    if (!activeRuntime) activeRuntime = await startSharedRuntime();
    return activeRuntime;
  }

  return {
    metadata: {
      candidate: {
        name: 'Hindsight',
        version: VERSION,
        source_revision: SOURCE_REVISION,
      },
      adapter_revision: 'hindsight-rest-v1',
      network_required: false,
    },

    async reset() {
      latestTimestamp = null;
      projects.clear();
    },

    async setup(prepared) {
      const rt = await ensureRuntime();
      await rt.start(prepared);

      projects.add(prepared.current.project_id);
      for (const event of prepared.events ?? []) projects.add(event.project_id);

      for (const projectId of [...projects].sort()) {
        await rt.request('DELETE', bankPath(projectId));
        await rt.request('PUT', bankPath(projectId), {});
      }
    },

    async ingest(event) {
      const rt = await ensureRuntime();
      if (event.at && (!latestTimestamp || event.at > latestTimestamp)) {
        latestTimestamp = event.at;
      }

      const item = {
        content: event.content,
        timestamp: event.at,
        document_id: event.id,
        metadata: cleanMetadata(event),
        tags: [branchTag(event.branch)],
      };

      return rt.request('POST', bankPath(event.project_id, '/memories'), {
        items: [item],
        async: false,
      });
    },

    async recall(request) {
      const rt = await ensureRuntime();
      const payload = await rt.request(
        'POST',
        bankPath(request.project_id, '/memories/recall'),
        {
          query: request.query,
          max_tokens: 4096,
          budget: 'mid',
          query_timestamp: latestTimestamp,
          tags: [branchTag(request.branch)],
          tags_match: 'all_strict',
        },
      );
      return {
        ...payload,
        items: Array.isArray(payload?.results) ? payload.results : [],
      };
    },

    async inspectState() {
      return {
        projects: [...projects].sort(),
        latest_timestamp: latestTimestamp,
      };
    },

    async teardown() {
      const rt = await ensureRuntime();
      await rt.stop();
    },
  };
}
