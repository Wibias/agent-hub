#!/usr/bin/env node
/**
 * Prepare an isolated, disposable Evidence-Bound schema for inspection.
 * The source SQLite is opened read-only and backed up via SQLite's online
 * backup API. Schema changes touch ONLY the fresh shadow copy.
 *
 * The snapshot contains the entire private Memory DB. It is untrusted,
 * user-writable, not an operator-approved export and must never be uploaded.
 * No model calls, fake judgments, status transitions or Claims are made.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ensureEvidenceProposalSchema } from '../memory-engine/evidence-bound-proposal-store.mjs';

const REQUIRED_TABLES = ['project_registry', 'evidence', 'claims', 'memory_candidates'];
const PROPOSAL_TABLES = [
  'memory_evidence_proposals',
  'memory_evidence_proposal_evidence',
  'memory_evidence_proposal_relations',
  'memory_evidence_proposal_promotions',
];

export function parseEvidenceShadowArgs(argv = []) {
  const args = {};
  const map = new Map([
    ['--db-path', 'dbPath'], ['--output-dir', 'outputDir'],
    ['--project-id', 'projectId'], ['--branch', 'branch'],
  ]);
  if (argv.length !== 8) throw new Error('four exact flag/value pairs required');
  for (let index = 0; index < argv.length; index += 2) {
    const key = map.get(argv[index]);
    const value = argv[index + 1];
    if (!key || Object.hasOwn(args, key) || typeof value !== 'string'
      || !value.trim() || value !== value.trim()) {
      throw new Error('invalid or repeated argument');
    }
    args[key] = value;
  }
  if (Object.keys(args).length !== 4) throw new Error('incomplete arguments');
  for (const key of ['dbPath', 'outputDir']) {
    if (!isAbsolute(args[key])) throw new Error('absolute paths required');
    args[key] = resolve(args[key]);
  }
  return args;
}

function tableNames(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all().map(row => row.name));
}

function count(db, sql, ...args) {
  return Number(db.prepare(sql).get(...args).n);
}

function snapshotCounts(db, projectId, branch) {
  const names = tableNames(db);
  const scope = [projectId, branch];
  return {
    evidence: count(db, 'SELECT COUNT(*) AS n FROM evidence WHERE project_id=? AND branch=?', ...scope),
    candidates: count(db, 'SELECT COUNT(*) AS n FROM memory_candidates WHERE project_id=? AND branch=?', ...scope),
    claims: count(db, 'SELECT COUNT(*) AS n FROM claims WHERE project_id=? AND branch_scope=?', ...scope),
    proposals: names.has('memory_evidence_proposals')
      ? count(db, 'SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE project_id=? AND branch=?', ...scope) : 0,
    needsConfirmation: names.has('memory_evidence_proposals')
      ? count(db, "SELECT COUNT(*) AS n FROM memory_evidence_proposals WHERE project_id=? AND branch=? AND status='needs_confirmation'", ...scope) : 0,
  };
}

function safeOutputLocation(dbPath, outputDir) {
  const source = lstatSync(dbPath);
  if (!source.isFile() || source.isSymbolicLink()) {
    throw new Error('source must be an ordinary SQLite file');
  }
  if (existsSync(outputDir)) throw new Error('output directory must not exist');
  const parent = realpathSync(dirname(outputDir));
  const parentInfo = lstatSync(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new Error('output parent must be an ordinary directory');
  }
  const sourceDir = realpathSync(dirname(dbPath));
  // Never place a full private copy inside the original DB directory.
  // A fresh sibling under LOCALAPPDATA is the recommended local layout.
  const withinSource = relative(sourceDir, parent);
  if (withinSource === '' || (!withinSource.startsWith('..' + sep)
    && withinSource !== '..' && !isAbsolute(withinSource))) {
    throw new Error('output must be outside the canonical DB directory');
  }
  if (dirname(outputDir) === outputDir) throw new Error('invalid output directory');
  if (resolve(dbPath) === resolve(join(outputDir, 'memory-shadow.sqlite3'))) {
    throw new Error('shadow must not replace source');
  }
}

function validateShadow(db) {
  const quick = String(db.prepare('PRAGMA quick_check').get()?.quick_check ?? '');
  if (quick !== 'ok') throw new Error('shadow SQLite quick_check failed');
  if (db.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    throw new Error('shadow SQLite foreign key check failed');
  }
}

/**
 * The only source connection is READ ONLY. All schema mutations are scoped
 * to a fresh, byte-independent SQLite backup in outputDir.
 */
