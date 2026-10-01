import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  join,
  resolve,
} from 'node:path';
import {
  backup as sqliteBackup,
  DatabaseSync,
} from 'node:sqlite';

import { inspectMemoryDatabase } from './memory-doctor.mjs';
import {
  acquireMemoryRestoreLock,
} from './memory-maintenance-lock.mjs';

export const BACKUP_FORMAT_VERSION = 1;

const MANIFEST_TYPE = 'agent_hub_memory_backup_manifest';
const DATABASE_FILE = 'memory.sqlite3';
const SIDECAR_SUFFIXES = ['', '-wal', '-shm', '-journal'];

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function isoNow(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('now() must return a valid date');
  }
  return date.toISOString();
}

function fileStamp(iso) {
  return iso
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/u, 'Z');
}

function defaultNonce() {
  return randomBytes(6).toString('hex');
}

export function defaultMemoryBackupRoot(dbPath) {
  if (typeof dbPath !== 'string' || dbPath.trim().length === 0) {
    throw new TypeError('dbPath must be a non-empty string');
  }
  return join(dirname(resolve(dbPath)), 'backups');
}

async function sha256File(path) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectPromise);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

function openDatabase(path, {
  readOnly = false,
} = {}) {
  return new DatabaseSync(path, {
    readOnly,
    timeout: 5_000,
    enableForeignKeyConstraints: true,
  });
}

function requireValidDatabaseInspection(inspection, label) {
  if (
    inspection?.quickCheck !== 'ok'
    || inspection?.foreignKeyViolations !== 0
    || !Array.isArray(inspection?.missingTables)
    || inspection.missingTables.length !== 0
  ) {
    throw new Error(
      label + ' failed SQLite integrity validation: '
      + (inspection?.error || inspection?.quickCheck || 'invalid schema'),
    );
  }
}

function countRows(db, table) {
  return Number(
    db.prepare('SELECT COUNT(*) AS count FROM ' + table).get()?.count ?? 0,
  );
}

function readCounts(dbPath) {
  const db = openDatabase(dbPath, { readOnly: true });
  try {
    return {
      projects: countRows(db, 'project_registry'),
      evidence: countRows(db, 'evidence'),
      claims: countRows(db, 'claims'),
      embeddings: countRows(db, 'claim_embeddings'),
      conflicts: countRows(db, 'conflicts'),
      approvals: countRows(db, 'approvals'),
    };
  } finally {
    db.close();
  }
}

function countsEqual(left, right) {
  const keys = [
    'projects',
    'evidence',
    'claims',
    'embeddings',
    'conflicts',
    'approvals',
  ];
  return keys.every(
    (key) => Number(left?.[key]) === Number(right?.[key]),
  );
}

function normalizePortableBackupDatabase(dbPath) {
  const db = openDatabase(dbPath);
  try {
    db.exec('PRAGMA journal_mode = DELETE;');
  } finally {
    db.close();
  }
}

function enableWal(dbPath) {
  const db = openDatabase(dbPath);
  try {
    db.exec('PRAGMA journal_mode = WAL;');
  } finally {
    db.close();
  }
}

async function removeDatabaseFamily(dbPath) {
  for (const suffix of SIDECAR_SUFFIXES) {
    await rm(dbPath + suffix, { force: true });
  }
}

async function inspectStandaloneDatabase(dbPath) {
  const inspection = inspectMemoryDatabase({ dbPath });
  requireValidDatabaseInspection(inspection, 'database');
  return inspection;
}

