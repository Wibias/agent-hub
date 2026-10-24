import { performance } from 'node:perf_hooks';

import { isFresh } from '../knowledge/design-references/scripts/lib.mjs';
import { selectRecords } from '../knowledge/design-references/scripts/selection.mjs';

function finiteAverage(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function latencySummary(rows) {
  const values = rows
    .map((row) => row?.graph_latency_ms)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);

  if (values.length === 0) {
    return {
      min: null,
      p50: null,
      p95: null,
      max: null,
      average: null,
    };
  }

  const nearestRank = (percentile) => {
    const index = Math.max(0, Math.ceil(percentile * values.length) - 1);
    return values[index];
  };

  return {
    min: values[0],
    p50: nearestRank(0.5),
    p95: nearestRank(0.95),
    max: values[values.length - 1],
    average: finiteAverage(values),
  };
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

function resolveControlNow(value) {
  const resolved = value ?? new Date();
  if (!(resolved instanceof Date) || Number.isNaN(resolved.getTime())) {
    throw new TypeError('control time must be a valid Date');
  }
  return resolved;
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
  const comparable = legacyIds.length > 0;

  return {
    request: { ...request },
    comparable,
    legacy_empty: !comparable,
    legacy_count: legacyIds.length,
    graph_count: graphItems.length,
    overlap_count: overlapCount,
    overlap_at_k: comparable ? overlapCount / legacyIds.length : null,
    legacy_top1_retained: comparable ? graphSet.has(legacyIds[0]) : null,
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

export function assessLegacyControlHealth({ records, cases, now = new Date() } = {}) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (!Array.isArray(cases)) throw new TypeError('cases must be an array');
  const controlNow = resolveControlNow(now);
  const reviewedAccessible = records.filter(
    (record) => record?.reviewStatus === 'reviewed'
      && ['AVAILABLE', 'PAYWALLED'].includes(record?.accessStatus),
  );
  const freshPool = reviewedAccessible.filter((record) => isFresh(record, controlNow));
  const selections = cases.map((request) => selectRecords(records, request, { now: controlNow }));
  const fullLimitCaseCount = selections.filter(
    (selection, index) => selection.selected.length === cases[index].limit,
  ).length;
  const casesWithCoverageGaps = selections.filter(
    (selection) => selection.coverageGaps.length > 0,
  ).length;
  const freshSurfaceFamilies = new Set(freshPool.map((record) => record.surfaceFamily));
  const freshPlatforms = new Set(freshPool.map((record) => record.platform));
  const blockers = [];
  const maxRequestedLimit = cases.reduce(
    (max, request) => Math.max(max, Number.isInteger(request?.limit) ? request.limit : 0),
    0,
  );

  if (freshPool.length < maxRequestedLimit) {
    blockers.push('fresh pool is smaller than the largest requested limit');
  }
  if (fullLimitCaseCount < cases.length) {
    blockers.push('one or more control cases cannot fill the requested limit');
  }
  if (casesWithCoverageGaps > 0) {
    blockers.push('one or more control cases have coverage gaps');
  }

  return {
    reference_time: controlNow.toISOString(),
    reviewed_accessible_count: reviewedAccessible.length,
    fresh_pool_count: freshPool.length,
    fresh_pool_rate: reviewedAccessible.length === 0
      ? 0
      : freshPool.length / reviewedAccessible.length,
    fresh_surface_family_count: freshSurfaceFamilies.size,
    fresh_platform_count: freshPlatforms.size,
    case_count: cases.length,
    full_limit_case_count: fullLimitCaseCount,
    cases_with_coverage_gaps: casesWithCoverageGaps,
    blockers,
    healthy: blockers.length === 0,
  };
}

export function summarizeShadowEvaluation(rows, thresholds = {}) {
  if (!Array.isArray(rows)) {
    throw new TypeError('rows must be an array');
  }

  const policy = {
    minCases: thresholds.minCases ?? 20,
    minComparableCases: thresholds.minComparableCases ?? thresholds.minCases ?? 20,
    minAverageOverlap: thresholds.minAverageOverlap ?? 0.65,
    minTop1Retention: thresholds.minTop1Retention ?? 0.75,
    maxEmptyRate: thresholds.maxEmptyRate ?? 0.05,
    minExactSurfaceRate: thresholds.minExactSurfaceRate ?? 0.7,
    minExactPlatformRate: thresholds.minExactPlatformRate ?? 0.8,
  };
  const comparableRows = rows.filter((row) => row.comparable !== false);

  const summary = {
    case_count: rows.length,
    comparable_case_count: comparableRows.length,
    legacy_empty_rate: finiteAverage(rows.map((row) => row.legacy_empty ? 1 : 0)) ?? 0,
    average_overlap_at_k: finiteAverage(
      comparableRows
        .map((row) => row.overlap_at_k)
        .filter((value) => Number.isFinite(value)),
    ),
    legacy_top1_retention_rate: finiteAverage(
      comparableRows
        .filter((row) => typeof row.legacy_top1_retained === 'boolean')
        .map((row) => row.legacy_top1_retained ? 1 : 0),
    ),
    graph_empty_rate: finiteAverage(rows.map((row) => row.graph_empty ? 1 : 0)) ?? 0,
    average_exact_surface_rate: finiteAverage(
      rows.map((row) => row.graph_exact_surface_rate ?? 0),
    ) ?? 0,
    average_exact_platform_rate: finiteAverage(
      rows.map((row) => row.graph_exact_platform_rate ?? 0),
    ) ?? 0,
    latency_ms: latencySummary(rows),
    thresholds: policy,
    blockers: [],
    cutover_ready: false,
  };

  if (summary.case_count < policy.minCases) {
    summary.blockers.push(`need at least ${policy.minCases} shadow cases`);
  }
  if (summary.comparable_case_count < policy.minComparableCases) {
    summary.blockers.push(`need at least ${policy.minComparableCases} comparable shadow cases`);
  }
  if (
    summary.average_overlap_at_k !== null
    && summary.average_overlap_at_k < policy.minAverageOverlap
  ) {
    summary.blockers.push('average overlap below threshold');
  }
  if (
    summary.legacy_top1_retention_rate !== null
    && summary.legacy_top1_retention_rate < policy.minTop1Retention
  ) {
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
  controlNow = undefined,
  nowMs = () => performance.now(),
} = {}) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (!Array.isArray(cases)) throw new TypeError('cases must be an array');
  if (typeof graphRetrieve !== 'function') {
    throw new TypeError('graphRetrieve must be a function');
  }
  if (typeof nowMs !== 'function') {
    throw new TypeError('nowMs must be a function');
  }
  const resolvedControlNow = resolveControlNow(controlNow);
  const controlHealth = assessLegacyControlHealth({
    records,
    cases,
    now: resolvedControlNow,
  });

  const rows = [];
  for (const request of cases) {
    const legacy = selectRecords(records, request, { now: resolvedControlNow });
    const startedAt = nowMs();
    const graphBundle = await graphRetrieve({
      request,
      query: shadowQueryText(request),
      filters: {
        platform: request.platform || undefined,
        surface_family: request.surface || undefined,
        reference_date: resolvedControlNow.toISOString().slice(0, 10),
      },
      maxItems: request.limit,
    });
    const finishedAt = nowMs();
    const latency = Number.isFinite(startedAt)
      && Number.isFinite(finishedAt)
      && finishedAt >= startedAt
      ? finishedAt - startedAt
      : null;
    rows.push({
      ...compareShadowSelection({
        request,
        legacySelected: legacy.selected,
        graphBundle,
      }),
      graph_latency_ms: latency,
    });
  }

  return {
    production_source: 'legacy-control',
    control_reference_time: resolvedControlNow.toISOString(),
    control_health: controlHealth,
    rows,
    summary: summarizeShadowEvaluation(rows, thresholds),
  };
}
