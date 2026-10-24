import { adaptLegacyDesignReference } from './legacy-import.mjs';

function requireArray(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`);
  }
  return value;
}

function positiveInteger(value, name, fallback) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return resolved;
}

export function planLegacyCatalogImport(records) {
  requireArray(records, 'records');

  const legacyIds = records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError(`records[${index}] must be an object`);
    }
    if (typeof record.id !== 'string' || record.id.trim().length === 0) {
      throw new TypeError(`records[${index}].id must be a non-empty string`);
    }
    return record.id.trim();
  });

  const duplicateIds = legacyIds.filter((id, index) => legacyIds.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new Error(`duplicate legacy reference ids: ${[...new Set(duplicateIds)].join(', ')}`);
  }

  const captures = records.map((record) => adaptLegacyDesignReference(record));
  const uniqueSources = new Set(captures.map((capture) => capture.source.id));
  const uniqueAssets = new Set(captures.map((capture) => capture.asset.id));

  return {
    record_count: records.length,
    capture_count: captures.length,
    source_count: uniqueSources.size,
    asset_count: uniqueAssets.size,
    deduplicated_assets: captures.length - uniqueAssets.size,
    legacy_ids: legacyIds,
    captures,
  };
}

export async function importLegacyCatalog({
  records,
  store,
  batchSize = 25,
  onProgress = null,
} = {}) {
  if (!store || typeof store.persistCaptures !== 'function') {
    throw new TypeError('store.persistCaptures must be a function');
  }
  if (onProgress !== null && typeof onProgress !== 'function') {
    throw new TypeError('onProgress must be a function when supplied');
  }

  const size = positiveInteger(batchSize, 'batchSize', 25);
  const plan = planLegacyCatalogImport(records);
  let imported = 0;
  const batchResults = [];

  for (let offset = 0; offset < plan.captures.length; offset += size) {
    const batch = plan.captures.slice(offset, offset + size);
    const result = await store.persistCaptures(batch);
    imported += batch.length;
    batchResults.push(result);
    if (onProgress) {
      await onProgress({
        imported,
        total: plan.capture_count,
        batch_size: batch.length,
      });
    }
  }

  return {
    ...plan,
    imported_count: imported,
    batch_count: batchResults.length,
    batch_results: batchResults,
  };
}
