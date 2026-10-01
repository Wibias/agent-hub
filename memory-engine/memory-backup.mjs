import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
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
import {
  clearMemoryRestoreJournal,
  inspectMemoryRestoreTransaction,
  memoryRestoreJournalPath,
  memoryRestoreLockPath,
  writeMemoryRestoreJournal,
} from './memory-restore-journal.mjs';

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

  const actualHash = await sha256File(databasePath);
  if (actualHash !== manifest.database.sha256) {
    throw new Error('backup database SHA-256 checksum mismatch');
  }
  if (info.size !== manifest.database.bytes) {
    throw new Error('backup database byte size does not match manifest');
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
  const mappedOriginals = new Set(staged.map((item) => item.originalPath));

  for (const suffix of SIDECAR_SUFFIXES) {
    const originalPath = targetPath + suffix;
    if (!mappedOriginals.has(originalPath)) {
      await removeFile(originalPath, { force: true }).catch(() => {});
    }
  }

  for (const item of [...staged].reverse()) {
    if (!existsSync(item.stagedPath)) continue;
    await removeFile(item.originalPath, { force: true }).catch(() => {});
    await renameFile(item.stagedPath, item.originalPath);
  }
}

async function removeRestoreMetadata({
  dbPath,
  removeFile = rm,
}) {
  await clearMemoryRestoreJournal({
    dbPath,
    removeFile,
  }).catch(() => {});
  await removeFile(memoryRestoreLockPath(dbPath), { force: true }).catch(() => {});
}

async function legacyRestoreArtifacts(dbPath) {
  const directory = dirname(resolve(dbPath));
  const targetName = basename(resolve(dbPath));
  let entries = [];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  return entries
    .filter((name) => (
      name.startsWith(targetName + '.pre-restore-')
      || name.startsWith('.' + DATABASE_FILE + '.restore-candidate-')
    ))
    .map((name) => join(directory, name));
}

function installedMatchesExpected({
  dbPath,
  expectedCounts,
}) {
  try {
    const inspection = inspectMemoryDatabase({ dbPath });
    requireValidDatabaseInspection(inspection, 'restored database');
    const counts = readCounts(dbPath);
    return {
      valid: countsEqual(counts, expectedCounts),
      inspection,
      counts,
    };
  } catch (error) {
    return {
      valid: false,
      inspection: null,
      counts: null,
      error: message(error),
    };
  }
}

