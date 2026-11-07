import { createHash } from 'node:crypto';

import { TAXONOMY } from '../knowledge/design-references/scripts/lib.mjs';
import { buildP8OfflineQuickCandidatePool } from './p8-cutover-review.mjs';

const CANDIDATE_KEYS = Object.freeze([
  'asset_id', 'legacy_id', 'search_text',
  'product', 'surface_family', 'platform', 'page_role',
  'motion', 'source_family', 'topology', 'access_status',
  'evidence_class', 'ordinary_or_failure_prone',
  'multi_state_flow', 'tags', 'primary_stratum',
]);
const ALLOWED_STRATA = Object.freeze(Object.keys(TAXONOMY.primaryStrata));
const HEX64 = /^[0-9a-f]{64}$/;

function exactKeys(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const keys = Object.keys(row).sort();
  const allowed = [...CANDIDATE_KEYS].sort();
  return keys.length === allowed.length
    && keys.every((key, index) => key === allowed[index]);
}

function candidateIdSetHash(candidates) {
  const ids = candidates
    .filter(row => row && typeof row.legacy_id === 'string')
    .map(row => row.legacy_id)
    .sort();
  return createHash('sha256').update(ids.join('\n'), 'utf8').digest('hex');
}

/**
 * Build an in-memory, offline-only projection for schema design and tests.
 * NOT backed by a public P10/P28 database view and NOT graph parity evidence.
 * P8's reviewed/current accessible pool remains the sole source of candidates.
 */
export function buildP28OfflineProfileCandidatePool({ records, now } = {}) {
  if (!Array.isArray(records)) throw new TypeError('P28 records must be an array');
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) {
    throw new TypeError('P28 now must be a valid Date');
  }

  const sourceById = new Map();
  for (const row of records) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
        || typeof row.id !== 'string' || !row.id.trim()) {
      throw new TypeError('P28 source record identity must be a non-empty string');
    }
    if (sourceById.has(row.id)) throw new Error('P28 duplicate source record identity');
    sourceById.set(row.id, row);
  }

  const p8Candidates = buildP8OfflineQuickCandidatePool(records, { now });
  return p8Candidates.map(candidate => {
    const source = sourceById.get(candidate.legacy_id);
    if (!source || !Object.hasOwn(TAXONOMY.primaryStrata, source.primaryStratum)) {
      throw new Error('P28 source candidate has invalid primary stratum');
    }
    return {
      ...candidate,
      primary_stratum: source.primaryStratum,
    };
  });
}

/**
 * Strict structural contract audit only. Never treats metadata completeness
 * as Graph selection parity, authorization or deployment readiness.
 * Never returns candidate IDs, search text, local record contents or secrets.
 */
export function auditP28ProfileCandidateContract({ candidates } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError('P28 candidates must be a non-empty array');
  }

  const blockers = new Set();
  const assetIds = new Set();
  const legacyIds = new Set();
  const stratumCounts = Object.fromEntries(ALLOWED_STRATA.map(stratum => [stratum, 0]));
  for (const row of candidates) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      blockers.add('malformed-candidate');
      continue;
    }

    const values = [row.asset_id, row.legacy_id];
    if (values.some(x => typeof x !== 'string' || !x.trim())) {
      blockers.add('invalid-candidate-identity');
    } else {
      if (assetIds.has(row.asset_id) || legacyIds.has(row.legacy_id)) {
        blockers.add('duplicate-candidate-identity');
      }
      assetIds.add(row.asset_id);
      legacyIds.add(row.legacy_id);
    }

    if (!Object.hasOwn(row, 'primary_stratum') || row.primary_stratum === undefined
        || row.primary_stratum === null) {
      blockers.add('missing-primary-stratum');
    } else if (!Object.hasOwn(TAXONOMY.primaryStrata, row.primary_stratum)) {
      blockers.add('invalid-primary-stratum');
    } else {
      stratumCounts[row.primary_stratum] += 1;
    }

    if (!exactKeys(row)) {
      const otherKeys = Object.keys(row).filter(key => !CANDIDATE_KEYS.includes(key));
      if (otherKeys.length > 0) blockers.add('unexpected-candidate-fields');
      const missing = CANDIDATE_KEYS.filter(key => !Object.hasOwn(row, key));
      if (missing.some(key => key !== 'primary_stratum')) {
        blockers.add('missing-candidate-fields');
      }
    }

    if (typeof row.search_text !== 'string' || !Array.isArray(row.tags)
        || typeof row.ordinary_or_failure_prone !== 'boolean'
        || typeof row.multi_state_flow !== 'boolean') {
      blockers.add('invalid-candidate-metadata');
    }
  }

  return {
    schema_version: 'reference-graph.p28-profile-candidate-audit.v1',
    candidate_count: candidates.length,
    stratum_counts: stratumCounts,
    candidate_id_set_sha256: candidateIdSetHash(candidates),
    metadata_contract_complete: blockers.size === 0,
    blockers: [...blockers].sort(),
    graph_parity_verified: false,
    repository_default_graph_enabled: false,
    activation_performed: false,
  };
}
