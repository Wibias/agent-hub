#!/usr/bin/env node
/**
 * Disposable CI-only real-schema E~ source for the existing restricted SCM
 * service. This constructs canonical E~ + linked Evidence tables, NOT a
 * fabricated approved Claim. Refuses outside GitHub Windows runner.
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Windows'
    || process.argv.length !== 3 || !isAbsolute(process.argv[2])) {
  process.stderr.write('Disposable Windows SCM fixture only.\n');
  process.exit(2);
}
const stateRoot = process.argv[2];
if (!existsSync(stateRoot) || !stateRoot.endsWith('AgentHubMemoryReviewLab-State')) {
  process.stderr.write('Expected service-owned disposable lab state directory.\n');
  process.exit(2);
}
const source = join(stateRoot, 'operator-evidence-snapshot.sqlite3');
const manifest = join(stateRoot, 'operator-evidence-manifest.json');
if (existsSync(source) || existsSync(manifest)) {
  process.stderr.write('Refusing to overwrite a pre-existing candidate snapshot.\n');
  process.exit(2);
}

const projectId = 'github.com/example/operator-evidence';
const branch = 'main';
const revisionSha = 'b'.repeat(40);
const proposalId = 'actual-canonical-evidence-proposal-id';
const evidenceId = 'actual-canonical-evidence-id';
const fact = 'This real-schema E~ proposal has linked Evidence but no human approval.';
const proposalRef = 'E~' + createHash('sha256')
  .update(proposalId, 'utf8').digest('hex').slice(0, 10);
const db = new DatabaseSync(source);
try {
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE project_registry (project_id TEXT PRIMARY KEY);
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, branch TEXT NOT NULL,
      authority_class TEXT NOT NULL, sensitivity TEXT NOT NULL,
      content_redacted TEXT NOT NULL, metadata_json TEXT
    );
    CREATE TABLE claims (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      branch_scope TEXT NOT NULL, state TEXT NOT NULL, value_text TEXT NOT NULL
    );
    CREATE TABLE memory_evidence_proposals (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, branch TEXT NOT NULL,
      kind TEXT NOT NULL, canonical_fact TEXT NOT NULL,
      status TEXT NOT NULL, policy_version TEXT NOT NULL
    );
    CREATE TABLE memory_evidence_proposal_evidence (
      proposal_id TEXT NOT NULL, evidence_id TEXT NOT NULL,
      PRIMARY KEY (proposal_id, evidence_id)
    );
  `);
  db.prepare('INSERT INTO project_registry (project_id) VALUES (?)').run(projectId);
  db.prepare(`INSERT INTO evidence
    (id, project_id, branch, authority_class, sensitivity,
     content_redacted, metadata_json) VALUES (?,?,?,?,?,?,?)`
  ).run(evidenceId, projectId, branch, 'user_direct', 'normal',
    'User text submitted as Evidence, origin unverified.', '{"event_type":"user_prompt"}');
  db.prepare(`INSERT INTO memory_evidence_proposals
    (id,project_id,branch,kind,canonical_fact,status,policy_version)
    VALUES (?,?,?,?,?,?,?)`
  ).run(proposalId, projectId, branch, 'knowledge', fact,
    'needs_confirmation', 'ci-canonical-evidence-v1');
  db.prepare(`INSERT INTO memory_evidence_proposal_evidence
    (proposal_id,evidence_id) VALUES (?,?)`).run(proposalId, evidenceId);
} finally {
  db.close();
}
writeFileSync(manifest, JSON.stringify({
  projectId, branch, revisionSha, proposalRef, decision: 'confirm',
}), { flag: 'wx', encoding: 'utf8' });
process.stdout.write('REAL_EVIDENCE_FIXTURE_PREPARED_NO_AUTHORITY ' + proposalRef + '\n');