async function createBackupFromOpenDatabase({
  sourceDb,
  backupRoot,
  kind,
  now,
  nonce,
  onlineBackup,
}) {
  const createdAt = isoNow(now);
  const token = nonce();
  if (typeof token !== 'string' || !/^[A-Za-z0-9._-]+$/u.test(token)) {
    throw new TypeError('nonce() must return a portable token');
  }

  const prefix = kind === 'pre_restore'
    ? 'pre-restore'
    : 'agent-hub-memory';
  const backupDir = join(
    resolve(backupRoot),
    prefix + '-' + fileStamp(createdAt) + '-' + token,
  );

  await mkdir(resolve(backupRoot), { recursive: true });
  await mkdir(backupDir, { recursive: false });

  const tempDbPath = join(backupDir, '.memory.sqlite3.tmp');
  const finalDbPath = join(backupDir, DATABASE_FILE);
  const tempManifestPath = join(backupDir, '.manifest.json.tmp');
  const manifestPath = join(backupDir, 'manifest.json');

  try {
    const pages = await onlineBackup(sourceDb, tempDbPath, {
      source: 'main',
      target: 'main',
      rate: 100,
    });

    normalizePortableBackupDatabase(tempDbPath);
    const inspection = await inspectStandaloneDatabase(tempDbPath);
    await rename(tempDbPath, finalDbPath);

    const info = await stat(finalDbPath);
    const sha256 = await sha256File(finalDbPath);
    const counts = readCounts(finalDbPath);

    const manifest = {
      type: MANIFEST_TYPE,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt,
      kind,
      database: {
        file: DATABASE_FILE,
        sha256,
        bytes: info.size,
        pages: Number(pages),
        quickCheck: inspection.quickCheck,
        foreignKeyViolations: inspection.foreignKeyViolations,
        journalMode: inspection.journalMode,
      },
      counts,
    };

    await writeFile(
      tempManifestPath,
      JSON.stringify(manifest, null, 2) + '\n',
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );
    await rename(tempManifestPath, manifestPath);

    const validation = await validateMemoryBackup({ backupDir });

    return {
      type: 'agent_hub_memory_backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      backupDir,
      manifest,
      validation,
    };
  } catch (error) {
    await rm(backupDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function createMemoryBackup({
  dbPath,
  backupRoot = defaultMemoryBackupRoot(dbPath),
  kind = 'manual',
  now = () => new Date(),
  nonce = defaultNonce,
  onlineBackup = sqliteBackup,
} = {}) {
  if (typeof dbPath !== 'string' || dbPath.trim().length === 0) {
    throw new TypeError('dbPath must be a non-empty string');
  }
  if (!['manual', 'pre_restore'].includes(kind)) {
    throw new Error('unsupported backup kind: ' + kind);
  }
  if (!existsSync(dbPath)) {
    throw new Error('memory database does not exist');
  }

  const sourceInspection = inspectMemoryDatabase({ dbPath });
  requireValidDatabaseInspection(sourceInspection, 'source database');

  const sourceDb = openDatabase(dbPath, { readOnly: true });
  try {
    return await createBackupFromOpenDatabase({
      sourceDb,
      backupRoot,
      kind,
      now,
      nonce,
      onlineBackup,
    });
  } finally {
    sourceDb.close();
  }
}

function validateManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('backup manifest is invalid');
  }
  if (manifest.type !== MANIFEST_TYPE) {
    throw new Error('backup manifest type is invalid');
  }
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error('unsupported backup format version');
  }
  if (manifest.database?.file !== DATABASE_FILE) {
    throw new Error('backup database filename is invalid');
  }
  if (!/^[0-9a-f]{64}$/u.test(manifest.database?.sha256 ?? '')) {
    throw new Error('backup SHA-256 is invalid');
  }
  if (
    !Number.isInteger(manifest.database?.bytes)
    || manifest.database.bytes <= 0
  ) {
    throw new Error('backup byte size is invalid');
  }
}

export async function validateMemoryBackup({
  backupDir,
} = {}) {
  if (typeof backupDir !== 'string' || backupDir.trim().length === 0) {
    throw new TypeError('backupDir must be a non-empty string');
  }

  const resolvedDir = resolve(backupDir);
  const manifestPath = join(resolvedDir, 'manifest.json');
  const databasePath = join(resolvedDir, DATABASE_FILE);

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error('backup manifest cannot be read: ' + message(error));
  }
  validateManifestShape(manifest);

  const info = await stat(databasePath).catch(() => null);
  if (!info?.isFile()) {
    throw new Error('backup database is missing');
  }
  if (info.size !== manifest.database.bytes) {
    throw new Error('backup database byte size does not match manifest');
  }

  const actualHash = await sha256File(databasePath);
  if (actualHash !== manifest.database.sha256) {
    throw new Error('backup database SHA-256 checksum mismatch');
  }

  const inspection = await inspectStandaloneDatabase(databasePath);
  const counts = readCounts(databasePath);
  if (!countsEqual(counts, manifest.counts)) {
    throw new Error('backup database counts do not match manifest');
  }

  return {
    status: 'valid',
    backupDir: resolvedDir,
    manifest,
    databasePath,
    database: {
      quickCheck: inspection.quickCheck,
      foreignKeyViolations: inspection.foreignKeyViolations,
      journalMode: inspection.journalMode,
      counts,
      sha256: actualHash,
      bytes: info.size,
    },
  };
}

async function createRestoreCandidate({
  validatedBackup,
  candidatePath,
  onlineBackup,
}) {
  await removeDatabaseFamily(candidatePath);
  const sourceDb = openDatabase(
    validatedBackup.databasePath,
    { readOnly: true },
  );
  try {
    await onlineBackup(sourceDb, candidatePath, {
      source: 'main',
      target: 'main',
      rate: 100,
    });
  } finally {
    sourceDb.close();
  }

  normalizePortableBackupDatabase(candidatePath);
  const inspection = await inspectStandaloneDatabase(candidatePath);
  const counts = readCounts(candidatePath);
  if (!countsEqual(counts, validatedBackup.manifest.counts)) {
    throw new Error('restore candidate counts do not match backup manifest');
  }
  return inspection;
}

