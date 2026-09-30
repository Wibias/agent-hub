import { lstat, rm } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MEMORY_EMBEDDING_IPC_V1 = 'memory.embedding.v1';

const DEFAULT_TIMEOUT_MS = 750;
const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_PASSAGES = 64;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNonEmptyString(value, name) {
  if (!nonEmpty(value)) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertDimensions(value) {
  if (!Number.isInteger(value) || value < 1 || value > 16_384) {
    throw new RangeError('dimensions must be a positive integer');
  }
}

function assertTimeout(value) {
  if (!Number.isInteger(value) || value < 1 || value > 60_000) {
    throw new RangeError('timeoutMs must be an integer between 1 and 60000');
  }
}

function validateEmbedder(embedder) {
  if (!embedder || typeof embedder !== 'object') {
    throw new TypeError('embedder must be an object');
  }
  assertNonEmptyString(embedder.modelId, 'embedder modelId');
  assertNonEmptyString(embedder.modelRevision, 'embedder modelRevision');
  assertDimensions(embedder.dimensions);
  if (typeof embedder.embedQuery !== 'function') {
    throw new TypeError('embedder embedQuery must be a function');
  }
  if (typeof embedder.embedPassages !== 'function') {
    throw new TypeError('embedder embedPassages must be a function');
  }
}

function validateText(value, name) {
  assertNonEmptyString(value, name);
  if (Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES) {
    throw new RangeError(`${name} exceeds the embedding IPC text limit`);
  }
  return value;
}

function validatePassages(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PASSAGES) {
    throw new RangeError(
      `passages must contain between 1 and ${MAX_PASSAGES} entries`,
    );
  }
  return value.map((item, index) => validateText(item, `passages[${index}]`));
}

