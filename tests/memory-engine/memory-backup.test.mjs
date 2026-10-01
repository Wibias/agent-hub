import test from 'node:test';
import assert from 'node:assert/strict';
import {
  access,
  mkdtemp,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  BACKUP_FORMAT_VERSION,
  createMemoryBackup,
  restoreMemoryBackup,
  validateMemoryBackup,
} from '../../memory-engine/memory-backup.mjs';
import {
  runMemoryBackupCli,
} from '../../scripts/backup-memory.mjs';
import {
  runMemoryRestoreCli,
} from '../../scripts/restore-memory.mjs';

function seedMemory(dbPath, {
  claimId,
  value,
  branch = 'main',
} = {}) {
  const memory = new MemoryEngine({ dbPath });
  memory.registerProject({
    projectId: 'github.com/Wibias/agent-hub',
    canonicalRemote: 'github.com/Wibias/agent-hub',
    repoIdentity: 'github.com/Wibias/agent-hub',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  memory.ingest({
    evidence: {
      id: 'e-' + claimId,
      projectId: 'github.com/Wibias/agent-hub',
      sourceKind: 'session',
      sourceRef: 'user',
      capturedAt: '2026-10-01T00:00:00.000Z',
      branch,
      content: 'memory: ' + value,
      authorityClass: 'user_direct',
    },
    claim: {
      id: claimId,
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value,
      branchScope: branch,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  });
  return memory;
}

test('backup uses SQLite online backup and includes committed WAL state without checkpointing source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-backup-live-'));
  const dbPath = join(root, 'memory.sqlite3');
  const backupRoot = join(root, 'backups');

  const memory = seedMemory(dbPath, {
    claimId: 'c-live',
    value: 'live WAL claim',
  });

  const walBefore = await stat(dbPath + '-wal');
  assert.ok(walBefore.size > 0);

  const result = await createMemoryBackup({
    dbPath,
    backupRoot,
    now: () => new Date('2026-10-01T12:34:56.000Z'),
    nonce: () => 'fixture',
  });

  assert.equal(result.type, 'agent_hub_memory_backup');
  assert.equal(result.formatVersion, BACKUP_FORMAT_VERSION);
  assert.equal(result.validation.status, 'valid');
  assert.equal(result.manifest.counts.projects, 1);
  assert.equal(result.manifest.counts.claims, 1);
  assert.equal(result.manifest.counts.evidence, 1);
  assert.match(result.manifest.database.sha256, /^[0-9a-f]{64}$/);
  assert.ok(result.manifest.database.bytes > 0);

  const backupDb = new MemoryEngine({
    dbPath: join(result.backupDir, 'memory.sqlite3'),
  });
  assert.equal(backupDb.getClaim('c-live')?.value, 'live WAL claim');
  backupDb.close();

  const walAfter = await stat(dbPath + '-wal');
  assert.equal(walAfter.size, walBefore.size);

  memory.close();
});

test('backup manifest contains no absolute source path and validates independently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-backup-manifest-'));
  const dbPath = join(root, 'memory.sqlite3');
  const memory = seedMemory(dbPath, {
    claimId: 'c-manifest',
    value: 'portable backup',
  });
  memory.close();

  const result = await createMemoryBackup({
    dbPath,
    backupRoot: join(root, 'backups'),
    now: () => new Date('2026-10-01T12:00:00.000Z'),
    nonce: () => 'manifest',
  });

  const raw = await readFile(join(result.backupDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);

  assert.equal(manifest.type, 'agent_hub_memory_backup_manifest');
  assert.equal(manifest.formatVersion, BACKUP_FORMAT_VERSION);
  assert.equal(manifest.database.file, 'memory.sqlite3');
  assert.equal(raw.includes(root), false);

  const validated = await validateMemoryBackup({
    backupDir: result.backupDir,
  });
  assert.equal(validated.status, 'valid');
  assert.equal(validated.manifest.database.sha256, manifest.database.sha256);
});

test('validation rejects tampered database before restore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-backup-tamper-'));
  const dbPath = join(root, 'source.sqlite3');
  const memory = seedMemory(dbPath, {
    claimId: 'c-tamper',
    value: 'untampered',
  });
  memory.close();

  const backup = await createMemoryBackup({
    dbPath,
    backupRoot: join(root, 'backups'),
    now: () => new Date('2026-10-01T12:00:00.000Z'),
    nonce: () => 'tamper',
  });

  await writeFile(
    join(backup.backupDir, 'memory.sqlite3'),
    'tampered bytes',
  );

  await assert.rejects(
    validateMemoryBackup({ backupDir: backup.backupDir }),
    /hash|sha-256|checksum/i,
  );
});

test('restore validates first, creates a pre-restore backup, and replaces target atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-restore-'));
  const sourcePath = join(root, 'source.sqlite3');
  const targetPath = join(root, 'target.sqlite3');
  const backupRoot = join(root, 'backups');

  const source = seedMemory(sourcePath, {
    claimId: 'c-restored',
    value: 'restored value',
  });
  source.close();

  const sourceBackup = await createMemoryBackup({
    dbPath: sourcePath,
    backupRoot,
    now: () => new Date('2026-10-01T10:00:00.000Z'),
    nonce: () => 'source',
  });

  const target = seedMemory(targetPath, {
    claimId: 'c-current',
    value: 'current value',
  });
  target.close();

  const restored = await restoreMemoryBackup({
    backupDir: sourceBackup.backupDir,
    dbPath: targetPath,
    backupRoot,
    now: () => new Date('2026-10-01T11:00:00.000Z'),
    nonce: () => 'restore',
  });

  assert.equal(restored.status, 'restored');
  assert.equal(restored.validation.status, 'valid');
  assert.equal(restored.postRestoreValidation.status, 'valid');
  assert.ok(restored.preRestoreBackupDir);

  const current = new MemoryEngine({ dbPath: targetPath });
  assert.equal(current.getClaim('c-restored')?.value, 'restored value');
  assert.equal(current.getClaim('c-current'), null);
  current.close();

  const safety = new MemoryEngine({
    dbPath: join(restored.preRestoreBackupDir, 'memory.sqlite3'),
  });
  assert.equal(safety.getClaim('c-current')?.value, 'current value');
  safety.close();

  await access(join(restored.preRestoreBackupDir, 'manifest.json'));
});

