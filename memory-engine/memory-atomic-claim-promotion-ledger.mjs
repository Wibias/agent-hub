/**
 * Optional one-way provenance audit for an atomic canonical Claim.
 * Installation is explicit, never a constructor or capture-hook side effect.
 */
export const ATOMIC_CLAIM_PROMOTION_SCHEMA_SQL = [
  'CREATE TABLE IF NOT EXISTS memory_atomic_rule_claim_promotions (',
  'stage_id TEXT PRIMARY KEY REFERENCES memory_atomic_rule_staging(id),',
  'claim_id TEXT NOT NULL UNIQUE REFERENCES claims(id),',
  'promotion_policy TEXT NOT NULL,',
  'promoted_at TEXT NOT NULL',
  ') STRICT;',
  'CREATE INDEX IF NOT EXISTS memory_atomic_rule_claim_promotions_claim',
  'ON memory_atomic_rule_claim_promotions (claim_id);',
].join('\n');

export const ATOMIC_CLAIM_PROMOTION_POLICY_VERSION = 'atomic-claim-promotion-v1';

export function installAtomicClaimPromotionSchema(db) {
  if(!db || typeof db.exec!=='function' || typeof db.prepare!=='function'){
    throw new TypeError('SQLite database is required');
  }
  if(db.prepare('PRAGMA foreign_keys').get().foreign_keys!==1){
    throw new Error('foreign key constraints must be enabled');
  }
  const stage=db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_atomic_rule_staging'"
  ).get();
  if(!stage)throw new Error('atomic staging schema must be installed separately first');
  db.exec(ATOMIC_CLAIM_PROMOTION_SCHEMA_SQL);
}