function validateVector(vector, dimensions, name) {
  if (!(vector instanceof Float32Array)) {
    throw new TypeError(`${name} must be a Float32Array`);
  }
  if (vector.length !== dimensions) {
    throw new RangeError(`${name} dimensions do not match`);
  }
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${name} values must be finite`);
    }
  }
  return vector;
}

function vectorFromJson(value, dimensions, name) {
  if (!Array.isArray(value) || value.length !== dimensions) {
    throw new RangeError(`${name} dimensions do not match`);
  }
  const vector = Float32Array.from(value);
  return validateVector(vector, dimensions, name);
}

function safeErrorResponse(requestId) {
  return {
    protocol: MEMORY_EMBEDDING_IPC_V1,
    request_id: requestId,
    ok: false,
    error: {
      code: 'embedding_operation_failed',
      message: 'Embedding operation failed.',
    },
  };
}

function successResponse(requestId, embedder, vectors) {
  return {
    protocol: MEMORY_EMBEDDING_IPC_V1,
    request_id: requestId,
    ok: true,
    result: {
      model_id: embedder.modelId,
      model_revision: embedder.modelRevision,
      dimensions: embedder.dimensions,
      vectors: vectors.map((vector) => [...vector]),
    },
  };
}

function responseLine(value) {
  return `${JSON.stringify(value)}\n`;
}

function validateResponseEnvelope(response, {
  requestId,
  modelId,
  modelRevision,
  dimensions,
}) {
  if (
    !response
    || typeof response !== 'object'
    || response.protocol !== MEMORY_EMBEDDING_IPC_V1
    || response.request_id !== requestId
  ) {
    throw new Error('embedding worker returned an invalid response');
  }
  if (response.ok !== true) {
    throw new Error('embedding worker request failed');
  }

  const result = response.result;
  if (
    !result
    || typeof result !== 'object'
    || result.model_id !== modelId
    || result.model_revision !== modelRevision
    || result.dimensions !== dimensions
  ) {
    throw new Error('embedding worker model identity mismatch');
  }
  if (!Array.isArray(result.vectors)) {
    throw new Error('embedding worker returned invalid vectors');
  }
  return result.vectors;
}

export function defaultEmbeddingIpcPath({
  platform = process.platform,
  env = process.env,
  tmpDir = tmpdir(),
  uid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  if (platform === 'win32') {
    return '\\\\.\\pipe\\agent-hub-memory-embedding-v1';
  }

  const base = nonEmpty(env.XDG_RUNTIME_DIR)
    ? env.XDG_RUNTIME_DIR.trim()
    : tmpDir;
  const userKey = Number.isInteger(uid) ? String(uid) : 'user';
  return join(base, `agent-hub-memory-embedding-${userKey}.sock`);
}

async function removeStaleUnixSocket(socketPath, platform = process.platform) {
  if (platform === 'win32') return;

  let stat;
  try {
    stat = await lstat(socketPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  if (!stat.isSocket()) {
    throw new Error('embedding IPC path exists and is not a socket');
  }
  await rm(socketPath, { force: true });
}

async function handleRequest(request, embedder) {
  const requestId = nonEmpty(request?.request_id)
    ? request.request_id
    : null;

  try {
    if (
      !request
      || typeof request !== 'object'
      || request.protocol !== MEMORY_EMBEDDING_IPC_V1
      || !nonEmpty(requestId)
      || !nonEmpty(request.operation)
      || !request.payload
      || typeof request.payload !== 'object'
      || Array.isArray(request.payload)
    ) {
      throw new Error('invalid embedding request');
    }

    let vectors;
    if (request.operation === 'embed_query') {
      const text = validateText(request.payload.text, 'query');
      const vector = await embedder.embedQuery(text);
      vectors = [validateVector(vector, embedder.dimensions, 'query vector')];
    } else if (request.operation === 'embed_passages') {
      const passages = validatePassages(request.payload.passages);
      vectors = await embedder.embedPassages(passages);
      if (!Array.isArray(vectors) || vectors.length !== passages.length) {
        throw new Error('embedPassages returned an invalid vector count');
      }
      vectors = vectors.map((vector, index) => validateVector(
        vector,
        embedder.dimensions,
        `passage vector ${index}`,
      ));
    } else {
      throw new Error('unsupported embedding operation');
    }

    return successResponse(requestId, embedder, vectors);
  } catch {
    return safeErrorResponse(requestId);
  }
}

export async function startEmbeddingIpcServer({
  socketPath = defaultEmbeddingIpcPath(),
  embedder,
  platform = process.platform,
} = {}) {
  assertNonEmptyString(socketPath, 'socketPath');
  validateEmbedder(embedder);
  await removeStaleUnixSocket(socketPath, platform);

  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    let raw = '';
    let handled = false;

    const failAndClose = (requestId = null) => {
      if (handled) return;
      handled = true;
      socket.end(responseLine(safeErrorResponse(requestId)));
    };

    socket.on('data', (chunk) => {
      if (handled) return;
      raw += chunk;
      if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) {
        failAndClose();
        return;
      }

      const newline = raw.indexOf('\n');
      if (newline === -1) return;
      handled = true;

      let request;
      try {
        request = JSON.parse(raw.slice(0, newline));
      } catch {
        socket.end(responseLine(safeErrorResponse(null)));
        return;
      }

      void handleRequest(request, embedder)
        .then((response) => socket.end(responseLine(response)))
        .catch(() => socket.end(responseLine(safeErrorResponse(
          nonEmpty(request?.request_id) ? request.request_id : null,
        ))));
    });

    socket.on('error', () => {
      // One failed local client must not terminate the worker.
    });
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(socketPath);
  });

  return {
    socketPath,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      if (platform !== 'win32') {
        await rm(socketPath, { force: true });
      }
    },
  };
}

function requestEmbedding({
  socketPath,
  timeoutMs,
  request,
  modelId,
  modelRevision,
  dimensions,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let raw = '';

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback(value);
    };

    const unavailable = () => finish(
      reject,
      new Error('embedding worker unavailable'),
    );

    const socket = createConnection(socketPath);
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      socket.write(responseLine(request));
    });

    socket.on('timeout', unavailable);
    socket.on('error', unavailable);

    socket.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) {
        finish(reject, new Error('embedding worker returned an invalid response'));
        return;
      }

      const newline = raw.indexOf('\n');
      if (newline === -1) return;

      let response;
      try {
        response = JSON.parse(raw.slice(0, newline));
      } catch {
        finish(reject, new Error('embedding worker returned an invalid response'));
        return;
      }

      try {
        const vectors = validateResponseEnvelope(response, {
          requestId: request.request_id,
          modelId,
          modelRevision,
          dimensions,
        });
        finish(resolve, vectors);
      } catch (error) {
        finish(reject, error);
      }
    });

    socket.on('end', () => {
      if (!settled) unavailable();
    });
  });
}

export function createEmbeddingIpcClient({
  socketPath = defaultEmbeddingIpcPath(),
  modelId,
  modelRevision,
  dimensions,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  assertNonEmptyString(socketPath, 'socketPath');
  assertNonEmptyString(modelId, 'modelId');
  assertNonEmptyString(modelRevision, 'modelRevision');
  assertDimensions(dimensions);
  assertTimeout(timeoutMs);

  let requestCounter = 0;
  const nextRequestId = () => {
    requestCounter += 1;
    return `embedding:${process.pid}:${requestCounter}`;
  };

  const run = async (operation, payload) => {
    const requestId = nextRequestId();
    return requestEmbedding({
      socketPath,
      timeoutMs,
      request: {
        protocol: MEMORY_EMBEDDING_IPC_V1,
        operation,
        request_id: requestId,
        payload,
      },
      modelId,
      modelRevision,
      dimensions,
    });
  };

  return {
    modelId,
    modelRevision,
    dimensions,

    async embedQuery(text) {
      validateText(text, 'query');
      const vectors = await run('embed_query', { text });
      if (vectors.length !== 1) {
        throw new Error('embedding worker returned an invalid query vector count');
      }
      return vectorFromJson(vectors[0], dimensions, 'query vector');
    },

    async embedPassages(passages) {
      const normalized = validatePassages(passages);
      const vectors = await run('embed_passages', {
        passages: normalized,
      });
      if (vectors.length !== normalized.length) {
        throw new Error('embedding worker returned an invalid passage vector count');
      }
      return vectors.map((vector, index) => vectorFromJson(
        vector,
        dimensions,
        `passage vector ${index}`,
      ));
    },
  };
}