test('restore leaves target untouched when backup validation fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-restore-invalid-'));
  const sourcePath = join(root, 'source.sqlite3');
  const targetPath = join(root, 'target.sqlite3');
  const backupRoot = join(root, 'backups');

  const source = seedMemory(sourcePath, {
    claimId: 'c-source',
    value: 'source',
  });
  source.close();

  const backup = await createMemoryBackup({
    dbPath: sourcePath,
    backupRoot,
    now: () => new Date('2026-10-01T10:00:00.000Z'),
    nonce: () => 'source',
  });

  const target = seedMemory(targetPath, {
    claimId: 'c-target',
    value: 'target',
  });
  target.close();

  const before = await readFile(targetPath);
  await writeFile(join(backup.backupDir, 'memory.sqlite3'), 'broken');

  await assert.rejects(
    restoreMemoryBackup({
      backupDir: backup.backupDir,
      dbPath: targetPath,
      backupRoot,
      now: () => new Date('2026-10-01T11:00:00.000Z'),
      nonce: () => 'restore',
    }),
    /hash|sha-256|checksum/i,
  );

  const after = await readFile(targetPath);
  assert.deepEqual(after, before);

  const stillCurrent = new MemoryEngine({ dbPath: targetPath });
  assert.equal(stillCurrent.getClaim('c-target')?.value, 'target');
  stillCurrent.close();
});

test('restore rolls staged target files back when atomic swap cannot complete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-memory-restore-rollback-'));
  const sourcePath = join(root, 'source.sqlite3');
  const targetPath = join(root, 'target.sqlite3');
  const backupRoot = join(root, 'backups');

  const source = seedMemory(sourcePath, {
    claimId: 'c-source-rollback',
    value: 'source rollback',
  });
  source.close();

  const backup = await createMemoryBackup({
    dbPath: sourcePath,
    backupRoot,
    now: () => new Date('2026-10-01T10:00:00.000Z'),
    nonce: () => 'source',
  });

  const target = seedMemory(targetPath, {
    claimId: 'c-target-rollback',
    value: 'target rollback',
  });
  target.close();

  let candidateRenameAttempted = false;

  await assert.rejects(
    restoreMemoryBackup({
      backupDir: backup.backupDir,
      dbPath: targetPath,
      backupRoot,
      now: () => new Date('2026-10-01T11:00:00.000Z'),
      nonce: () => 'restore',
      dependencies: {
        async renameFile(from, to) {
          if (
            from.includes('.restore-candidate-')
            && to === targetPath
          ) {
            candidateRenameAttempted = true;
            throw new Error('simulated locked target');
          }
          await rename(from, to);
        },
      },
    }),
    /simulated locked target/,
  );

  assert.equal(candidateRenameAttempted, true);

  const current = new MemoryEngine({ dbPath: targetPath });
  assert.equal(
    current.getClaim('c-target-rollback')?.value,
    'target rollback',
  );
  assert.equal(current.getClaim('c-source-rollback'), null);
  current.close();
});

test('backup CLI emits one JSON object', async () => {
  const lines = [];
  const output = await runMemoryBackupCli({
    argv: ['--db-path', 'C:/fixture/memory.sqlite3'],
    log(value) {
      lines.push(value);
    },
    createBackup: async (options) => ({
      type: 'agent_hub_memory_backup',
      backupDir: 'C:/fixture/backups/example',
      options,
    }),
  });

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), output);
  assert.equal(output.options.dbPath.endsWith('memory.sqlite3'), true);
});

test('restore CLI is validation-only by default and requires --apply to mutate', async () => {
  const calls = [];
  const lines = [];

  const dry = await runMemoryRestoreCli({
    argv: ['C:/fixture/backup'],
    log(value) {
      lines.push(value);
    },
    validateBackup: async ({ backupDir }) => {
      calls.push(['validate', backupDir]);
      return {
        status: 'valid',
        backupDir,
      };
    },
    restoreBackup: async () => {
      calls.push(['restore']);
      throw new Error('restore must not run in dry-run');
    },
  });

  assert.equal(dry.mode, 'dry-run');
  assert.equal(dry.validation.status, 'valid');
  assert.equal(calls.some(([name]) => name === 'restore'), false);

  const applied = await runMemoryRestoreCli({
    argv: ['C:/fixture/backup', '--apply'],
    log() {},
    validateBackup: async () => {
      throw new Error('apply delegates validation to restore');
    },
    restoreBackup: async ({ backupDir }) => {
      calls.push(['restore', backupDir]);
      return {
        status: 'restored',
      };
    },
  });

  assert.equal(applied.mode, 'apply');
  assert.equal(applied.result.status, 'restored');
  assert.equal(calls.some(([name]) => name === 'restore'), true);
});
