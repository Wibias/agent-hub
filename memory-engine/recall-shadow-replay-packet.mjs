import { createHash } from 'node:crypto';

const PACKET_SCHEMA_VERSION = 1;
const PACKET_TYPE = 'recall_shadow_replay_packet';
const FAST_ROUTES = new Set(['fast_v1', 'fast_v2', 'fallback']);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireNonEmptyString(value, name) {
  if (!nonEmptyString(value)) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function cloneJsonSafe(value, path = 'value', seen = new Set()) {
  if (value === null) return null;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`${path} must contain only finite JSON-safe numbers`);
      }
      return value;
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new TypeError(`${path} must be JSON-safe; ${typeof value} is unsupported`);
    case 'object':
      break;
    default:
      throw new TypeError(`${path} must be JSON-safe`);
  }

  if (seen.has(value)) {
    throw new TypeError(`${path} must be JSON-safe and non-cyclic`);
  }
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => cloneJsonSafe(entry, `${path}[${index}]`, seen));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only JSON-safe plain objects`);
    }

    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'undefined') continue;
      output[key] = cloneJsonSafe(entry, `${path}.${key}`, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function normalizeCandidateSnapshot(candidates) {
  if (!Array.isArray(candidates)) {
    throw new TypeError('candidates must be an array');
  }

  const snapshot = cloneJsonSafe(candidates, 'candidates');
  const ids = new Set();

  for (const candidate of snapshot) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new TypeError('each candidate must be a JSON-safe object');
    }

    const claimId = candidate?.claim?.id;
    if (!nonEmptyString(claimId)) {
      throw new TypeError('each candidate claim.id must be a non-empty string');
    }
    if (ids.has(claimId)) {
      throw new TypeError('candidate claim IDs must be unique');
    }
    ids.add(claimId);
  }

  return { snapshot, ids };
}

function normalizeFastResult(fastResult, candidateIds, candidateCount) {
  if (fastResult === null) {
    if (candidateCount !== 0) {
      throw new TypeError('localFastPath may be null only when candidate_count is zero');
    }
    return null;
  }

  if (!fastResult || typeof fastResult !== 'object' || Array.isArray(fastResult)) {
    throw new TypeError('fastResult must be an object or null');
  }

  const snapshot = cloneJsonSafe(fastResult, 'fastResult');

  if (!FAST_ROUTES.has(snapshot.route)) {
    throw new TypeError('fastResult route is unsupported');
  }
  if (!Array.isArray(snapshot.selected_ids)) {
    throw new TypeError('fastResult selected_ids must be an array');
  }

  const seen = new Set();
  for (const id of snapshot.selected_ids) {
    if (!nonEmptyString(id) || !candidateIds.has(id) || seen.has(id)) {
      throw new TypeError('fastResult selected_ids must be unique supplied candidate IDs');
    }
    seen.add(id);
  }

  if (snapshot.route === 'fallback' && snapshot.selected_ids.length !== 0) {
    throw new TypeError('fastResult fallback must not select candidate IDs');
  }

  if (!Number.isFinite(snapshot.duration_ms) || snapshot.duration_ms < 0) {
    throw new TypeError('fastResult duration_ms must be a non-negative finite number');
  }
  snapshot.duration_ms = Math.trunc(snapshot.duration_ms);

  if (snapshot.failed !== true && snapshot.failed !== false) {
    throw new TypeError('fastResult failed must be a boolean');
  }

  return snapshot;
}

function validateCreatedAt(value) {
  requireNonEmptyString(value, 'createdAt');
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError('createdAt must be a valid timestamp string');
  }
  return value;
}

export function recallShadowReplayPacketId({
  projectId,
  branch,
  sessionId,
  turnId,
} = {}) {
  requireNonEmptyString(projectId, 'projectId');
  requireNonEmptyString(branch, 'branch');
  requireNonEmptyString(sessionId, 'sessionId');
  requireNonEmptyString(turnId, 'turnId');

  const identity = JSON.stringify([
    PACKET_SCHEMA_VERSION,
    projectId,
    branch,
    sessionId,
    turnId,
  ]);

  return createHash('sha256').update(identity, 'utf8').digest('hex');
}

export function createRecallShadowReplayPacket({
  projectId,
  branch,
  sessionId,
  turnId,
  query,
  candidates,
  fastResult,
  retrievalTelemetry = null,
  maxSelected = 8,
  createdAt = new Date().toISOString(),
} = {}) {
  requireNonEmptyString(query, 'query');
  requirePositiveInteger(maxSelected, 'maxSelected');
  validateCreatedAt(createdAt);

  const { snapshot: candidateSnapshot, ids: candidateIds } =
    normalizeCandidateSnapshot(candidates);
  const localFastPath =
    normalizeFastResult(fastResult, candidateIds, candidateSnapshot.length);
  const retrievalSnapshot =
    retrievalTelemetry === null
      ? null
      : cloneJsonSafe(retrievalTelemetry, 'retrievalTelemetry');

  const packet = {
    schemaVersion: PACKET_SCHEMA_VERSION,
    type: PACKET_TYPE,
    id: recallShadowReplayPacketId({
      projectId,
      branch,
      sessionId,
      turnId,
    }),
    createdAt,
    scope: {
      projectId,
      branch,
    },
    source: {
      sessionId,
      turnId,
    },
    query,
    candidates: candidateSnapshot,
    localFastPath,
    retrieval: {
      candidate_count: candidateSnapshot.length,
      telemetry: retrievalSnapshot,
    },
    selectorContract: {
      maxSelected,
    },
  };

  return validateRecallShadowReplayPacket(packet);
}

export function validateRecallShadowReplayPacket(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('replay packet must be an object');
  }

  const packet = cloneJsonSafe(value, 'packet');

  if (packet.schemaVersion !== PACKET_SCHEMA_VERSION) {
    throw new TypeError(`replay packet schemaVersion must be ${PACKET_SCHEMA_VERSION}`);
  }
  if (packet.type !== PACKET_TYPE) {
    throw new TypeError(`replay packet type must be ${PACKET_TYPE}`);
  }

  const projectId = requireNonEmptyString(packet?.scope?.projectId, 'projectId');
  const branch = requireNonEmptyString(packet?.scope?.branch, 'branch');
  const sessionId = requireNonEmptyString(packet?.source?.sessionId, 'sessionId');
  const turnId = requireNonEmptyString(packet?.source?.turnId, 'turnId');
  requireNonEmptyString(packet.query, 'query');
  validateCreatedAt(packet.createdAt);

  const expectedId = recallShadowReplayPacketId({
    projectId,
    branch,
    sessionId,
    turnId,
  });
  if (packet.id !== expectedId) {
    throw new TypeError('replay packet id does not match deterministic scope and turn identity');
  }

  const { snapshot: candidates, ids: candidateIds } =
    normalizeCandidateSnapshot(packet.candidates);

  if (
    !packet.retrieval
    || typeof packet.retrieval !== 'object'
    || Array.isArray(packet.retrieval)
  ) {
    throw new TypeError('replay packet retrieval must be an object');
  }
  if (packet.retrieval.candidate_count !== candidates.length) {
    throw new TypeError('replay packet retrieval candidate_count does not match candidates');
  }

  const localFastPath =
    normalizeFastResult(packet.localFastPath, candidateIds, candidates.length);

  const maxSelected = requirePositiveInteger(
    packet?.selectorContract?.maxSelected,
    'maxSelected',
  );

  return {
    schemaVersion: PACKET_SCHEMA_VERSION,
    type: PACKET_TYPE,
    id: expectedId,
    createdAt: packet.createdAt,
    scope: {
      projectId,
      branch,
    },
    source: {
      sessionId,
      turnId,
    },
    query: packet.query,
    candidates,
    localFastPath,
    retrieval: {
      candidate_count: candidates.length,
      telemetry:
        packet.retrieval.telemetry === null
          ? null
          : cloneJsonSafe(packet.retrieval.telemetry, 'retrieval.telemetry'),
    },
    selectorContract: {
      maxSelected,
    },
  };
}