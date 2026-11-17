#!/usr/bin/env node
/**
 * CI-only, read-only post-IPC verifier. The administrator-owned SCM lab
 * must have committed one NON-CLAIM reaffirmation and exactly one PRIVATE,
 * protected user-direct Claim after a SECOND synthetic UV gesture.
 * This script NEVER opens an operator PC database or accepts a client path.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

if (process.platform !== 'win32'
  || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.RUNNER_OS !== 'Windows'
  || process.argv.length !== 2
  || !process.env.ProgramData) {
  process.stderr.write('CI-only protected reaffirmation ledger audit.\n');
  process.exit(2);
}
const path = join(process.env.ProgramData,
  'AgentHubMemoryReviewLab-State', 'review-authority.sqlite3');
if (!existsSync(path)) throw new Error('protected_review_ledger_missing');
const db = new DatabaseSync(path, { readOnly: true });
const project = 'github.com/example/operator-evidence', branch = 'main';
try {
  const all = db.prepare(
    'SELECT COUNT(*) AS n FROM protected_operator_reaffirmation_intents'
  ).get().n;
  const receipt = db.prepare(`
    SELECT request_id, fact_sha256, evidence_sha256, source_origin,
           kind, sign_count, policy_version
    FROM protected_operator_reaffirmation_intents
    WHERE project_id=? AND branch=?`).get(project, branch);
  const directCount = db.prepare(
    'SELECT COUNT(*) AS n FROM protected_operator_direct_claims'
  ).get().n;
  const direct = db.prepare(`
    SELECT request_id, project_id, branch, revision_sha,
           proposal_ref, snapshot_sha256, fact_sha256,
           historical_evidence_sha256, kind, value_text, source_origin,
           historical_source_origin, historical_evidence_verified,
           sign_count, policy_version
    FROM protected_operator_direct_claims
    WHERE project_id=? AND branch=?`).get(project, branch);
  const claims = db.prepare(
    'SELECT COUNT(*) AS n FROM protected_review_claims WHERE project_id=? AND branch=?'
  ).get(project, branch).n;
  const intents = db.prepare(`
    SELECT COUNT(*) AS n FROM verified_review_intents v
    JOIN review_requests p ON p.request_id=v.request_id
    WHERE p.project_id=? AND p.branch=?`).get(project, branch).n;
  const source = db.prepare(`
    SELECT kind, source_origin, fact_sha256, evidence_sha256,
           canonical_fact, revision_sha, proposal_ref, snapshot_sha256, relation
    FROM protected_review_sources WHERE request_id=?`).get(receipt?.request_id);
  const credential = db.prepare(
    'SELECT enrollment_state, last_sign_count FROM protected_operator_credentials'
  ).get();
  if(all!==1 || !receipt || !direct || directCount!==1
    || claims!==0 || intents!==0
    || receipt.kind!=='knowledge'
    || receipt.source_origin!=='operator_pinned_unverified_evidence_v1'
    || receipt.policy_version!=='agenthub-operator-reaffirmation-intent-v1'
    || receipt.sign_count!==3
    || source?.kind!=='knowledge'
    || source.source_origin!==receipt.source_origin
    || source.fact_sha256!==receipt.fact_sha256
    || source.evidence_sha256!==receipt.evidence_sha256
    || credential?.enrollment_state!=='operator_native_uv_enrolled_unapproved_v1'
    || credential.last_sign_count!==4
    || direct.request_id!==receipt.request_id
    || direct.project_id!==project || direct.branch!==branch
    || direct.revision_sha!==source.revision_sha
    || direct.proposal_ref!==source.proposal_ref
    || direct.snapshot_sha256!==source.snapshot_sha256
    || direct.fact_sha256!==source.fact_sha256
    || direct.historical_evidence_sha256!==source.evidence_sha256
    || direct.kind!=='knowledge' || source.relation!=='unrelated'
    || direct.value_text!==source.canonical_fact
    || createHash('sha256').update(direct.value_text).digest('hex')!==direct.fact_sha256
    || direct.source_origin!=='user_direct_reaffirmed_and_published_v1'
    || direct.historical_source_origin!=='operator_pinned_unverified_evidence_v1'
    || direct.historical_evidence_verified!==0
    || direct.policy_version!=='agenthub-protected-operator-direct-claim-v1'
    || direct.sign_count!==4)
    throw new Error('native_direct_claim_double_uv_or_provenance_integrity_failed');
  process.stdout.write(JSON.stringify({
    status:'protected_operator_direct_claim_scm_readback_pass',
    intent_rows:1, original_source_verified:false,
    real_claim_rows:1, synthetic_claim_rows:0, verified_review_intent_rows:0,
    codex_published:false, credential_count:4,
    protected_source_kind:'knowledge',
  })+'\n');
} finally {
  db.close();
}
