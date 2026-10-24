import { selectP7ParityLexicalResults } from './p7-parity-policy.mjs';

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

export function createP7SupabaseShadowRetriever({ store } = {}) {
  requireObject(store, 'store');
  if (typeof store.quickCandidatePoolP7 !== 'function') {
    throw new TypeError('store.quickCandidatePoolP7 must be a function');
  }

  return async ({ request, filters = {}, maxItems = 12 } = {}) => {
    requireObject(request, 'request');
    positiveInteger(maxItems, 'maxItems');

    const candidates = await store.quickCandidatePoolP7(filters);
    const rows = Array.isArray(candidates) ? candidates : [];
    const selection = selectP7ParityLexicalResults({
      candidates: rows,
      request,
      maxItems,
    });

    const byLegacyId = new Map(rows.map((row) => [row?.legacy_id, row]));
    const items = selection.ids.map((legacyId) => {
      const item = byLegacyId.get(legacyId);
      if (!item) throw new Error(`missing selected P7 candidate ${legacyId}`);
      return item;
    });

    return {
      items,
      relations: [],
      policy_diagnostics: selection.diagnostics,
    };
  };
}
