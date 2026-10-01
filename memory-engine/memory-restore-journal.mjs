import { existsSync } from 'node:fs';
import {
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';

import {
  memoryRestoreLockPath,
} from './memory-maintenance-lock.mjs';

export { memoryRestoreLockPath };

export const RESTORE_JOURNAL_VERSION = 1;

const JOURNAL_TYPE = 'agent_hub_memory_restore_journal';
const LOCK_TYPE = 'agent_hub_memory_restore_lock';

export function memoryRestoreJournalPath(dbPath) {
  if (typeof dbPath !== 'string' || dbPath.trim().length === 0) {
    throw new TypeError('dbPath must be a non-empty string');
  }
  return dbPath + '.restore-journal.json';
}

function defaultProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    // EPERM and unknown platform-specific probe failures fail closed as alive.
    return true;
  }
}

function parseLock(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  if (
    value?.type !== LOCK_TYPE
    || value?.version !== 1
    || !Number.isInteger(value?.pid)
    || value.pid <= 0
    || typeof value?.createdAt !== 'string'
  ) {
    return null;
  }

  return value;
}

function validateJournal(value) {
  const phases = new Set([
    'preparing',
    'candidate_ready',
    'snapshot_ready',
    'staging',
    'installing',
    'installed',
    'verified',
  ]);

  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.type !== JOURNAL_TYPE
    || value.version !== RESTORE_JOURNAL_VERSION
    || typeof value.operationId !== 'string'
    || value.operationId.length === 0
    || !phases.has(value.phase)
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string'
    || typeof value.backupDir !== 'string'
    || typeof value.candidatePath !== 'string'
    || !Array.isArray(value.staged)
    || !value.expectedCounts
    || typeof value.expectedCounts !== 'object'
  ) {
    throw new Error('restore journal is invalid');
  }

  for (const item of value.staged) {
    if (
      !item
      || typeof item.originalPath !== 'string'
      || typeof item.stagedPath !== 'string'
    ) {
      throw new Error('restore journal staged mapping is invalid');
    }
  }

  return value;
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeMemoryRestoreJournal({
  dbPath,
  journal,
} = {}) {
  const path = memoryRestoreJournalPath(dbPath);
  const normalized = validateJournal({
    type: JOURNAL_TYPE,
    version: RESTORE_JOURNAL_VERSION,
    ...journal,
  });

  const tempPath = path + '.tmp-' + process.pid;
  await writeFile(
    tempPath,
    JSON.stringify(normalized, null, 2) + '\n',
    {
      encoding: 'utf8',
      flag: 'w',
    },
  );
  await rename(tempPath, path);

  return normalized;
}

export async function clearMemoryRestoreJournal({
  dbPath,
  removeFile = rm,
} = {}) {
  await removeFile(memoryRestoreJournalPath(dbPath), { force: true });
}

export async function inspectMemoryRestoreTransaction({
  dbPath,
  exists = existsSync,
  processAlive = defaultProcessAlive,
} = {}) {
  if (typeof dbPath !== 'string' || dbPath.trim().length === 0) {
    throw new TypeError('dbPath must be a non-empty string');
  }

  const lockPath = memoryRestoreLockPath(dbPath);
  const journalPath = memoryRestoreJournalPath(dbPath);
  const hasLock = exists(lockPath);
  const hasJournal = exists(journalPath);

  if (!hasLock && !hasJournal) {
    return {
      status: 'none',
      recoverable: false,
      lock: null,
      journal: null,
    };
  }

  let lock = null;
  let journal = null;

  if (hasLock) {
    const raw = await readOptional(lockPath);
    lock = raw === null ? null : parseLock(raw);
    if (lock === null) {
      return {
        status: 'invalid',
        recoverable: false,
        lock: null,
        journal: null,
        reason: 'invalid_restore_lock',
      };
    }
  }

  if (hasJournal) {
    try {
      const raw = await readOptional(journalPath);
      journal = validateJournal(JSON.parse(raw));
    } catch (error) {
      return {
        status: 'invalid',
        recoverable: false,
        lock,
        journal: null,
        reason: 'invalid_restore_journal',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (lock === null) {
    return {
      status: 'stale',
      recoverable: journal !== null,
      lock: null,
      journal,
      reason: 'orphan_restore_journal',
    };
  }

  const alive = processAlive(lock.pid);
  if (alive) {
    return {
      status: 'active',
      recoverable: false,
      lock,
      journal,
    };
  }

  return {
    status: 'stale',
    recoverable: true,
    lock,
    journal,
    reason: journal === null
      ? 'stale_restore_lock'
      : 'stale_restore_transaction',
  };
}
