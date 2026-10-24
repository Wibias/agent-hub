function requireQuickRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('request must be an object');
  }
  if (request.profile !== 'quick') {
    throw new Error('quick coverage requires profile quick');
  }
  if (!Number.isInteger(request.limit) || request.limit < 1) {
    throw new TypeError('quick coverage requires a positive integer limit');
  }
  return request;
}

function assertRecordArrays(selectedRecords, remainingRecords) {
  if (!Array.isArray(selectedRecords) || !Array.isArray(remainingRecords)) {
    throw new TypeError('selectedRecords and remainingRecords must be arrays');
  }

  const ids = new Set();
  for (const record of [...selectedRecords, ...remainingRecords]) {
    if (!record || typeof record.id !== 'string' || record.id.length === 0) {
      throw new TypeError('quick coverage records require a non-empty id');
    }
    if (ids.has(record.id)) {
      throw new Error(`duplicate record id: ${record.id}`);
    }
    ids.add(record.id);
  }
}

export function quickCoverageRequirements(request) {
  requireQuickRequest(request);
  return {
    minimumSurface: request.surface ? 1 : 0,
    minimumPlatform: request.platform ? Math.ceil(request.limit / 2) : 0,
  };
}

export function canCompleteQuickCoverage({
  selectedRecords,
  remainingRecords,
  request,
} = {}) {
  requireQuickRequest(request);
  assertRecordArrays(selectedRecords, remainingRecords);

  const slotsRemaining = request.limit - selectedRecords.length;
  if (slotsRemaining < 0 || remainingRecords.length < slotsRemaining) {
    return false;
  }

  const { minimumSurface, minimumPlatform } = quickCoverageRequirements(request);
  const selectedSurface = request.surface
    ? selectedRecords.filter((record) => record.surfaceFamily === request.surface).length
    : 0;
  const selectedPlatform = request.platform
    ? selectedRecords.filter((record) => record.platform === request.platform).length
    : 0;
  const surfaceNeed = Math.max(0, minimumSurface - selectedSurface);
  const platformNeed = Math.max(0, minimumPlatform - selectedPlatform);

  const surfaceAvailable = request.surface
    ? remainingRecords.filter((record) => record.surfaceFamily === request.surface).length
    : 0;
  const platformAvailable = request.platform
    ? remainingRecords.filter((record) => record.platform === request.platform).length
    : 0;
  const bothAvailable = request.surface && request.platform
    ? remainingRecords.filter(
        (record) => record.surfaceFamily === request.surface && record.platform === request.platform,
      ).length
    : 0;

  if (surfaceAvailable < surfaceNeed || platformAvailable < platformNeed) {
    return false;
  }

  const minimumSlotsNeeded = surfaceNeed
    + platformNeed
    - Math.min(bothAvailable, surfaceNeed, platformNeed);

  return minimumSlotsNeeded <= slotsRemaining;
}
