import { expireDueClaims } from './claim-expiration-maintenance.mjs';
import { createTemporalMemoryView } from './temporal-memory-view.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function prepareTemporalMemoryRuntime({
  memory,
  dbPath,
  projectId,
  branch,
  clock = () => new Date().toISOString(),
  expireClaims = expireDueClaims,
  createView = createTemporalMemoryView,
} = {}) {
  if (!memory || typeof memory !== 'object') {
    throw new TypeError('memory must be a MemoryEngine-like object');
  }
  if (!nonEmpty(dbPath)) {
    throw new TypeError('dbPath must be a non-empty string');
  }
  if (!nonEmpty(projectId)) {
    throw new TypeError('projectId must be a non-empty string');
  }
  if (!nonEmpty(branch)) {
    throw new TypeError('branch must be a non-empty string');
  }
  if (typeof clock !== 'function') {
    throw new TypeError('clock must be a function');
  }
  if (typeof expireClaims !== 'function') {
    throw new TypeError('expireClaims must be a function');
  }
  if (typeof createView !== 'function') {
    throw new TypeError('createView must be a function');
  }

  const now = clock();
  const expiration = expireClaims({
    dbPath,
    projectId,
    branch,
    now,
  });
  const temporalClock = () => now;
  const temporalMemory = createView({
    memory,
    now: temporalClock,
  });

  return {
    memory: temporalMemory,
    expiration,
    observed_at: now,
  };
}
