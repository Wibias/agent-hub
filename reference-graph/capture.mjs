import { createHash } from 'node:crypto';

const UUID_NAMESPACE_URL = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value) {
  if (value === undefined || value === null || value === '') return null;
  return nonEmptyString(value, 'optional string');
}

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function stableUuid(scope, value) {
  const digest = createHash('sha1')
    .update(UUID_NAMESPACE_URL)
    .update(`${scope}\n${String(value)}`, 'utf8')
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function contentHash(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function tagSlug(value) {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized || null;
}

export function normalizeReferenceCapture(input) {
  const root = plainObject(input, 'capture');
  const sourceInput = plainObject(root.source, 'source');
  const assetInput = plainObject(root.asset, 'asset');
  const provenanceInput = plainObject(root.provenance ?? {}, 'provenance');

  const canonicalUrl = nonEmptyString(sourceInput.canonicalUrl, 'source.canonicalUrl');
  const sourceKind = nonEmptyString(sourceInput.sourceKind, 'source.sourceKind');
  const sourceId = stableUuid('source', canonicalUrl);

  const canonicalLocator = nonEmptyString(
    assetInput.canonicalLocator,
    'asset.canonicalLocator',
  );
  const assetKind = nonEmptyString(assetInput.kind, 'asset.kind');
  const capturedAt = nonEmptyString(assetInput.capturedAt, 'asset.capturedAt');
  const textHash = contentHash(assetInput.contentText);
  const assetId = stableUuid(
    'asset',
    `${sourceId}\n${assetKind}\n${canonicalLocator}\n${textHash ?? capturedAt}`,
  );

  const provenance = {
    capture_method: optionalString(provenanceInput.captureMethod),
    captured_by: optionalString(provenanceInput.capturedBy),
    observed_at: optionalString(provenanceInput.observedAt),
    source_ref: optionalString(provenanceInput.sourceRef),
  };

  const tags = [...new Set(
    (Array.isArray(root.tags) ? root.tags : [])
      .map(tagSlug)
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));

  const chunks = [];
  if (typeof assetInput.contentText === 'string' && assetInput.contentText.length > 0) {
    chunks.push({
      id: stableUuid('chunk', `${assetId}\n0\n${assetInput.contentText}`),
      asset_id: assetId,
      ordinal: 0,
      content: assetInput.contentText,
      content_role: 'untrusted_reference_data',
      metadata: {},
    });
  }

  const observations = (Array.isArray(root.observations) ? root.observations : [])
    .map((row, index) => {
      const observation = plainObject(row, `observations[${index}]`);
      const kind = nonEmptyString(observation.kind, `observations[${index}].kind`);
      const body = nonEmptyString(observation.body, `observations[${index}].body`);
      return {
        id: stableUuid('observation', `${assetId}\n${index}\n${kind}\n${body}`),
        asset_id: assetId,
        observation_kind: kind,
        body,
        evidence_class: nonEmptyString(
          observation.evidenceClass,
          `observations[${index}].evidenceClass`,
        ),
        observed_at: optionalString(observation.observedAt) ?? provenance.observed_at,
        metadata: plainObject(observation.metadata ?? {}, `observations[${index}].metadata`),
      };
    });

  return {
    source: {
      id: sourceId,
      canonical_url: canonicalUrl,
      source_kind: sourceKind,
      title: optionalString(sourceInput.title),
      source_family: optionalString(sourceInput.sourceFamily),
      metadata: plainObject(sourceInput.metadata ?? {}, 'source.metadata'),
    },
    asset: {
      id: assetId,
      source_id: sourceId,
      asset_kind: assetKind,
      canonical_locator: canonicalLocator,
      title: optionalString(assetInput.title),
      media_type: optionalString(assetInput.mediaType),
      captured_at: capturedAt,
      content_hash: textHash,
      storage_policy: optionalString(assetInput.storagePolicy),
      provenance,
      metadata: plainObject(assetInput.metadata ?? {}, 'asset.metadata'),
    },
    chunks,
    tags,
    observations,
    relations: Array.isArray(root.relations) ? [...root.relations] : [],
  };
}
