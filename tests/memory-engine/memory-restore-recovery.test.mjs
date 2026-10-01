import test from 'node:test';
import assert from 'node:assert/strict';
import {
  access,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import {
  createMemoryBackup,
  recoverMemoryRestore,
  restoreMemoryBackup,
} from '../../memory-engine/memory-backup.mjs';
import {
  RESTORE_JOURNAL_VERSION,
  inspectMemoryRestoreTransaction,
  memoryRestoreJournalPath,
  memoryRestoreLockPath,
  writeMemoryRestoreJournal,
} from '../../memory-engine/memory-restore-journal.mjs';
import {
  runMemoryDoctor,
} from '../../memory-engine/memory-doctor.mjs';
import {
  runMemoryRestoreCli,
} from '../../scripts/restore-memory.mjs';

function seedMemory(dbPath, {
  projectId = 'project',
  claimId,
  value,
} = {}) {
  const memory = new MemoryEngine({ dbPath });
  memory.registerProject({
    projectId,
    repoIdentity: projectId,
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  memory.ingest({
    evidence: {
      id: 'e-' + claimId,
      projectId,
      sourceKind: 'session',
      sourceRef: 'fixture',
      capturedAt: '2026-10-01T00:00:00.000Z',
      branch: 'main',
      content: 'memory: ' + value,
      authorityClass: 'user_direct',
    },
    claim: {
      id: claimId,
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value,
      branchScope: 'main',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  });
  memory.close();
}

function claimValue(dbPath, claimId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare('SELECT value_text FROM claims WHERE id = ?')
      .get(claimId)?.value_text ?? null;
  } finally {
    db.close();
  }
}

async function writeLock(dbPath, {
  pid = 424242,
  createdAt = '2026-10-01T00:00:00.000Z',
} = {}) {
  await writeFile(
    memoryRestoreLockPath(dbPath),
    JSON.stringify({
      type: 'agent_hub_memory_restore_lock',
      version: 1,
      pid,
      createdAt,
    }) + '\n',
  );
}

test('restore transaction inspector distinguishes none, active, and stale lock state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-restore-inspect-'));
  const dbPath = join(root, 'memory.sqlite3');

  const none = await inspectMemoryRestoreTransaction({
    dbPath,
    processAlive() {
      throw new Error('must not probe without a lock');
    },
  });
  assert.equal(none.status, 'none');

  await writeLock(dbPath, { pid: 111 });

  const active = await inspectMemoryRestoreTransaction({
    dbPath,
    processAlive(pid) {
      assert.equal(pid, 111);
      return true;
    },
  });
  assert.equal(active.status, 'active');
  assert.equal(active.lock.pid, 111);

  const stale = await inspectMemoryRestoreTransaction({
    dbPath,
    processAlive() {
      return false;
    },
  });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.recoverable, true);
  assert.equal(stale.journal, null);
});

test('journal writes atomically and preserves deterministic recovery metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-restore-journal-'));
  const dbPath = join(root, 'memory.sqlite3');

  const journal = await writeMemoryRestoreJournal({
    dbPath,
    journal: {
      operationId: 'op-1',
      phase: 'staging',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:01.000Z',
      backupDir: join(root, 'backup'),
      candidatePath: join(root, '.candidate.tmp'),
      preRestoreBackupDir: join(root, 'pre'),
      staged: [
        {
          originalPath: dbPath,
          stagedPath: dbPath + '.pre-restore-op-1.tmp',
        },
      ],
      expectedCounts: {
        projects: 1,
        evidence: 1,
        claims: 1,
        embeddings: 0,
        conflicts: 0,
        approvals: 0,
      },
    },
  });

  assert.equal(journal.version, RESTORE_JOURNAL_VERSION);
  const raw = JSON.parse(
    await readFile(memoryRestoreJournalPath(dbPath), 'utf8'),
  );
  assert.equal(raw.phase, 'staging');
  assert.equal(raw.operationId, 'op-1');
  assert.equal(raw.staged.length, 1);
});

