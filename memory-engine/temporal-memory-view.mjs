import {
  evaluateClaimTemporalValidity,
  filterTemporallyCurrentRecall,
} from './claim-temporal-validity.mjs';

function modeOf(args) {
  return args?.mode ?? 'current';
}

export function createTemporalMemoryView({
  memory,
  now = () => new Date().toISOString(),
} = {}) {
  if (!memory || typeof memory !== 'object') {
    throw new TypeError('memory must be a MemoryEngine-like object');
  }
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function');
  }
  for (const method of ['recall', 'materializeRecall', 'semanticCandidates', 'getClaim']) {
    if (typeof memory[method] !== 'function') {
      throw new TypeError('memory must support ' + method + '()');
    }
  }

  const overrides = {
    recall(args = {}) {
      const result = memory.recall(args);
      if (modeOf(args) === 'historical') return result;
      return filterTemporallyCurrentRecall(result, { now: now() });
    },

    materializeRecall(args = {}) {
      const result = memory.materializeRecall(args);
      if (modeOf(args) === 'historical') return result;
      return filterTemporallyCurrentRecall(result, { now: now() });
    },

    semanticCandidates(args = {}) {
      const candidates = memory.semanticCandidates(args);
      if (modeOf(args) === 'historical') return candidates;
      const currentAt = now();
      return candidates.filter((candidate) => {
        const claim = memory.getClaim(candidate?.claim_id);
        if (!claim) return false;
        return evaluateClaimTemporalValidity(claim, { now: currentAt }).current;
      });
    },
  };

  return new Proxy(memory, {
    get(target, property, receiver) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
