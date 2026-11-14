#!/usr/bin/env node
/**
 * Disposable CI-only real-schema E~ source for the existing restricted SCM
 * service. This constructs canonical E~ + linked Evidence tables, NOT a
 * fabricated approved Claim. Refuses outside GitHub Windows runner.
 */
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { EVIDENCE_PROPOSAL_SCHEMA_SQL } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import { evidenceExtractionFingerprint } from '../../memory-engine/evidence-bound-extraction.mjs';
import { existsSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { exportProtectedEvidenceReview, EVIDENCE_SNAPSHOT_NAME, EVIDENCE_MANIFEST_NAME } from '../../scripts/export-protected-evidence-review.mjs';
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
const targetSnapshot = join(stateRoot, EVIDENCE_SNAPSHOT_NAME);
const targetManifest = join(stateRoot, EVIDENCE_MANIFEST_NAME);
if (existsSync(targetSnapshot) || existsSync(targetManifest)) {
  process.stderr.write('Refusing to overwrite pre-existing operator source.\\n');
  process.exit(2);
}
// Full transfer: a real Git checkout and canonical user-writable schema,
// followed by read-only preflight and a consistent SQLite backup, then an
// explicit CI-operator copy to the previously admin/SID-protected directory.
const scratch = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(),
  'agenthub-evidence-transfer-'));
const repoRoot = join(scratch, 'repo');
mkdirSync(repoRoot);
const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], {
  encoding: 'utf8', windowsHide: true, timeout: 5000,
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
git('init', '-b', 'main');
git('config', 'user.email', 'operator-fixture@example.invalid');
git('config', 'user.name', 'Protected Source Fixture');
git('config', 'commit.gpgsign', 'false');
git('remote', 'add', 'origin', 'https://github.com/example/operator-evidence.git');
writeFileSync(join(repoRoot, 'README.md'), 'Operator E~ source transfer');
git('add', 'README.md');
git('commit', '-m', 'fixture');
const source = join(scratch, 'canonical-memory.sqlite3');
const exportDir = join(scratch, 'unprivileged-export');

const projectId = 'github.com/example/operator-evidence';
const branch = 'main';
const revisionSha = git('rev-parse', 'HEAD');
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
  `);
  // Use the EXACT shipped canonical Evidence-Bound proposal schema, not
  // a simplified lookalike CI table. This genuinely exercises the live
  // extraction-to-protected-pending data boundary.
  db.exec(EVIDENCE_PROPOSAL_SCHEMA_SQL);
  db.prepare('INSERT INTO project_registry (project_id) VALUES (?)').run(projectId);
  db.prepare(`INSERT INTO evidence
    (id, project_id, branch, authority_class, sensitivity,
     content_redacted, metadata_json) VALUES (?,?,?,?,?,?,?)`
  ).run(evidenceId, projectId, branch, 'user_direct', 'normal',
    'User text submitted as Evidence, origin unverified.', '{"event_type":"user_prompt"}');
  db.prepare(`INSERT INTO memory_evidence_proposals
    (id,project_id,branch,kind,canonical_fact,status,policy_version,
     evaluator_id,fingerprint,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(proposalId, projectId, branch, 'knowledge', fact,
    'needs_confirmation', 'ci-canonical-evidence-v1',
    'trusted-ci-fixture-builder',
    evidenceExtractionFingerprint({ kind: 'knowledge', canonicalFact: fact }),
    '2026-11-14T19:00:00.000Z');
  db.prepare(`INSERT INTO memory_evidence_proposal_evidence
    (proposal_id,evidence_id,linked_at) VALUES (?,?,?)`)
    .run(proposalId, evidenceId, '2026-11-14T19:00:00.000Z');
} finally {
  db.close();
}
const exported = await exportProtectedEvidenceReview({
  dbPath: source, repoPath: repoRoot,
  proposalRef, decision: 'confirm', outputDir: exportDir,
});
if (exported.protectedServiceImportCompleted
    || exported.claimWritten || exported.humanApprovalVerified
    || exported.revisionSha !== revisionSha
    || exported.status !== 'operator_transfer_ready_unverified_unapproved') {
  throw new Error('incorrect operator export trust boundary');
}
// Only the GitHub runner is elevated here. Its previously checked state DACL
// protects these copies; the actual service accepts no source input path.
copyFileSync(join(exportDir, EVIDENCE_SNAPSHOT_NAME), targetSnapshot);
copyFileSync(join(exportDir, EVIDENCE_MANIFEST_NAME), targetManifest);
// A disposable P-256 PUBLIC KEY simulates a candidate registration source.
// There is deliberately NO human or WebAuthn browser registration in CI;
// it may only be staged with "operator_pinned_unverified" status.
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = keys.publicKey;
// The synthetic PRIVATE key remains OUTSIDE the LocalService's protected
// state and is never sent over IPC. CI uses it solely to prove end-to-end
// challenge transport, not real Windows Hello human consent.
const privateFixture = join(process.env.RUNNER_TEMP,
  'AgentHubMemoryReviewLab-TestOperatorPrivateKey.pem');
writeFileSync(privateFixture, keys.privateKey.export({
  format: 'pem', type: 'pkcs8',
}), { flag: 'wx' });
writeFileSync(join(stateRoot, 'operator-webauthn-credential.json'),
  JSON.stringify({
    protocol: 'agenthub-operator-credential-pin-v1',
    credentialId: randomBytes(32).toString('base64url'),
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }),
    expectedOrigin: 'http://localhost:4328',
  }), { flag: 'wx' });
rmSync(scratch, { recursive: true, force: true });
process.stdout.write('REAL_EVIDENCE_GIT_TO_SERVICE_SOURCE_PREPARED_NO_AUTHORITY '
  + proposalRef + '\\n');
