import { createHash } from 'node:crypto';

// A deterministic binding of the ENTIRE P28 candidate payload, not just
// legacy_id membership. It is safe to include only the digest in redacted
// P33/P34 audit receipts: never include raw candidates or search text.
const FIELDS = Object.freeze([
  'asset_id', 'legacy_id', 'search_text', 'product', 'surface_family',
  'platform', 'page_role', 'motion', 'source_family', 'topology',
  'access_status', 'evidence_class', 'ordinary_or_failure_prone',
  'multi_state_flow', 'tags', 'primary_stratum',
]);
const SORTED_FIELDS = Object.freeze([...FIELDS].sort());
const MAX_CANDIDATES = 5000;
const DOMAIN = 'reference-graph.p33-candidate-content.v1\n';

export function hashP33CandidateContent(candidates) {
  if (!Array.isArray(candidates)
    || candidates.length === 0 || candidates.length > MAX_CANDIDATES) {
    throw new TypeError('P33 candidate digest input invalid');
  }

  const sorted = [...candidates].sort((a, b) => {
    const left = typeof a?.asset_id === 'string' ? a.asset_id : '';
    const right = typeof b?.asset_id === 'string' ? b.asset_id : '';
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const hash = createHash('sha256');
  hash.update(DOMAIN, 'utf8');
  hash.update(String(sorted.length) + '\n', 'utf8');
  let previousAssetId = null;

  for (const row of sorted) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(SORTED_FIELDS)
      || typeof row.asset_id !== 'string' || !row.asset_id
      || (previousAssetId !== null && row.asset_id <= previousAssetId)) {
      throw new TypeError('P33 candidate digest input invalid');
    }
    previousAssetId = row.asset_id;

    // Field ordering is fixed, irrespective of JSON object-property order
    // or the order in which the input candidates were supplied. Ordered
    // tag arrays, nulls, exact strings, and all other DTO values are bound.
    hash.update(JSON.stringify(FIELDS.map(key => row[key])) + '\n', 'utf8');
  }
  return hash.digest('hex');
}