async function existingDatabaseFamily(dbPath) {
  const paths = [];
  for (const suffix of SIDECAR_SUFFIXES) {
    const path = dbPath + suffix;
    if (existsSync(path)) paths.push(path);
  }
  return paths;
}

async function rollbackStagedFiles({
  staged,
  targetPath,
  renameFile,
  removeFile,
}) {
  await removeDatabaseFamily(targetPath).catch(() => {});
  for (const item of [...staged].reverse()) {
    if (!existsSync(item.stagedPath)) continue;
    await renameFile(item.stagedPath, item.originalPath);
  }
}

export async function restoreMemoryBackup({
  backupDir,
  dbPath,
  backupRoot = defaultMemoryBackupRoot(dbPath),
  now = () => new Date(),
  nonce = defaultNonce,
  onlineBackup = sqliteBackup,
  dependencies = {},
} = {}) {
  if (typeof dbPath !== 'string' || dbPath.trim().length === 0) {
    throw new TypeError('dbPath must be a non-empty string');
  }

  const validatedBackup = await validateMemoryBackup({ backupDir });
  const targetPath = resolve(dbPath);
  await mkdir(dirname(targetPath), { recursive: true });

  const token = nonce();
  if (typeof token !== 'string' || !/^[A-Za-z0-9._-]+$/u.test(token)) {
    throw new TypeError('nonce() must return a portable token');
  }

  const candidatePath = join(
    dirname(targetPath),
    '.' + DATABASE_FILE + '.restore-candidate-' + token + '.tmp',
  );

  const renameFile = dependencies.renameFile || rename;
  const removeFile = dependencies.removeFile || rm;
  const acquireLock = dependencies.acquireRestoreLock
    || acquireMemoryRestoreLock;

  await createRestoreCandidate({
    validatedBackup,
    candidatePath,
    onlineBackup,
  });

  let lock = null;
  let liveDb = null;
  let preRestoreBackup = null;
  const staged = [];
  let installed = false;

  try {
    lock = await acquireLock({
      dbPath: targetPath,
      now,
    });

    if (existsSync(targetPath)) {
      liveDb = openDatabase(targetPath);
      liveDb.exec('BEGIN EXCLUSIVE;');

      try {
        preRestoreBackup = await createBackupFromOpenDatabase({
          sourceDb: liveDb,
          backupRoot,
          kind: 'pre_restore',
          now,
          nonce: () => token,
          onlineBackup,
        });
      } finally {
        try {
          liveDb.exec('ROLLBACK;');
        } catch {
          // Closing the connection still releases the lock.
        }
        liveDb.close();
        liveDb = null;
      }
    }

    const currentPaths = await existingDatabaseFamily(targetPath);
    for (const originalPath of currentPaths) {
      const stagedPath = originalPath
        + '.pre-restore-' + token + '.tmp';
      await renameFile(originalPath, stagedPath);
      staged.push({ originalPath, stagedPath });
    }

    await renameFile(candidatePath, targetPath);
    installed = true;
    enableWal(targetPath);

    const installedInspection = await inspectStandaloneDatabase(targetPath);
    const installedCounts = readCounts(targetPath);
    if (!countsEqual(
      installedCounts,
      validatedBackup.manifest.counts,
    )) {
      throw new Error(
        'restored database counts do not match backup manifest',
      );
    }

    for (const item of staged) {
      await removeFile(item.stagedPath, { force: true });
    }

    const postRestoreValidation = {
      status: 'valid',
      quickCheck: installedInspection.quickCheck,
      foreignKeyViolations: installedInspection.foreignKeyViolations,
      journalMode: installedInspection.journalMode,
      counts: installedCounts,
    };

    return {
      type: 'agent_hub_memory_restore',
      status: 'restored',
      backupDir: validatedBackup.backupDir,
      dbPath: targetPath,
      validation: validatedBackup,
      preRestoreBackupDir: preRestoreBackup?.backupDir ?? null,
      postRestoreValidation,
    };
  } catch (error) {
    if (liveDb !== null) {
      try {
        liveDb.exec('ROLLBACK;');
      } catch {
        // Close below.
      }
      try {
        liveDb.close();
      } catch {
        // Preserve primary restore error.
      }
    }

    if (staged.length > 0 || installed) {
      try {
        await rollbackStagedFiles({
          staged,
          targetPath,
          renameFile,
          removeFile,
        });
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'restore failed and rollback also failed',
        );
      }
    }

    throw error;
  } finally {
    await removeDatabaseFamily(candidatePath).catch(() => {});
    if (lock !== null) {
      await lock.release().catch(() => {});
    }
  }
}
