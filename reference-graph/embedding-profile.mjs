export const REFERENCE_EMBEDDING_PROFILE = Object.freeze({
  id: 'snowflake-arctic-embed-33m-raw-v1',
  modelTag: 'snowflake-arctic-embed:33m',
  modelRevision: 'e8db018629b4',
  dimensions: 384,
  queryPrefix: 'Represent this sentence for searching relevant passages: ',
  qualityStatus: 'experimental',
  cutoverApproved: false,
});

export function createProfileQueryProvider(documentProvider) {
  if (!documentProvider || typeof documentProvider.embed !== 'function') {
    throw new TypeError('documentProvider.embed must be a function');
  }
  const modelId = String(documentProvider.modelId ?? '').trim();
  const modelRevision = String(documentProvider.modelRevision ?? '').trim();
  if (!modelId) throw new TypeError('documentProvider.modelId must be non-empty');
  if (!modelRevision) throw new TypeError('documentProvider.modelRevision must be non-empty');

  return {
    modelId,
    modelRevision,
    async embed(texts) {
      if (!Array.isArray(texts)) throw new TypeError('texts must be an array');
      return documentProvider.embed(
        texts.map((text, index) => {
          if (typeof text !== 'string' || text.trim().length === 0) {
            throw new TypeError(`texts[${index}] must be a non-empty string`);
          }
          return `${REFERENCE_EMBEDDING_PROFILE.queryPrefix}${text}`;
        }),
      );
    },
  };
}
