import { selectRecords } from '../knowledge/design-references/scripts/selection.mjs';

function finiteAverage(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function legacyIdFromGraphItem(item) {
  if (!item || typeof item !== 'object') return null;
  return item.metadata?.legacy_id ?? item.legacy_id ?? item.id ?? null;
}

function exactRate(items, expected, readValue) {
  if (!expected || items.length === 0) return items.length === 0 ? 0 : 1;
  const matching = items.filter((item) => readValue(item) === expected).length;
  return matching / items.length;
}

export function compareShadowSelection({ request, legacySelected, graphBundle } = {}) {
  if (!request || typeof request !== 'object') {
    throw new TypeError('request must be an object');
  }
  if (!Array.isArray(legacySelected)) {
    throw new TypeError('legacySelected must be an array');
  }

  const graphItems = Array.isArray(graphBundle?.items) ? graphBundle.items : [];
  const legacyIds = legacySelected
    .map((item) => item?.id)
    .filter((id) => typeof id === 'string' && id.length > 0);
  const graphLegacyIds = graphItems
    .map(legacyIdFromGraphItem)
    .filter((id) => typeof id === 'string' && id.length > 0);
  const graphSet = new Set(graphLegacyIds);
  const overlapCount = legacyIds.filter((id) => graphSet.has(id)).length;
  const denominator = legacyIds.length || 1;

  return {
    request: { ...request },
    legacy_count: legacyIds.length,
    graph_count: graphItems.length,
    overlap_count: overlapCount,
    overlap_at_k: overlapCount / denominator,
    legacy_top1_retained: legacyIds.length > 0 && graphSet.has(legacyIds[0]),
    graph_exact_surface_rate: exactRate(
      graphItems,
      request.surface,
      (item) => item.surface_family ?? item.surfaceFamily ?? item.metadata?.surface_family ?? null,
    ),
    graph_exact_platform_rate: exactRate(
      graphItems,
      request.platform,
      (item) => item.platform ?? item.metadata?.platform ?? null,
    ),
    graph_empty: graphItems.length === 0,
    legacy_ids: legacyIds,
    graph_legacy_ids: graphLegacyIds,
  };
}

export function summarizeShadowEvaluation(rows, thresholds = {}) {
  if (!Array.isArray(rows)) {
    throw new TypeError('rows must be an array');
  }

  const policy = {
    minCases: thresholds.minCases ?? 20,
    minAverageOverlap: thresholds.minAverageOverlap ?? 0.65,
    minTop1Retention: thresholds.minTop1Retention ?? 0.75,
    maxEmptyRate: thresholds.maxEmptyRate ?? 0.05,
    minExactSurfaceRate: thresholds.minExactSurfaceRate ?? 0.7,
    minExactPlatformRate: thresholds.minExactPlatformRate ?? 0.8,
  };

  const summary = {
    case_count: rows.length,
    average_overlap_at_k: finiteAverage(rows.map((row) => row.overlap_at_k ?? 0)),
    legacy_top1_retention_rate: finiteAverage(
      rows.map((row) => row.legacy_top1_retained ? 1 : 0),
    ),
    graph_empty_rate: finiteAverage(rows.map((row) => row.graph_empty ? 1 : 0)),
    average_exact_surface_rate: finiteAverage(
      rows.map((row) => row.graph_exact_surface_rate ?? 0),
    ),
    average_exact_platform_rate: finiteAverage(
      rows.map((row) => row.graph_exact_platform_rate ?? 0),
    ),
    thresholds: policy,
    blockers: [],
    cutover_ready: false,
  };

  if (summary.case_count < policy.minCases) {
    summary.blockers.push(`need at least ${policy.minCases} shadow cases`);
  }
  if (summary.average_overlap_at_k < policy.minAverageOverlap) {
    summary.blockers.push('average overlap below threshold');
  }
  if (summary.legacy_top1_retention_rate < policy.minTop1Retention) {
    summary.blockers.push('legacy top-1 retention below threshold');
  }
  if (summary.graph_empty_rate > policy.maxEmptyRate) {
    summary.blockers.push('graph empty rate above threshold');
  }
  if (summary.average_exact_surface_rate < policy.minExactSurfaceRate) {
    summary.blockers.push('exact surface rate below threshold');
  }
  if (summary.average_exact_platform_rate < policy.minExactPlatformRate) {
    summary.blockers.push('exact platform rate below threshold');
  }

  summary.cutover_ready = summary.blockers.length === 0;
  return summary;
}

export function shadowQueryText(request) {
  return [
    request?.job,
    request?.dimensions,
    request?.surface,
  ]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

export async function runCatalogShadowEvaluation({
  records,
  cases,
  graphRetrieve,
  thresholds = {},
} = {}) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (!Array.isArray(cases)) throw new TypeError('cases must be an array');
  if (typeof graphRetrieve !== 'function') {
    throw new TypeError('graphRetrieve must be a function');
  }

  const rows = [];
  for (const request of cases) {
    const legacy = selectRecords(records, request);
    const graphBundle = await graphRetrieve({
      request,
      query: shadowQueryText(request),
      filters: {
        platform: request.platform || undefined,
        surface_family: request.surface || undefined,
      },
      maxItems: request.limit,
    });
    rows.push(compareShadowSelection({
      request,
      legacySelected: legacy.selected,
      graphBundle,
    }));
  }

  return {
    production_source: 'legacy-control',
    rows,
    summary: summarizeShadowEvaluation(rows, thresholds),
  };
}