test('stale lock without a journal is cleared only when target database is healthy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-restore-stale-lock-'));
  const dbPath = join(root, 'memory.sqlite3');
  seedMemory(dbPath, {
    claimId: 'c-current',
    value: 'current',
  });
  await writeLock(dbPath);

  const recovered = await recoverMemoryRestore({
    dbPath,
    dependencies: {
      processAlive() {
        return false;
      },
    },
  });

  assert.equal(recovered.status, 'recovered');
  assert.equal(recovered.action, 'stale_lock_cleared');
  assert.equal(claimValue(dbPath, 'c-current'), 'current');

  await assert.rejects(
    access(memoryRestoreLockPath(dbPath)),
  );
});

test('stale staging phase rolls staged database family back to prior target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-restore-staging-'));
  const dbPath = join(root, 'memory.sqlite3');
  const candidatePath = join(root, '.memory.sqlite3.restore-candidate-op.tmp');
  const stagedPath = dbPath + '.pre-restore-op.tmp';

  seedMemory(dbPath, {
    claimId: 'c-old',
    value: 'old target',
  });
  seedMemory(candidatePath, {
    claimId: 'c-new',
    value: 'new candidate',
  });

  await rename(dbPath, stagedPath);
  await writeLock(dbPath);
  await writeMemoryRestoreJournal({
    dbPath,
    journal: {
      operationId: 'op',
      phase: 'staging',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:01.000Z',
      backupDir: join(root, 'source-backup'),
      candidatePath,
      preRestoreBackupDir: join(root, 'pre-backup'),
      staged: [{ originalPath: dbPath, stagedPath }],
      expectedCounts: {
        projects: 1,
        evidence: 1,
        claims: 1,
        embeddings: 0,
        conflicts: 0,
        approvals: 0,
      },
    },
  });

  const recovered = await recoverMemoryRestore({
    dbPath,
    dependencies: {
      processAlive() {
        return false;
      },
    },
  });

  assert.equal(recovered.action, 'rolled_back');
  assert.equal(claimValue(dbPath, 'c-old'), 'old target');
  assert.equal(claimValue(dbPath, 'c-new'), null);
  await assert.rejects(access(stagedPath));
  await assert.rejects(access(candidatePath));
  await assert.rejects(access(memoryRestoreLockPath(dbPath)));
  await assert.rejects(access(memoryRestoreJournalPath(dbPath)));
});

test('stale installed phase finishes a valid installed database and removes old staging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-restore-installed-'));
  const dbPath = join(root, 'memory.sqlite3');
  const stagedPath = dbPath + '.pre-restore-op.tmp';

  seedMemory(dbPath, {
    claimId: 'c-new',
    value: 'installed',
  });
  seedMemory(stagedPath, {
    claimId: 'c-old',
    value: 'previous',
  });

  await writeLock(dbPath);
  await writeMemoryRestoreJournal({
    dbPath,
    journal: {
      operationId: 'op',
      phase: 'installed',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:01.000Z',
      backupDir: join(root, 'source-backup'),
      candidatePath: join(root, '.candidate.tmp'),
      preRestoreBackupDir: join(root, 'pre-backup'),
      staged: [{ originalPath: dbPath, stagedPath }],
      expectedCounts: {
        projects: 1,
        evidence: 1,
        claims: 1,
        embeddings: 0,
        conflicts: 0,
        approvals: 0,
      },
    },
  });

  const recovered = await recoverMemoryRestore({
    dbPath,
    dependencies: {
      processAlive() {
        return false;
      },
    },
  });

  assert.equal(recovered.action, 'finished_install');
  assert.equal(claimValue(dbPath, 'c-new'), 'installed');
  assert.equal(claimValue(dbPath, 'c-old'), null);
  await assert.rejects(access(stagedPath));
  await assert.rejects(access(memoryRestoreLockPath(dbPath)));
  await assert.rejects(access(memoryRestoreJournalPath(dbPath)));
});

