import { prepareTemporalMemoryRuntime } from '../temporal-memory-runtime.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function prepareCodexTemporalRecallRuntime({
  memory,
  dbPath,
  projectId,
  cwd,
  clock = () => new Date().toISOString(),
  resolveGit,
  prepareTemporalRuntime = prepareTemporalMemoryRuntime,
} = {}) {
  if (!memory || typeof memory !== 'object') {
    throw new TypeError('memory must be a MemoryEngine-like object');
  }
  if (!nonEmpty(dbPath)) throw new TypeError('dbPath must be a non-empty string');
  if (!nonEmpty(projectId)) throw new TypeError('projectId must be a non-empty string');
  if (!nonEmpty(cwd)) throw new TypeError('cwd must be a non-empty string');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (typeof resolveGit !== 'function') throw new TypeError('resolveGit must be a function');
  if (typeof prepareTemporalRuntime !== 'function') {
    throw new TypeError('prepareTemporalRuntime must be a function');
  }

  const git = resolveGit({ cwd });
  if (!git || typeof git !== 'object' || !nonEmpty(git.branch)) {
    throw new Error('git context must include a branch');
  }

  const observedAt = clock();
  const temporal = prepareTemporalRuntime({
    memory,
    dbPath,
    projectId,
    branch: git.branch,
    clock: () => observedAt,
  });

  return {
    ...temporal,
    git,
  };
}
