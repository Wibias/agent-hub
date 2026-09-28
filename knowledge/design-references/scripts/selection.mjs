import {
  TAXONOMY,
  isFresh,
  overlap,
  recordSearchText,
  stripInternal,
  tokenize,
} from "./lib.mjs";

export function allocateDeep(total) {
  const order = [
    "direct-domain",
    "evidence-craft",
    "adjacent-domain",
    "outside-domain",
  ];
  const quotas = Object.fromEntries(
    Object.entries(TAXONOMY.primaryStrata).map(([key, value]) => [
      key,
      value.deepMin,
    ]),
  );
  let remaining =
    total - Object.values(quotas).reduce((sum, count) => sum + count, 0);
  while (remaining > 0) {
    let changed = false;
    for (const stratum of order) {
      if (remaining === 0) break;
      if (quotas[stratum] < TAXONOMY.primaryStrata[stratum].deepMax) {
        quotas[stratum] += 1;
        remaining -= 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return quotas;
}

function scoreRecord(record, request) {
  const queryTokens = tokenize(
    [request.job || "", request.dimensions || "", request.surface || ""].join(
      " ",
    ),
  );
  let value = 0;
  if (request.surface && record.surfaceFamily === request.surface) value += 60;
  if (request.platform && record.platform === request.platform) value += 15;
  value += overlap(queryTokens, tokenize(recordSearchText(record))) * 5;
  if (record.multiStateFlow) value += 4;
  if (record.ordinaryOrFailureProne) value += 3;
  if (record.evidenceClass === "TESTED") value += 3;
  if (record.accessStatus === "AVAILABLE") value += 2;
  // Visual-dimension scoring: boost visual-verified records, penalise text-only help/docs
  const visualDimensions = ["visual-world", "visual", "art-direction", "palette", "typography"];
  const dimStr = (request.dimensions || "").toLowerCase();
  const isVisualRequest = visualDimensions.some((d) => dimStr.includes(d));
  if (isVisualRequest) {
    if (Array.isArray(record.tags) && record.tags.includes("visual-verified")) {
      value += 25;
    } else if (/help|docs|guide|support|marketing/i.test(record.pageRole || "")) {
      value -= 20;
    }
  }
  return value;
}

export function selectRecords(records, request) {
  const profilePolicy = TAXONOMY.profiles[request.profile];
  if (!profilePolicy) throw new Error("Unknown profile: " + request.profile);
  if (
    !Number.isInteger(request.limit) ||
    request.limit < profilePolicy.min ||
    request.limit > profilePolicy.max
  ) {
    throw new Error(
      "Limit for " +
        request.profile +
        " must be " +
        profilePolicy.min +
        "-" +
        profilePolicy.max,
    );
  }

  const eligible = records
    .filter(
      (record) => record.reviewStatus === "reviewed" && isFresh(record),
    )
    .filter(
      (record) => ["AVAILABLE", "PAYWALLED"].includes(record.accessStatus),
    )
    .map((record) => ({
      record,
      baseScore: scoreRecord(record, request),
    }));
  const quotas =
    request.profile === "deep"
      ? allocateDeep(request.limit)
      : Object.fromEntries(
          Object.keys(TAXONOMY.primaryStrata).map((stratum) => [
            stratum,
            request.limit,
          ]),
        );
  const selected = [];
  const selectedProducts = new Map();
  const selectedSources = new Map();
  const selectedTopologies = new Map();
  const selectedByStratum = {};

  while (selected.length < request.limit) {
    const candidates = eligible
      .filter(({ record }) => !selected.some((item) => item.id === record.id))
      .filter(
        ({ record }) =>
          (selectedByStratum[record.primaryStratum] || 0) <
          quotas[record.primaryStratum],
      )
      .map(({ record, baseScore }) => {
        const diversityPenalty =
          (selectedProducts.get(record.product) || 0) * 20 +
          (selectedSources.get(record.sourceFamily) || 0) * 8 +
          (selectedTopologies.get(record.topology) || 0) * 6;
        return { record, score: baseScore - diversityPenalty };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.record.id.localeCompare(right.record.id),
      );
    if (!candidates.length) break;
    const chosen = candidates[0];
    selected.push({
      ...stripInternal(chosen.record),
      selectionScore: chosen.score,
    });
    selectedByStratum[chosen.record.primaryStratum] =
      (selectedByStratum[chosen.record.primaryStratum] || 0) + 1;
    selectedProducts.set(
      chosen.record.product,
      (selectedProducts.get(chosen.record.product) || 0) + 1,
    );
    selectedSources.set(
      chosen.record.sourceFamily,
      (selectedSources.get(chosen.record.sourceFamily) || 0) + 1,
    );
    selectedTopologies.set(
      chosen.record.topology,
      (selectedTopologies.get(chosen.record.topology) || 0) + 1,
    );
  }

  const coverageGaps = [];
  if (request.profile === "deep") {
    for (const [stratum, quota] of Object.entries(quotas)) {
      const found = selectedByStratum[stratum] || 0;
      if (found < quota) coverageGaps.push({ stratum, required: quota, selected: found });
    }
  }
  if (selected.length < request.limit) {
    coverageGaps.push({
      kind: "total",
      required: request.limit,
      selected: selected.length,
    });
  }
  const exactSurface = selected.filter(
    (record) => record.surfaceFamily === request.surface,
  ).length;
  const exactPlatform = selected.filter(
    (record) => record.platform === request.platform,
  ).length;
  const minimumSurface = {
    quick: 1,
    standard: 3,
    deep: 6,
  }[request.profile];
  const minimumPlatform = Math.ceil(request.limit / 2);
  if (request.surface && exactSurface < minimumSurface) {
    coverageGaps.push({
      kind: "surface",
      value: request.surface,
      required: minimumSurface,
      selected: exactSurface,
    });
  }
  if (request.platform && exactPlatform < minimumPlatform) {
    coverageGaps.push({
      kind: "platform",
      value: request.platform,
      required: minimumPlatform,
      selected: exactPlatform,
    });
  }
  return {
    selected,
    selectedByStratum,
    coverageGaps,
    coverage: { exactSurface, exactPlatform },
  };
}
