/**
 * A user_direct label says how an event was classified, not that it actually
 * came from a human. Historical end-to-end seeds have user_direct labels.
 * Keep synthetic provenance out of model-visible Memory-Read results without
 * altering or deleting canonical rows.
 *
 * Only inspect structured provenance identifiers/metadata, never claim text:
 * a genuine decision *about* test fixtures must remain eligible.
 */
const SYNTHETIC_PROVENANCE = /(?:^|[:/])(?:runtime[-_]e2e[-_]seed(?:[-_:]|$)|(?:test|synthetic)[-_](?:fixture|seed)(?:[-_:]|$))/i;
const SYNTHETIC_ORIGINS = new Set([
  'fixture',
  'test_fixture',
  'synthetic',
  'synthetic_fixture',
  'synthetic_seed',
  'test_seed',
  'e2e_seed',
]);

function hasFixtureMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  if (metadata.test_fixture === true || metadata.synthetic_fixture === true
    || metadata.is_test_data === true || metadata.synthetic === true) {
    return true;
  }
  const origin = metadata.origin ?? metadata.provenance_kind ?? metadata.source_origin;
  return typeof origin === 'string' && SYNTHETIC_ORIGINS.has(origin.toLowerCase());
}

function markedIdentifier(value) {
  return typeof value === 'string' && SYNTHETIC_PROVENANCE.test(value);
}

export function isSyntheticMemoryEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return false;
  return (
    markedIdentifier(evidence.id)
    || markedIdentifier(evidence.session_id)
    || markedIdentifier(evidence.source_ref)
    || hasFixtureMetadata(evidence.metadata)
  );
}

export function isSyntheticMemoryItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (markedIdentifier(item.claim?.id) || isSyntheticMemoryEvidence(item.evidence)) {
    return true;
  }
  // Provenance is a non-enumerable property attached by MemoryEngine.
  // A synthetic supporting Evidence row must not launder a real primary claim.
  return Array.isArray(item.provenance)
    && item.provenance.some((entry) => isSyntheticMemoryEvidence(entry?.evidence));
}
