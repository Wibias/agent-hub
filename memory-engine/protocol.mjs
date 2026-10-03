import { enforceRecallBudget } from './hybrid-retrieval.mjs';

export const MEMORY_PROTOCOL_V1 = 'memory.protocol.v1';

const OPERATIONS = new Set([
  'capture_evidence',
  'assert_claim',
  'recall',
  'history',
  'authorize',
  'export',
  'import',
  'status',
]);

class ProtocolFault extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.publicMessage = message;
  }
}

function fault(code, message) {
  throw new ProtocolFault(code, message);
}

function isPlainObject(value) {
  return (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null)
  );
}

function requireObject(value) {
  if (!isPlainObject(value)) {
    fault('invalid_request', 'Invalid memory protocol request.');
  }
  return value;
}

function requireString(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fault('invalid_request', 'Invalid memory protocol request.');
  }
  return value;
}

function optionalString(value) {
  if (value === undefined || value === null) return null;
  return requireString(value);
}

function requireAllowedKeys(object, allowed) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      fault('forbidden_field', 'Request contains a forbidden field.');
    }
  }
}

function stringArray(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    fault('invalid_request', 'Invalid memory protocol request.');
  }
  for (const item of value) requireString(item);
  return [...value];
}

function integerInRange(value, fallback, minimum, maximum) {
  const resolved = value ?? fallback;
  if (
    !Number.isInteger(resolved)
    || resolved < minimum
    || resolved > maximum
  ) {
    fault('invalid_request', 'Invalid memory protocol request.');
  }
  return resolved;
}

function safeRequestId(request) {
  return typeof request?.request_id === 'string'
    && request.request_id.length > 0
    && request.request_id.length <= 256
    ? request.request_id
    : null;
}

function errorResponse(requestId, error) {
  if (error instanceof ProtocolFault) {
    return {
      protocol: MEMORY_PROTOCOL_V1,
      request_id: requestId,
      ok: false,
      error: {
        code: error.code,
        message: error.publicMessage,
      },
    };
  }

  return {
    protocol: MEMORY_PROTOCOL_V1,
    request_id: requestId,
    ok: false,
    error: {
      code: 'memory_operation_failed',
      message: 'Memory operation failed.',
    },
  };
}

function validateEnvelope(request) {
  requireObject(request);
  requireAllowedKeys(
    request,
    new Set(['protocol', 'operation', 'request_id', 'payload']),
  );

  requireString(request.request_id);

  if (request.protocol !== MEMORY_PROTOCOL_V1) {
    fault(
      'unsupported_protocol',
      'Unsupported memory protocol version.',
    );
  }

  requireString(request.operation);
  if (!OPERATIONS.has(request.operation)) {
    fault(
      'unsupported_operation',
      'Unsupported memory protocol operation.',
    );
  }

  return requireObject(request.payload);
}

function normalizeCapturePayload(payload) {
  requireAllowedKeys(payload, new Set([
    'id',
    'project_id',
    'harness',
    'session_id',
    'source_kind',
    'source_ref',
    'captured_at',
    'branch',
    'commit_sha',
    'path',
    'blob_oid',
    'content',
    'metadata',
  ]));

  const metadata = payload.metadata ?? {};
  requireObject(metadata);

  return {
    id: requireString(payload.id),
    projectId: requireString(payload.project_id),
    harness: optionalString(payload.harness),
    sessionId: optionalString(payload.session_id),
    sourceKind: requireString(payload.source_kind),
    sourceRef: optionalString(payload.source_ref),
    capturedAt: requireString(payload.captured_at),
    branch: optionalString(payload.branch),
    commitSha: optionalString(payload.commit_sha),
    path: optionalString(payload.path),
    blobOid: optionalString(payload.blob_oid),
    content: requireString(payload.content),
    metadata,
  };
}

function normalizeClaimPayload(payload) {
  requireAllowedKeys(
    payload,
    new Set(['evidence_id', 'claim', 'lifecycle']),
  );

  const claim = requireObject(payload.claim);
  requireAllowedKeys(claim, new Set([
    'id',
    'kind',
    'subject',
    'predicate',
    'value',
    'state',
    'branch_scope',
    'created_at',
    'valid_from',
    'valid_until',
  ]));

  const lifecycle = payload.lifecycle ?? {};
  requireObject(lifecycle);
  requireAllowedKeys(
    lifecycle,
    new Set(['supersedes', 'rejects', 'conflicts_with']),
  );

  const normalizedClaim = {
    id: requireString(claim.id),
    kind: requireString(claim.kind),
    subject: requireString(claim.subject),
    predicate: requireString(claim.predicate),
    value: typeof claim.value === 'string'
      ? claim.value
      : String(claim.value ?? ''),
    branchScope: optionalString(claim.branch_scope),
    createdAt: requireString(claim.created_at),
    validFrom: optionalString(claim.valid_from),
    validUntil: optionalString(claim.valid_until),
  };

  if (claim.state !== undefined) {
    normalizedClaim.state = requireString(claim.state);
  }

  return {
    evidenceId: requireString(payload.evidence_id),
    claim: normalizedClaim,
    lifecycle: {
      supersedes: stringArray(lifecycle.supersedes),
      rejects: stringArray(lifecycle.rejects),
      conflictsWith: stringArray(lifecycle.conflicts_with),
    },
  };
}

