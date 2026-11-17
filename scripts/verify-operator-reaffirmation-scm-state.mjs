#!/usr/bin/env node
/**
 * CI-only, read-only post-IPC verifier. The administrator-owned SCM lab
 * must have committed exactly one NON-CLAIM operator reaffirmation intent.
 * This script NEVER opens an operator PC database or accepts a client path.
 */
import { DatabaseSync } from 'node:sqlite';
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
  const claims = db.prepare(
    'SELECT COUNT(*) AS n FROM protected_review_claims WHERE project_id=? AND branch=?'
  ).get(project, branch).n;
  const intents = db.prepare(`
    SELECT COUNT(*) AS n FROM verified_review_intents v
    JOIN review_requests p ON p.request_id=v.request_id
    WHERE p.project_id=? AND p.branch=?`).get(project, branch).n;
  const source = db.prepare(`
    SELECT kind, source_origin, fact_sha256, evidence_sha256
    FROM protected_review_sources WHERE request_id=?`).get(receipt?.request_id);
  const credential = db.prepare(
    'SELECT enrollment_state, last_sign_count FROM protected_operator_credentials'
  ).get();
  if(all!==1 || !receipt || claims!==0 || intents!==0
    || receipt.kind!=='knowledge'
    || receipt.source_origin!=='operator_pinned_unverified_evidence_v1'
    || receipt.policy_version!=='agenthub-operator-reaffirmation-intent-v1'
    || receipt.sign_count!==3
    || source?.kind!=='knowledge'
    || source.source_origin!==receipt.source_origin
    || source.fact_sha256!==receipt.fact_sha256
    || source.evidence_sha256!==receipt.evidence_sha256
    || credential?.enrollment_state!=='operator_native_uv_enrolled_unapproved_v1'
    || credential.last_sign_count!==3)
    throw new Error('native_reaffirmation_no_claim_integrity_failed');
  process.stdout.write(JSON.stringify({
    status:'protected_operator_reaffirmation_scm_readback_pass',
    intent_rows:1, original_source_verified:false,
    real_claim_rows:0, verified_review_intent_rows:0,
    credential_count:3, protected_source_kind:'knowledge',
  })+'\n');
} finally {
  db.close();
}
