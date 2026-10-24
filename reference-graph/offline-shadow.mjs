import { tokenize } from '../knowledge/design-references/scripts/lib.mjs';
import { planLegacyCatalogImport } from './catalog-import.mjs';
import { retrieveReferenceBundle } from './retrieval.mjs';

function overlapCount(left, right) {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) count += 1;
  }
  return count;
}

function eligible(capture, filters = {}) {
  const metadata = capture.asset.metadata ?? {};
  if (filters.platform && metadata.platform !== filters.platform) return false;
  const surface = filters.surface_family ?? filters.surfaceFamily;
  if (surface && metadata.surface_family !== surface) return false;
  return true;
}

export function createOfflineCatalogRetriever(records) {
  const plan = planLegacyCatalogImport(records);
  const entries = plan.captures.map((capture) => ({
    capture,
    textTokens: tokenize(
      capture.chunks.map((chunk) => chunk.content).join(' '),
    ),
  }));

  return async function offlineRetrieve({
    query,
    filters = {},
    maxItems = 12,
  } = {}) {
    const queryTokens = tokenize(query ?? '');
    const ranked = entries
      .filter(({ capture }) => eligible(capture, filters))
      .map(({ capture, textTokens }) => ({
        capture,
        score: overlapCount(queryTokens, textTokens),
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) =>
        right.score - left.score ||
        left.capture.asset.id.localeCompare(right.capture.asset.id),
      );

    const lexicalHits = ranked.map(({ capture }) => capture.asset.id);
    const assets = ranked.map(({ capture }) => ({
      ...capture.asset,
      id: capture.asset.id,
      surface_family: capture.asset.metadata?.surface_family ?? null,
      platform: capture.asset.metadata?.platform ?? null,
      tags: capture.tags,
    }));

    return retrieveReferenceBundle({
      lexicalHits,
      semanticHits: [],
      assets,
      relations: [],
      filters,
      maxItems,
    });
  };
}