export async function recoverMemoryRestore({
  dbPath,
  dependencies = {},
} = {}) {
  if (typeof dbPath !== 'string' || dbPath.trim().length === 0) {
    throw new TypeError('dbPath must be a non-empty string');
  }

  const targetPath = resolve(dbPath);
  const inspectTransaction = dependencies.inspectRestoreTransaction
    || inspectMemoryRestoreTransaction;
  const renameFile = dependencies.renameFile || rename;
  const removeFile = dependencies.removeFile || rm;

  const transaction = await inspectTransaction({
    dbPath: targetPath,
    ...(dependencies.processAlive === undefined
      ? {}
      : { processAlive: dependencies.processAlive }),
  });

  if (transaction.status === 'none') {
    return {
      type: 'agent_hub_memory_restore_recovery',
      status: 'not_needed',
      action: 'none',
      dbPath: targetPath,
    };
  }

  if (transaction.status === 'active') {
    throw new Error('restore recovery refused because the restore owner process is still active');
  }

  if (transaction.status === 'invalid') {
    throw new Error(
      'restore recovery refused because restore metadata is invalid: '
      + (transaction.reason || 'unknown'),
    );
  }

  const journal = transaction.journal;

  if (journal === null) {
    const artifacts = await legacyRestoreArtifacts(targetPath);
    if (artifacts.length > 0) {
      throw new Error(
        'stale restore lock has unjournaled restore artifacts; manual inspection is required',
      );
    }

    const inspection = inspectMemoryDatabase({ dbPath: targetPath });
    requireValidDatabaseInspection(inspection, 'current target database');

    await removeRestoreMetadata({
      dbPath: targetPath,
      removeFile,
    });

    return {
      type: 'agent_hub_memory_restore_recovery',
      status: 'recovered',
      action: 'stale_lock_cleared',
      dbPath: targetPath,
    };
  }

  const preSwapPhases = new Set([
    'preparing',
    'candidate_ready',
    'snapshot_ready',
  ]);
  const rollbackPhases = new Set([
    'staging',
    'installing',
  ]);
  const finishPhases = new Set([
    'installed',
    'verified',
  ]);

  if (preSwapPhases.has(journal.phase)) {
    await removeDatabaseFamily(journal.candidatePath).catch(() => {});
    await removeRestoreMetadata({
      dbPath: targetPath,
      removeFile,
    });

    return {
      type: 'agent_hub_memory_restore_recovery',
      status: 'recovered',
      action: 'rolled_back_no_swap',
      dbPath: targetPath,
      operationId: journal.operationId,
      preRestoreBackupDir: journal.preRestoreBackupDir ?? null,
    };
  }

  if (rollbackPhases.has(journal.phase)) {
    await rollbackStagedFiles({
      staged: journal.staged,
      targetPath,
      renameFile,
      removeFile,
    });
    await removeDatabaseFamily(journal.candidatePath).catch(() => {});

    if (existsSync(targetPath)) {
      const inspection = inspectMemoryDatabase({ dbPath: targetPath });
      requireValidDatabaseInspection(inspection, 'rolled-back target database');
    }

    await removeRestoreMetadata({
      dbPath: targetPath,
      removeFile,
    });

    return {
      type: 'agent_hub_memory_restore_recovery',
      status: 'recovered',
      action: 'rolled_back',
      dbPath: targetPath,
      operationId: journal.operationId,
      preRestoreBackupDir: journal.preRestoreBackupDir ?? null,
    };
  }

  if (finishPhases.has(journal.phase)) {
    const installed = installedMatchesExpected({
      dbPath: targetPath,
      expectedCounts: journal.expectedCounts,
    });

    if (!installed.valid) {
      await rollbackStagedFiles({
        staged: journal.staged,
        targetPath,
        renameFile,
        removeFile,
      });
      await removeDatabaseFamily(journal.candidatePath).catch(() => {});

      if (existsSync(targetPath)) {
        const inspection = inspectMemoryDatabase({ dbPath: targetPath });
        requireValidDatabaseInspection(inspection, 'rolled-back target database');
      }

      await removeRestoreMetadata({
        dbPath: targetPath,
        removeFile,
      });

      return {
        type: 'agent_hub_memory_restore_recovery',
        status: 'recovered',
        action: 'rolled_back',
        dbPath: targetPath,
        operationId: journal.operationId,
        preRestoreBackupDir: journal.preRestoreBackupDir ?? null,
      };
    }

    enableWal(targetPath);
    const afterWal = installedMatchesExpected({
      dbPath: targetPath,
      expectedCounts: journal.expectedCounts,
    });
    if (!afterWal.valid) {
      throw new Error('installed restore became invalid while re-enabling WAL');
    }

    for (const item of journal.staged) {
      await removeFile(item.stagedPath, { force: true });
    }
    await removeDatabaseFamily(journal.candidatePath).catch(() => {});
    await removeRestoreMetadata({
      dbPath: targetPath,
      removeFile,
    });

    return {
      type: 'agent_hub_memory_restore_recovery',
      status: 'recovered',
      action: 'finished_install',
      dbPath: targetPath,
      operationId: journal.operationId,
      preRestoreBackupDir: journal.preRestoreBackupDir ?? null,
      postRestoreValidation: {
        status: 'valid',
        quickCheck: afterWal.inspection.quickCheck,
        foreignKeyViolations: afterWal.inspection.foreignKeyViolations,
        journalMode: afterWal.inspection.journalMode,
        counts: afterWal.counts,
      },
    };
  }

  throw new Error('unsupported restore recovery phase: ' + journal.phase);
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
  const writeRestoreJournal = dependencies.writeRestoreJournal
    || writeMemoryRestoreJournal;
  const clearRestoreJournal = dependencies.clearRestoreJournal
    || clearMemoryRestoreJournal;

  const createdAt = isoNow(now);
  let journal = {
    operationId: token,
    phase: 'preparing',
    createdAt,
    updatedAt: createdAt,
    backupDir: validatedBackup.backupDir,
    candidatePath,
    preRestoreBackupDir: null,
    staged: [],
    expectedCounts: validatedBackup.manifest.counts,
  };

  const persistPhase = async (phase, patch = {}) => {
    journal = {
      ...journal,
      ...patch,
      phase,
      updatedAt: isoNow(now),
    };
    await writeRestoreJournal({
      dbPath: targetPath,
      journal,
    });
  };

  let lock = null;
  let liveDb = null;
  let preRestoreBackup = null;
  let restoreSucceeded = false;
  let rollbackSucceeded = false;

  try {
    lock = await acquireLock({
      dbPath: targetPath,
      now,
    });
    await persistPhase('preparing');

    await createRestoreCandidate({
      validatedBackup,
      candidatePath,
      onlineBackup,
    });
    await persistPhase('candidate_ready');

    if (existsSync(targetPath)) {
      liveDb = openDatabase(targetPath);

      try {
        preRestoreBackup = await createBackupFromOpenDatabase({
          sourceDb: liveDb,
          backupRoot,
          kind: 'pre_restore',
          now,
          nonce: () => token,
          onlineBackup,
        });

        await persistPhase('snapshot_ready', {
          preRestoreBackupDir: preRestoreBackup.backupDir,
        });

        // The maintenance lock prevents new Agent Hub hooks from entering.
        // This exclusive transaction is a quiescence barrier for any writer
        // that was already in flight before the lock was created.
        liveDb.exec('BEGIN EXCLUSIVE;');
        liveDb.exec('ROLLBACK;');
      } finally {
        liveDb.close();
        liveDb = null;
      }
    } else {
      await persistPhase('snapshot_ready');
    }

    const currentPaths = await existingDatabaseFamily(targetPath);
    const staged = currentPaths.map((originalPath) => ({
      originalPath,
      stagedPath: originalPath + '.pre-restore-' + token + '.tmp',
    }));

    await persistPhase('staging', { staged });

    for (const item of staged) {
      await renameFile(item.originalPath, item.stagedPath);
    }

    await persistPhase('installing');
    await renameFile(candidatePath, targetPath);
    await persistPhase('installed');

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

    await persistPhase('verified');

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

    restoreSucceeded = true;
    await clearRestoreJournal({
      dbPath: targetPath,
      removeFile,
    });

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

    if (journal.staged.length > 0) {
      try {
        await rollbackStagedFiles({
          staged: journal.staged,
          targetPath,
          renameFile,
          removeFile,
        });
        rollbackSucceeded = true;
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'restore failed and rollback also failed',
        );
      }
    } else {
      rollbackSucceeded = true;
    }

    await removeDatabaseFamily(candidatePath).catch(() => {});

    if (rollbackSucceeded) {
      await clearRestoreJournal({
        dbPath: targetPath,
        removeFile,
      }).catch(() => {});
    }

    throw error;
  } finally {
    if (restoreSucceeded) {
      await removeDatabaseFamily(candidatePath).catch(() => {});
    }
    if (lock !== null) {
      await lock.release().catch(() => {});
    }
  }
}
