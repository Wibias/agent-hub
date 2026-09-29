const AUTHORITY_CLASSES = new Set([
  'user_direct',
  'repo_trusted',
  'tool_observation',
  'agent_inference',
  'external_untrusted',
  'unclassified',
]);

function normalizePath(path) {
  return String(path ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function pathMatches(pattern, path) {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(path);

  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }

  return normalizedPattern === normalizedPath;
}

export function createAuthorityPolicy({
  trustedRepositoryPaths = [],
} = {}) {
  const trusted = [...new Set(trustedRepositoryPaths.map(normalizePath))];

  return {
    classify({
      eventType,
      sourceKind,
      sourceRef,
    }) {
      if (
        eventType === 'inference'
        || eventType === 'proposal'
        || eventType === 'noise_memory'
        || eventType === 'noise_session'
        || eventType === 'candidate_memory'
      ) {
        return 'agent_inference';
      }

      if (
        eventType === 'code_observation'
        || eventType === 'tool_result'
        || sourceKind === 'tool'
      ) {
        return 'tool_observation';
      }

      if (
        sourceKind === 'session'
        && (eventType === 'decision' || eventType === 'rejection' || eventType === 'approval')
      ) {
        return 'user_direct';
      }

      if (sourceKind === 'repository') {
        return trusted.some((pattern) => pathMatches(pattern, sourceRef))
          ? 'repo_trusted'
          : 'external_untrusted';
      }

      return 'unclassified';
    },
  };
}

export function assertAuthorityClass(value) {
  if (!AUTHORITY_CLASSES.has(value)) {
    throw new Error(`unsupported authority class: ${value}`);
  }
  return value;
}
