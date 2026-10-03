import { createHash } from 'node:crypto';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function recallTelemetryRunId(requestId) {
  if (!nonEmpty(requestId)) {
    throw new TypeError('requestId must be a non-empty string');
  }
  return 'recall-run:' + createHash('sha256')
    .update(requestId, 'utf8')
    .digest('hex');
}

export function recallQueryHash(query) {
  if (!nonEmpty(query)) {
    throw new TypeError('query must be a non-empty string');
  }
  return createHash('sha256')
    .update(query, 'utf8')
    .digest('hex');
}