function normalizeRecallPayload(payload) {
  requireAllowedKeys(payload, new Set([
    'project_id',
    'branch',
    'revision_sha',
    'query',
    'max_items',
    'max_serialized_bytes',
  ]));

  return {
    projectId: requireString(payload.project_id),
    branch: requireString(payload.branch),
    revisionSha: optionalString(payload.revision_sha),
    query: requireString(payload.query),
    maxItems: integerInRange(payload.max_items, 10, 1, 10),
    maxSerializedBytes: integerInRange(
      payload.max_serialized_bytes,
      16_384,
      1,
      16_384,
    ),
  };
}

function normalizeAuthorizePayload(payload) {
  requireAllowedKeys(payload, new Set([
    'project_id',
    'action',
    'target',
    'environment',
    'artifact',
    'constraints',
  ]));

  const constraints = payload.constraints ?? {};
  requireObject(constraints);

  return {
    projectId: requireString(payload.project_id),
    action: requireString(payload.action),
    target: requireString(payload.target),
    environment: requireString(payload.environment),
    artifact: optionalString(payload.artifact),
    constraints,
  };
}

export function createMemoryProtocol({
  memory,
  hybridRetriever = null,
  classifyAuthority = null,
  authorizeClaim = null,
  onRecallTelemetry = null,
}) {
  if (!memory || typeof memory !== 'object') {
    throw new TypeError('memory must be a MemoryEngine-like object');
  }
  if (
    hybridRetriever !== null
    && (
      !hybridRetriever
      || typeof hybridRetriever.recall !== 'function'
    )
  ) {
    throw new TypeError('hybridRetriever must expose recall()');
  }
  if (
    hybridRetriever !== null
    && hybridRetriever.indexClaim !== undefined
    && typeof hybridRetriever.indexClaim !== 'function'
  ) {
    throw new TypeError('hybridRetriever indexClaim must be a function');
  }
  if (
    classifyAuthority !== null
    && typeof classifyAuthority !== 'function'
  ) {
    throw new TypeError('classifyAuthority must be a function');
  }
  if (authorizeClaim !== null && typeof authorizeClaim !== 'function') {
    throw new TypeError('authorizeClaim must be a function');
  }
  if (onRecallTelemetry !== null && typeof onRecallTelemetry !== 'function') {
    throw new TypeError('onRecallTelemetry must be a function or null');
  }

  async function captureEvidence(payload) {
    if (classifyAuthority === null) {
      fault(
        'authority_classifier_unavailable',
        'Authority classification is unavailable.',
      );
    }

    const evidence = normalizeCapturePayload(payload);
    const authorityClass = await classifyAuthority({
      harness: evidence.harness,
      sessionId: evidence.sessionId,
      sourceKind: evidence.sourceKind,
      sourceRef: evidence.sourceRef,
      metadata: evidence.metadata,
    });

    const stored = memory.recordEvidence({
      ...evidence,
      authorityClass,
    });

    return { evidence: stored };
  }

  async function assertClaim(payload) {
    const normalized = normalizeClaimPayload(payload);
    const evidence = memory.getEvidence(normalized.evidenceId);
    if (!evidence) {
      throw new Error('claim evidence does not exist');
    }

    if (authorizeClaim === null) {
      fault(
        'claim_assertion_denied',
        'Claim assertion is not authorized.',
      );
    }

    let authorized = false;
    try {
      authorized = await authorizeClaim({
        evidence,
        claim: normalized.claim,
        lifecycle: normalized.lifecycle,
      }) === true;
    } catch {
      authorized = false;
    }

    if (!authorized) {
      fault(
        'claim_assertion_denied',
        'Claim assertion is not authorized.',
      );
    }

    const asserted = memory.assertClaim(normalized);

    if (
      asserted?.claim?.state === 'active'
      && hybridRetriever !== null
      && typeof hybridRetriever.indexClaim === 'function'
    ) {
      try {
        await hybridRetriever.indexClaim(asserted.claim.id);
      } catch {
        // Semantic vectors are derived state. A failed embedding must not
        // roll back or invalidate an already-committed canonical Claim.
      }
    }

    return asserted;
  }

  async function recall(payload, mode, requestId) {
    const normalized = normalizeRecallPayload(payload);

    let result;
    let telemetry;
    if (
      hybridRetriever !== null
      && typeof hybridRetriever.recallDetailed === 'function'
    ) {
      const detailed = await hybridRetriever.recallDetailed({
        ...normalized,
        mode,
      });
      result = detailed.result;
      telemetry = detailed.telemetry;
    } else if (hybridRetriever !== null) {
      result = await hybridRetriever.recall({
        ...normalized,
        mode,
      });
      telemetry = {
        retrieval_mode: 'hybrid',
        fallback_reason: 'detailed_telemetry_unavailable',
        candidates: result.items.map((item, index) => ({
          claim_id: item.claim.id,
          authority_class: item.evidence?.authority_class ?? 'unclassified',
          final_rank: index + 1,
          lexical_rank: null,
          semantic_rank: null,
          semantic_similarity: null,
          rrf_score: null,
          budget_retained: true,
        })),
      };
    } else {
      const raw = memory.recall({
        projectId: normalized.projectId,
        branch: normalized.branch,
        revisionSha: normalized.revisionSha,
        query: normalized.query,
        mode,
        limit: Math.max(normalized.maxItems, 32),
      });
      result = enforceRecallBudget(raw, {
        maxItems: normalized.maxItems,
        maxSerializedBytes: normalized.maxSerializedBytes,
      });
      const retainedIds = new Set(
        result.items.map((item) => item?.claim?.id).filter(Boolean),
      );
      telemetry = {
        retrieval_mode: 'lexical',
        fallback_reason: 'embedder_unavailable',
        candidates: raw.items.map((item, index) => ({
          claim_id: item.claim.id,
          authority_class: item.evidence?.authority_class ?? 'unclassified',
          final_rank: index + 1,
          lexical_rank: index + 1,
          semantic_rank: null,
          semantic_similarity: null,
          rrf_score: null,
          budget_retained: retainedIds.has(item.claim.id),
        })),
      };
    }

    if (onRecallTelemetry !== null) {
      try {
        await onRecallTelemetry({
          requestId,
          mode,
          normalized,
          telemetry,
        });
      } catch {
        // Recall observability is derived operational state and fail-soft.
      }
    }

    return result;
  }

  async function authorize(payload) {
    return memory.authorizeAction(normalizeAuthorizePayload(payload));
  }

  async function exportMemory(payload) {
    requireAllowedKeys(payload, new Set());
    return { memory: memory.exportCanonical() };
  }

  async function importMemory(payload) {
    requireAllowedKeys(payload, new Set(['memory']));
    requireObject(payload.memory);
    return memory.importCanonical(payload.memory);
  }

  async function status(payload) {
    requireAllowedKeys(payload, new Set());
    const exported = memory.exportCanonical();
    return {
      protocol: MEMORY_PROTOCOL_V1,
      projects: exported.projects.length,
      evidence: exported.evidence.length,
      claims: exported.claims.length,
      lifecycle_events: exported.lifecycle_events.length,
      open_conflicts: exported.conflicts.filter(
        (conflict) => conflict.state === 'open',
      ).length,
      approvals: exported.approvals.length,
    };
  }

  async function dispatch(operation, payload, requestId) {
    switch (operation) {
      case 'capture_evidence':
        return captureEvidence(payload);
      case 'assert_claim':
        return assertClaim(payload);
      case 'recall':
        return recall(payload, 'current', requestId);
      case 'history':
        return recall(payload, 'historical', requestId);
      case 'authorize':
        return authorize(payload);
      case 'export':
        return exportMemory(payload);
      case 'import':
        return importMemory(payload);
      case 'status':
        return status(payload);
      default:
        fault(
          'unsupported_operation',
          'Unsupported memory protocol operation.',
        );
    }
  }

  return {
    async handle(request) {
      const requestId = safeRequestId(request);
      try {
        const payload = validateEnvelope(request);
        const result = await dispatch(
          request.operation,
          payload,
          request.request_id,
        );
        return {
          protocol: MEMORY_PROTOCOL_V1,
          request_id: request.request_id,
          ok: true,
          result,
        };
      } catch (error) {
        return errorResponse(requestId, error);
      }
    },
  };
}
