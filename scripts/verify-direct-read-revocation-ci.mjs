#!/usr/bin/env node
// CI-only read-only audit of the ACTUAL protected LocalService WAL.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.platform !== 'win32'
    || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.RUNNER_OS !== 'Windows'
    || process.argv.length !== 2
    || !process.env.ProgramData)
  throw new Error('ci_only_protected_direct_revocation_audit');

const state = join(process.env.ProgramData, 'AgentHubMemoryReviewLab-State');
const sqlite = join(state, 'review-authority.sqlite3');
if (!existsSync(sqlite)) throw new Error('protected_wal_missing');

const db = new DatabaseSync(sqlite, { readOnly: true });
try {
  const rows = db.prepare(`
    SELECT lane,event_number,event_kind,policy_sha256,principal_sid,
           project_id,branch,revision_sha,policy_version
    FROM protected_direct_read_enrollment_events
    ORDER BY lane,event_number
  `).all();
  if (rows.length !== 4) throw new Error('revocation_event_count_invalid');
  for (const [lane, file] of [
    ['admin-direct-ci','agenthub-direct-read-ci-only.json'],
    ['user-direct-ci','agenthub-user-direct-read-ci-only.json'],
  ]) {
    const events = rows.filter(r => r.lane === lane);
    if (events.length !== 2 || events[0].event_number !== 1
        || events[0].event_kind !== 'enrolled'
        || events[1].event_number !== 2
        || events[1].event_kind !== 'revoked')
      throw new Error('revocation_event_sequence_invalid');
    const originalHash = createHash('sha256')
      .update(readFileSync(join(state, file))).digest('hex');
    for (const event of events) {
      if (event.policy_sha256 !== originalHash
          || event.project_id !== 'github.com/example/operator-evidence'
          || event.branch !== 'main'
          || !/^[0-9a-f]{40}$/.test(event.revision_sha)
          || !/^S-1-5-21-(?:[0-9]+-){2,}[0-9]+$/.test(event.principal_sid)
          || event.policy_version !== 'agenthub-direct-read-enrollment-ledger-ci-v1'
          || event.revision_sha !== events[0].revision_sha
          || event.principal_sid !== events[0].principal_sid)
        throw new Error('revocation_policy_scope_or_hash_invalid');
    }
  }
  const direct = db.prepare(
    'SELECT COUNT(*) AS n FROM protected_operator_direct_claims'
  ).get().n;
  const cred = db.prepare(
    'SELECT last_sign_count FROM protected_operator_credentials'
  ).get();
  if (direct !== 1 || cred?.last_sign_count !== 4)
    throw new Error('revocation_corrupted_private_claim_or_counter');
  process.stdout.write(JSON.stringify({
    status: 'durable_direct_ci_read_revocation_survived_scm_restart',
    event_rows: 4, revoked_lanes: 2,
    private_direct_claim_rows: 1, credential_sign_count: 4,
    reenable_authorized: false, production_no_go: true,
  }) + '\n');
} finally {
  db.close();
}