test('active restore refuses recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-restore-active-'));
  const dbPath = join(root, 'memory.sqlite3');
  seedMemory(dbPath, {
    claimId: 'c-active',
    value: 'active',
  });
  await writeLock(dbPath, { pid: 123 });

  await assert.rejects(
    recoverMemoryRestore({
      dbPath,
      dependencies: {
        processAlive() {
          return true;
        },
      },
    }),
    /active/i,
  );

  assert.equal(claimValue(dbPath, 'c-active'), 'active');
  await access(memoryRestoreLockPath(dbPath));
});

test('normal restore journals risky phases and removes lock+journal after success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hub-restore-phases-'));
  const sourcePath = join(root, 'source.sqlite3');
  const targetPath = join(root, 'target.sqlite3');
  const backupRoot = join(root, 'backups');

  seedMemory(sourcePath, {
    claimId: 'c-source',
    value: 'source',
  });
  seedMemory(targetPath, {
    claimId: 'c-target',
    value: 'target',
  });

  const backup = await createMemoryBackup({
    dbPath: sourcePath,
    backupRoot,
    now: () => new Date('2026-10-01T10:00:00.000Z'),
    nonce: () => 'source',
  });

  const phases = [];
  await restoreMemoryBackup({
    backupDir: backup.backupDir,
    dbPath: targetPath,
    backupRoot,
    now: () => new Date('2026-10-01T11:00:00.000Z'),
    nonce: () => 'restore',
    dependencies: {
      async writeRestoreJournal(options) {
        phases.push(options.journal.phase);
        return writeMemoryRestoreJournal(options);
      },
    },
  });

  assert.deepEqual(phases, [
    'preparing',
    'candidate_ready',
    'snapshot_ready',
    'staging',
    'installing',
    'installed',
    'verified',
  ]);
  await assert.rejects(access(memoryRestoreLockPath(targetPath)));
  await assert.rejects(access(memoryRestoreJournalPath(targetPath)));
});

test('memory doctor reports stale restore transaction as broken and active maintenance as degraded', async () => {
  const commonDependencies = {
    resolveScope() {
      return { projectId: 'p' };
    },
    resolveGitContext() {
      return {
        repoPath: 'C:/repo',
        branch: 'main',
        revisionSha: 'a'.repeat(40),
      };
    },
    inspectDatabase() {
      return {
        status: 'ok',
        claims: 0,
        lexicalCoverageComplete: true,
        semanticCoverageComplete: true,
      };
    },
    inspectCache: async () => ({ status: 'ok' }),
    inspectWorker: async () => ({ status: 'ok' }),
    inspectCodex: async () => ({
      status: 'ok',
      hook: { configured: true },
    }),
    inspectNativeIsolation: async () => ({ status: 'isolated' }),
  };

  const stale = await runMemoryDoctor({
    dbPath: 'C:/fixture/memory.sqlite3',
    dependencies: {
      ...commonDependencies,
      inspectRestoreTransaction: async () => ({
        status: 'stale',
        recoverable: true,
      }),
    },
  });
  assert.equal(stale.status, 'broken');
  assert.equal(stale.restoreRecovery.status, 'broken');
  assert.equal(stale.restoreRecovery.reason, 'stale_restore_transaction');

  const active = await runMemoryDoctor({
    dbPath: 'C:/fixture/memory.sqlite3',
    dependencies: {
      ...commonDependencies,
      inspectRestoreTransaction: async () => ({
        status: 'active',
        recoverable: false,
      }),
    },
  });
  assert.equal(active.status, 'degraded');
  assert.equal(active.restoreRecovery.status, 'degraded');
  assert.equal(active.restoreRecovery.reason, 'restore_in_progress');
});

test('restore CLI recovery is explicit and does not require a backup directory', async () => {
  const lines = [];
  const calls = [];

  const output = await runMemoryRestoreCli({
    argv: ['--db-path', 'C:/fixture/memory.sqlite3', '--recover'],
    log(value) {
      lines.push(value);
    },
    recoverRestore: async ({ dbPath }) => {
      calls.push(dbPath);
      return {
        status: 'recovered',
        action: 'rolled_back',
      };
    },
  });

  assert.equal(output.mode, 'recover');
  assert.equal(output.result.status, 'recovered');
  assert.equal(calls.length, 1);
  assert.equal(lines.length, 1);
});
