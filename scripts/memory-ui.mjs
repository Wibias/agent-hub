#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  defaultCodexMemoryDbPath,
  runCodexMemoryHook,
} from '../memory-engine/adapters/codex-hook-cli.mjs';
import {
  createCodexMemoryHookAdapter,
} from '../memory-engine/adapters/codex-hooks.mjs';
import { MemoryEngine } from '../memory-engine/index.mjs';
import {
  inspectCodexIntegration,
  inspectEmbeddingWorker,
  inspectMemoryDatabase,
} from '../memory-engine/memory-doctor.mjs';
import {
  memoryUiClaim,
  memoryUiOverview,
  memoryUiScope,
} from '../memory-engine/memory-ui-model.mjs';

const DEFAULT_PORT = 4317;
const HOST = '127.0.0.1';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = resolve(SCRIPT_DIR, '..', 'memory-ui');

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
});

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function integerPort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('port must be an integer between 1 and 65535');
  }
  return parsed;
}

export function parseMemoryUiArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  const result = {
    port: DEFAULT_PORT,
    dbPath: defaultCodexMemoryDbPath(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port') {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error('--port requires a value');
      result.port = integerPort(value);
      index += 1;
      continue;
    }
    if (arg === '--db-path') {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error('--db-path requires a value');
      result.dbPath = resolve(value);
      index += 1;
      continue;
    }
    throw new Error('unknown argument: ' + arg);
  }

  return result;
}

function json(res, statusCode, value) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    'Content-Type': MIME['.json'],
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function errorPayload(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    error: 'memory_console_error',
    message,
  };
}

function queryValue(url, key) {
  const value = url.searchParams.get(key);
  return nonEmpty(value) ? value.trim() : null;
}

function validClaimRef(value) {
  return typeof value === 'string' && /^@[0-9a-f]{10}$/i.test(value.trim());
}

function validCandidateRef(value) {
  return typeof value === 'string' && /^~[0-9a-f]{10}$/i.test(value.trim());
}

