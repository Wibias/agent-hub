import { DatabaseSync } from 'node:sqlite';

const [dbPath, encodedPayload] = process.argv.slice(2);
if (!dbPath || !encodedPayload) {
  throw new Error('usage: interrupt-sqlite-writer.mjs <dbPath> <base64Payload>');
}

const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
const db = new DatabaseSync(dbPath, {
  timeout: 5_000,
  enableForeignKeyConstraints: true,
});

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  BEGIN IMMEDIATE;
`);

db.prepare(`
  INSERT INTO evidence (
    id, project_id, harness, session_id, source_kind, source_ref,
    captured_at, branch, commit_sha, path, blob_oid, content_redacted,
    sensitivity, authority_class, metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  payload.id,
  payload.projectId,
  payload.harness,
  payload.sessionId,
  payload.sourceKind,
  payload.sourceRef,
  payload.capturedAt,
  payload.branch,
  payload.commitSha,
  payload.path,
  payload.blobOid,
  payload.content,
  payload.sensitivity,
  payload.authorityClass,
  payload.metadataJson,
);

process.stdout.write('PARTIAL_WRITE_READY\n');

// Keep the uncommitted transaction open until the parent kills this process.
setInterval(() => {}, 60_000);
