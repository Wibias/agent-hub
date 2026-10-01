import { existsSync } from 'node:fs';
import {
  open,
  rm,
} from 'node:fs/promises';
import { resolve } from 'node:path';

export function memoryRestoreLockPath(dbPath) {
  if (typeof dbPath !== 'string' || dbPath.trim().length === 0) {
    throw new TypeError('dbPath must be a non-empty string');
  }
  return resolve(dbPath) + '.restore.lock';
}

export function memoryRestoreLocked({
  dbPath,
  exists = existsSync,
} = {}) {
  if (typeof exists !== 'function') {
    throw new TypeError('exists must be a function');
  }
  return exists(memoryRestoreLockPath(dbPath));
}

export async function acquireMemoryRestoreLock({
  dbPath,
  now = () => new Date(),
  openFile = open,
  removeFile = rm,
} = {}) {
  if (typeof openFile !== 'function') {
    throw new TypeError('openFile must be a function');
  }
  if (typeof removeFile !== 'function') {
    throw new TypeError('removeFile must be a function');
  }

  const path = memoryRestoreLockPath(dbPath);
  const handle = await openFile(path, 'wx');

  try {
    const createdAt = now().toISOString();
    await handle.writeFile(
      JSON.stringify({
        type: 'agent_hub_memory_restore_lock',
        version: 1,
        pid: process.pid,
        createdAt,
      }) + '\n',
      'utf8',
    );
    if (typeof handle.sync === 'function') await handle.sync();

    let released = false;
    return {
      path,
      createdAt,
      async release() {
        if (released) return;
        released = true;
        try {
          await handle.close();
        } finally {
          await removeFile(path, { force: true });
        }
      },
    };
  } catch (error) {
    try {
      await handle.close();
    } finally {
      await removeFile(path, { force: true }).catch(() => {});
    }
    throw error;
  }
}