async function readJsonBody(req, {
  maxBytes = 16_384,
} = {}) {
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    const error = new Error('Action requests must use application/json.');
    error.statusCode = 415;
    throw error;
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error('Action request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const error = new Error('Action request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error('Action request body must be a JSON object.');
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function actionCommand(pathname, payload) {
  if (!nonEmpty(payload.projectId) || !nonEmpty(payload.branch)) {
    const error = new Error('projectId and branch are required.');
    error.statusCode = 400;
    throw error;
  }

  if (pathname === '/api/actions/forget') {
    if (!validClaimRef(payload.claimRef)) {
      const error = new Error('claimRef must be a stable memory ref.');
      error.statusCode = 400;
      throw error;
    }
    return 'memory forget: ' + payload.claimRef.trim().toLowerCase();
  }

  if (pathname === '/api/actions/replace') {
    if (!validClaimRef(payload.claimRef) || !nonEmpty(payload.newValue)) {
      const error = new Error('claimRef and newValue are required.');
      error.statusCode = 400;
      throw error;
    }
    const newValue = payload.newValue.trim();
    if (!/^memory:\s*\S/i.test(newValue)) {
      const error = new Error('Replacement value must begin with "memory:".');
      error.statusCode = 400;
      throw error;
    }
    return (
      'memory replace: '
      + payload.claimRef.trim().toLowerCase()
      + ' => '
      + newValue
    );
  }

  if (pathname === '/api/actions/candidate-confirm') {
    if (!validCandidateRef(payload.candidateRef)) {
      const error = new Error('candidateRef must be a stable candidate ref.');
      error.statusCode = 400;
      throw error;
    }
    const relation = String(payload.relation ?? '').trim().toLowerCase();
    if (!['same', 'update', 'contradict', 'unrelated'].includes(relation)) {
      const error = new Error('relation must be same, update, contradict, or unrelated.');
      error.statusCode = 400;
      throw error;
    }
    if (relation === 'unrelated') {
      return (
        'memory candidate confirm: '
        + payload.candidateRef.trim().toLowerCase()
        + ' => unrelated'
      );
    }
    if (!validClaimRef(payload.targetRef)) {
      const error = new Error(relation + ' confirmation requires targetRef.');
      error.statusCode = 400;
      throw error;
    }
    return (
      'memory candidate confirm: '
      + payload.candidateRef.trim().toLowerCase()
      + ' => '
      + relation
      + ' '
      + payload.targetRef.trim().toLowerCase()
    );
  }

  if (pathname === '/api/actions/candidate-reject') {
    if (!validCandidateRef(payload.candidateRef)) {
      const error = new Error('candidateRef must be a stable candidate ref.');
      error.statusCode = 400;
      throw error;
    }
    return (
      'memory candidate reject: '
      + payload.candidateRef.trim().toLowerCase()
    );
  }

  const error = new Error('unknown Memory Console action');
  error.statusCode = 404;
  throw error;
}

function apiHeaders(res) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; "
      + "script-src 'self'; connect-src 'self'; frame-ancestors 'none';",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

async function runtimeHealth({
  dbPath,
  projectId,
  branch,
  codexHome,
}) {
  const [worker, codex] = await Promise.all([
    inspectEmbeddingWorker().catch((error) => ({
      status: 'degraded',
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    })),
    inspectCodexIntegration({ codexHome }).catch((error) => ({
      status: 'degraded',
      error: error instanceof Error ? error.message : String(error),
    })),
  ]);

  return {
    database: inspectMemoryDatabase({
      dbPath,
      projectId,
      branch,
    }),
    embedding: worker,
    codex,
  };
}

function staticFileFor(pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    return join(STATIC_DIR, 'index.html');
  }
  if (pathname === '/styles.css') return join(STATIC_DIR, 'styles.css');
  if (pathname === '/app.js') return join(STATIC_DIR, 'app.js');
  return null;
}

async function serveStatic(res, pathname) {
  const filePath = staticFileFor(pathname);
  if (filePath === null) return false;

  const body = await readFile(filePath);
  const type = MIME[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
  return true;
}

export function createMemoryUiServer({
  dbPath = defaultCodexMemoryDbPath(),
  memory = null,
  codexHome = resolve(process.env.CODEX_HOME || join(homedir(), '.codex')),
  includeRuntimeHealth = true,
} = {}) {
  if (!nonEmpty(dbPath)) throw new TypeError('dbPath must be non-empty');
  const resolvedDbPath = resolve(dbPath);
  if (!existsSync(resolvedDbPath)) {
    throw new Error('memory database not found: ' + resolvedDbPath);
  }

  const ownedMemory = memory === null;
  const engine = memory ?? new MemoryEngine({
    dbPath: resolvedDbPath,
    readOnly: true,
  });
  const actionToken = randomBytes(24).toString('hex');

  async function runAction(pathname, payload) {
    const command = actionCommand(pathname, payload);
    const project = engine.getProject(payload.projectId);
    if (!project) {
      const error = new Error('project is not registered in the memory database.');
      error.statusCode = 404;
      throw error;
    }

    memoryUiScope(engine, {
      projectId: payload.projectId,
      branch: payload.branch,
    });

    const eventId = randomUUID();
    const output = await runCodexMemoryHook({
      event: {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'memory-ui:' + eventId,
        turn_id: 'memory-ui-action:' + eventId,
        cwd: process.cwd(),
        prompt: command,
      },
      env: {
        ...process.env,
        AGENT_HUB_MEMORY_DB: resolvedDbPath,
        AGENT_HUB_MEMORY_CAPTURE_PROMPTS: 'false',
      },
      configOptions: {
        explicitMemoryRequests: true,
        candidateCapture: false,
        hybridRecall: false,
        autoPipeline: false,
      },
      resolveProjectScope: () => ({
        projectId: project.project_id,
        repoIdentity: project.repo_identity,
        canonicalRemote: project.canonical_remote,
      }),
      createAdapter: (options) => createCodexMemoryHookAdapter({
        ...options,
        git: {
          resolveContext() {
            return {
              repoPath: process.cwd(),
              branch: payload.branch,
              revisionSha: null,
            };
          },
          refreshFreshness() {},
        },
      }),
    });

    const reason = String(output?.reason ?? '');
    if (
      output?.decision !== 'block'
      || /not changed|operation failed/i.test(reason)
    ) {
      const error = new Error(reason || 'Memory action was not applied.');
      error.statusCode = 409;
      throw error;
    }

    return {
      ok: true,
      reason,
    };
  }

  const server = createServer(async (req, res) => {
    apiHeaders(res);

    try {
      const url = new URL(req.url ?? '/', `http://${HOST}`);

      if (req.method === 'POST' && url.pathname.startsWith('/api/actions/')) {
        const origin = String(req.headers.origin ?? '');
        const expectedOrigin = 'http://' + String(req.headers.host ?? '');
        if (origin && origin !== expectedOrigin) {
          json(res, 403, {
            error: 'forbidden_origin',
            message: 'Memory Console actions require same-origin requests.',
          });
          return;
        }
        if (
          req.headers['x-agent-hub-action-token'] !== actionToken
        ) {
          json(res, 403, {
            error: 'invalid_action_token',
            message: 'Memory Console action token is missing or invalid.',
          });
          return;
        }

        const payload = await readJsonBody(req);
        const result = await runAction(url.pathname, payload);
        json(res, 200, result);
        return;
      }

      if (req.method !== 'GET') {
        json(res, 405, {
          error: 'method_not_allowed',
          message: 'Unsupported Memory Console method.',
        });
        return;
      }

      if (url.pathname === '/api/overview') {
        const overview = memoryUiOverview(engine);
        overview.actions = {
          enabled: true,
          token: actionToken,
        };
        json(res, 200, overview);
        return;
      }

      if (url.pathname === '/api/scope') {
        const projectId = queryValue(url, 'projectId');
        const branch = queryValue(url, 'branch');
        if (projectId === null || branch === null) {
          json(res, 400, {
            error: 'invalid_scope',
            message: 'projectId and branch are required',
          });
          return;
        }

        const scope = memoryUiScope(engine, { projectId, branch });
        if (includeRuntimeHealth) {
          scope.runtime = await runtimeHealth({
            dbPath: resolvedDbPath,
            projectId,
            branch,
            codexHome,
          });
        }
        json(res, 200, scope);
        return;
      }

      if (url.pathname === '/api/claim') {
        const projectId = queryValue(url, 'projectId');
        const branch = queryValue(url, 'branch');
        const claimId = queryValue(url, 'claimId');
        if (projectId === null || branch === null || claimId === null) {
          json(res, 400, {
            error: 'invalid_claim',
            message: 'projectId, branch, and claimId are required',
          });
          return;
        }
        const claim = memoryUiClaim(engine, {
          projectId,
          branch,
          claimId,
        });
        if (claim === null) {
          json(res, 404, {
            error: 'claim_not_found',
            message: 'claim was not found in this project and branch',
          });
          return;
        }
        json(res, 200, claim);
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        json(res, 404, {
          error: 'not_found',
          message: 'unknown read-only Memory Console endpoint',
        });
        return;
      }

      if (await serveStatic(res, url.pathname)) return;
      const fallback = await readFile(join(STATIC_DIR, 'index.html'));
      res.writeHead(200, {
        'Content-Type': MIME['.html'],
        'Content-Length': fallback.length,
        'Cache-Control': 'no-store',
      });
      res.end(fallback);
    } catch (error) {
      json(
        res,
        Number.isInteger(error?.statusCode) ? error.statusCode : 500,
        errorPayload(error),
      );
    }
  });

  server.on('close', () => {
    if (ownedMemory && typeof engine.close === 'function') {
      engine.close();
    }
  });

  return {
    server,
    host: HOST,
    dbPath: resolvedDbPath,
  };
}

export async function runMemoryUi({
  argv = process.argv.slice(2),
  log = console.log,
} = {}) {
  const options = parseMemoryUiArgs(argv);
  const runtime = createMemoryUiServer(options);

  await new Promise((resolvePromise, rejectPromise) => {
    runtime.server.once('error', rejectPromise);
    runtime.server.listen(options.port, runtime.host, () => {
      runtime.server.off('error', rejectPromise);
      resolvePromise();
    });
  });

  const address = runtime.server.address();
  const port = typeof address === 'object' && address !== null
    ? address.port
    : options.port;
  const url = `http://${runtime.host}:${port}`;

  log(`Memory Console: ${url}`);
  log(`Database: ${runtime.dbPath}`);
  log('Mode: read-only browsing · explicit local actions · loopback only');

  return {
    ...runtime,
    port,
    url,
  };
}

async function main() {
  const runtime = await runMemoryUi();

  const shutdown = () => {
    runtime.server.close(() => {
      process.exitCode = 0;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