export async function prepareMemoryEvidenceShadow({
  dbPath, outputDir, projectId, branch,
  backupSqlite = backup,
} = {}) {
  if ([dbPath, outputDir, projectId, branch].some(
    value => typeof value !== 'string' || !value.trim(),
  ) || !isAbsolute(dbPath) || !isAbsolute(outputDir)
    || typeof backupSqlite !== 'function') {
    throw new TypeError('absolute paths and exact project/branch required');
  }
  const sourcePath = resolve(dbPath);
  const targetDir = resolve(outputDir);
  safeOutputLocation(sourcePath, targetDir);
  const source = new DatabaseSync(sourcePath, { readOnly: true, timeout: 5_000 });
  let created = false;
  try {
    source.exec('PRAGMA query_only=ON');
    const names = tableNames(source);
    if (REQUIRED_TABLES.some(name => !names.has(name))) {
      throw new Error('canonical memory schema incomplete');
    }
    if (!source.prepare('SELECT project_id FROM project_registry WHERE project_id=?')
      .get(projectId)) {
      throw new Error('project is not registered in canonical memory DB');
    }

    mkdirSync(targetDir, { recursive: false, mode: 0o700 });
    created = true;
    const shadowPath = join(targetDir, 'memory-shadow.sqlite3');
    // SQLite backup is consistent with concurrent WAL activity; raw file
    // copying is not safe for the canonical database.
    await backupSqlite(source, shadowPath, { source: 'main', target: 'main', rate: 100 });

    const shadow = new DatabaseSync(shadowPath, { timeout: 5_000 });
    let before;
    let after;
    let alreadyConfigured;
    try {
      shadow.exec('PRAGMA foreign_keys=ON');
      validateShadow(shadow);
      before = snapshotCounts(shadow, projectId, branch);
      alreadyConfigured = tableNames(shadow).has('memory_evidence_proposals');
      ensureEvidenceProposalSchema(shadow);
      validateShadow(shadow);
      const updated = tableNames(shadow);
      if (PROPOSAL_TABLES.some(name => !updated.has(name))) {
        throw new Error('shadow evidence schema incomplete');
      }
      after = snapshotCounts(shadow, projectId, branch);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error('shadow counts changed during schema initialization');
      }
    } finally {
      shadow.close();
    }
    return {
      status: 'isolated_evidence_shadow_ready_unjudged',
      outputDirectory: targetDir,
      shadowDatabase: shadowPath,
      projectId,
      branch,
      sourceOpenedReadOnly: true,
      sourceDatabaseModifiedByTool: false,
      shadowSchemaInitialized: true,
      evidenceBoundLedgerPreviouslyPresent: alreadyConfigured,
      counts: after,
      modelInvocations: 0,
      decisionsApplied: 0,
      claimsCreated: 0,
      protectedApproval: false,
      note: 'Full private canonical Memory DB copied. No new E~ proposal or model judgment was generated. Never upload the shadow SQLite or use it as a protected operator source.',
    };
  } catch (error) {
    if (created) rmSync(targetDir, { recursive: true, force: true });
    throw error;
  } finally {
    source.close();
  }
}

const entry = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (entry) {
  prepareMemoryEvidenceShadow(parseEvidenceShadowArgs(process.argv.slice(2)))
    .then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch(() => {
      process.stderr.write('SHADOW_PREPARATION_FAILED: check input, scope and new output directory.\n');
      process.exitCode = 1;
    });
}
