const SHA256 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PROJECT_REF = 'vrznfnxzlxaavpqbzbzd';
const VERSION = 'reference-graph.p40-readonly-source-witness.v1';
const PROJECTION_VERSION = 'reference-graph.profile-runtime.p30.v1';
const MAX_AGE_MS = 4 * 60 * 60 * 1000;
const MAX_WITNESS_AGE_MS = 15 * 60 * 1000;
const FUTURE_SKEW_MS = 60 * 1000;

const KEYS = Object.freeze([
  'schema_version', 'source_method', 'project_ref',
  'projection_version', 'snapshot_date', 'refreshed_at', 'observed_at',
  'expected_candidate_count', 'expected_candidate_id_set_sha256',
  'published_candidate_count', 'published_candidate_id_set_sha256',
  'membership_mismatch_count', 'metadata_mismatch_count',
  'refresh_instant_count', 'activation_authorized',
  'repository_default_graph_enabled',
]);

export class P40ReadOnlyWitnessError extends Error {
  constructor() {
    super('P40 read-only source witness rejected: invalid or stale evidence');
    this.name = 'P40ReadOnlyWitnessError';
  }
}

function reject() {
  throw new P40ReadOnlyWitnessError();
}

function validInstant(value) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function exactKeys(value) {
  return value !== null && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...KEYS].sort());
}

/**
 * Validate a separately pinned, source-versus-projection SQL witness.
 * The witness is an alternative to a future P31 refresh-function receipt,
 * NOT a reconstruction of a lost receipt or an independent signature.
 * The caller must obtain its provenance and SHA-256 from a trusted channel.
 *
 * Pure, no network, no credential, no DB mutation, no routing authorization.
 */
export function validateP40ReadOnlySourceWitness(witness, { asOf } = {}) {
  if (!exactKeys(witness)
    || witness.schema_version !== VERSION
    || witness.source_method !== 'p7-vs-p31-read-only'
    || witness.project_ref !== PROJECT_REF
    || witness.projection_version !== PROJECTION_VERSION
    || typeof witness.snapshot_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(witness.snapshot_date)
    || !validInstant(witness.refreshed_at)
    || !validInstant(witness.observed_at)
    || !validInstant(asOf)
    || witness.snapshot_date !== asOf.slice(0, 10)
    || witness.snapshot_date !== witness.refreshed_at.slice(0, 10)
    || witness.snapshot_date !== witness.observed_at.slice(0, 10)
    || !Number.isInteger(witness.expected_candidate_count)
    || witness.expected_candidate_count < 1
    || witness.expected_candidate_count > 5000
    || witness.published_candidate_count !== witness.expected_candidate_count
    || !SHA256.test(witness.expected_candidate_id_set_sha256)
    || witness.published_candidate_id_set_sha256
      !== witness.expected_candidate_id_set_sha256
    || witness.membership_mismatch_count !== 0
    || witness.metadata_mismatch_count !== 0
    || witness.refresh_instant_count !== 1
    || witness.activation_authorized !== false
    || witness.repository_default_graph_enabled !== false) {
    reject();
  }
  const asOfMs = Date.parse(asOf);
  const observedMs = Date.parse(witness.observed_at);
  const refreshedMs = Date.parse(witness.refreshed_at);
  if (asOfMs - observedMs > MAX_WITNESS_AGE_MS
    || observedMs - asOfMs > FUTURE_SKEW_MS
    || asOfMs - refreshedMs > MAX_AGE_MS
    || refreshedMs - observedMs > FUTURE_SKEW_MS) {
    reject();
  }
  return {
    expected_candidate_count: witness.expected_candidate_count,
    expected_candidate_id_set_sha256: witness.expected_candidate_id_set_sha256,
    snapshot_date: witness.snapshot_date,
    refreshed_at: witness.refreshed_at,
  };
}
