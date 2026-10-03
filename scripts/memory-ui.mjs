#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  defaultCodexMemoryDbPath,
} from '../memory-engine/adapters/codex-hook-cli.mjs';
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
  const engine = memory ?? new MemoryEngine({ dbPath: resolvedDbPath });

  const server = createServer(async (req, res) => {
    apiHeaders(res);

    try {
      if (req.method !== 'GET') {
        json(res, 405, {
          error: 'method_not_allowed',
          message: 'Memory Console is read-only.',
        });
        return;
      }

      const url = new URL(req.url ?? '/', `http://${HOST}`);

      if (url.pathname === '/api/overview') {
        json(res, 200, memoryUiOverview(engine));
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
      json(res, 500, errorPayload(error));
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
  log('Mode: read-only · loopback only');

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
