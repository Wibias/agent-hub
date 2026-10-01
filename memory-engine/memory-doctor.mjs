import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { E5_DIMENSIONS, E5_MODEL_ID, E5_MODEL_REVISION } from './e5-embedder.mjs';
import { createEmbeddingIpcClient, defaultEmbeddingIpcPath } from './embedding-ipc.mjs';
import { resolveGitContext as defaultResolveGitContext } from './git-freshness.mjs';
import { auditCodexState } from './codex-state-audit.mjs';
import { inspectCodexNativeMemoryConfig } from './codex-native-memory-isolation.mjs';
import { inspectMemoryRestoreTransaction } from './memory-restore-journal.mjs';
import {
  defaultCodexEmbeddingCacheDir,
  defaultCodexMemoryDbPath,
  resolveCodexProjectScope,
} from './adapters/codex-hook-cli.mjs';

const REQUIRED_TABLES = Object.freeze([
  'approvals',
  'claim_embeddings',
  'claim_fts',
  'claims',
  'conflicts',
  'evidence',
  'lifecycle_events',
  'project_registry',
  'repository_path_state',
]);

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function defaultCodexHome({ env = process.env, homeDir = homedir() } = {}) {
  return resolve(env.CODEX_HOME || join(homeDir, '.codex'));
}

function scalar(row, key) {
  return Number(row?.[key] ?? 0);
}

function baseDatabaseResult({ dbPath, exists, status, error = null }) {
  return {
    status,
    dbPath: resolve(dbPath),
    exists,
    readOnly: true,
    quickCheck: null,
    foreignKeyViolations: null,
    journalMode: null,
    missingTables: [],
    projectRegistered: null,
    claims: null,
    activeClaims: null,
    ftsRows: null,
    lexicalCoverageComplete: null,
    currentEmbeddings: null,
    validCurrentEmbeddings: null,
    semanticCoverageComplete: null,
    modelId: E5_MODEL_ID,
    modelRevision: E5_MODEL_REVISION,
    dimensions: E5_DIMENSIONS,
    error,
  };
}

export function inspectMemoryDatabase({ dbPath, projectId = null, branch = null }) {
  if (typeof dbPath !== 'string' || dbPath.trim().length === 0) {
    throw new TypeError('dbPath must be a non-empty string');
  }

  const resolvedPath = resolve(dbPath);
  if (!existsSync(resolvedPath)) {
    return baseDatabaseResult({
      dbPath: resolvedPath,
      exists: false,
      status: 'broken',
      error: 'memory_database_missing',
    });
  }

  let db = null;
  try {
    db = new DatabaseSync(resolvedPath, {
      readOnly: true,
      timeout: 5_000,
      enableForeignKeyConstraints: true,
    });

    const quickRows = db.prepare('PRAGMA quick_check').all();
    const quickValues = quickRows.map((row) => String(
      row.quick_check ?? Object.values(row)[0] ?? '',
    ));
    const quickCheck = quickValues.length === 1 && quickValues[0].toLowerCase() === 'ok'
      ? 'ok'
      : quickValues.join('; ') || 'unknown';

    const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all().length;
    const journalMode = String(
      db.prepare('PRAGMA journal_mode').get()?.journal_mode ?? '',
    ).toLowerCase();

    const presentTables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
        .all()
        .map((row) => row.name),
    );
    const missingTables = REQUIRED_TABLES.filter((name) => !presentTables.has(name));

    if (quickCheck !== 'ok' || foreignKeyViolations > 0 || missingTables.length > 0) {
      return {
        ...baseDatabaseResult({ dbPath: resolvedPath, exists: true, status: 'broken' }),
        quickCheck,
        foreignKeyViolations,
        journalMode,
        missingTables,
        error: quickCheck !== 'ok'
          ? 'sqlite_quick_check_failed'
          : foreignKeyViolations > 0
            ? 'sqlite_foreign_key_check_failed'
            : 'memory_schema_incomplete',
      };
    }

    let projectRegistered = null;
    let claims = null;
    let activeClaims = null;
    let ftsRows = null;
    let lexicalCoverageComplete = null;
    let currentEmbeddings = null;
    let validCurrentEmbeddings = null;
    let semanticCoverageComplete = null;

    if (typeof projectId === 'string' && projectId.length > 0
        && typeof branch === 'string' && branch.length > 0) {
      projectRegistered = Boolean(
        db.prepare('SELECT 1 AS present FROM project_registry WHERE project_id = ?').get(projectId),
      );
      claims = scalar(
        db.prepare('SELECT COUNT(*) AS count FROM claims WHERE project_id = ? AND branch_scope = ?')
          .get(projectId, branch),
        'count',
      );
      activeClaims = scalar(
        db.prepare("SELECT COUNT(*) AS count FROM claims WHERE project_id = ? AND branch_scope = ? AND state = 'active'")
          .get(projectId, branch),
        'count',
      );
      ftsRows = scalar(
        db.prepare('SELECT COUNT(*) AS count FROM claim_fts WHERE project_id = ? AND branch_scope = ?')
          .get(projectId, branch),
        'count',
      );
      lexicalCoverageComplete = ftsRows === claims;

      const embeddingRow = db.prepare(
        'SELECT COUNT(*) AS current_count, ' +
        'COALESCE(SUM(CASE WHEN ce.dimensions = ? AND length(ce.vector_blob) = ? THEN 1 ELSE 0 END), 0) AS valid_count ' +
        'FROM claim_embeddings ce JOIN claims c ON c.id = ce.claim_id ' +
        'WHERE c.project_id = ? AND c.branch_scope = ? AND ce.model_id = ? AND ce.model_revision = ?'
      ).get(
        E5_DIMENSIONS,
        E5_DIMENSIONS * Float32Array.BYTES_PER_ELEMENT,
        projectId,
        branch,
        E5_MODEL_ID,
        E5_MODEL_REVISION,
      );

      currentEmbeddings = scalar(embeddingRow, 'current_count');
      validCurrentEmbeddings = scalar(embeddingRow, 'valid_count');
      semanticCoverageComplete = currentEmbeddings === claims && validCurrentEmbeddings === claims;
    }

    const degraded = journalMode !== 'wal'
      || projectRegistered === false
      || lexicalCoverageComplete === false
      || semanticCoverageComplete === false;

    return {
      status: degraded ? 'degraded' : 'ok',
      dbPath: resolvedPath,
      exists: true,
      readOnly: true,
      quickCheck,
      foreignKeyViolations,
      journalMode,
      missingTables,
      projectRegistered,
      claims,
      activeClaims,
      ftsRows,
      lexicalCoverageComplete,
      currentEmbeddings,
      validCurrentEmbeddings,
      semanticCoverageComplete,
      modelId: E5_MODEL_ID,
      modelRevision: E5_MODEL_REVISION,
      dimensions: E5_DIMENSIONS,
      error: null,
    };
  } catch (error) {
    return baseDatabaseResult({
      dbPath: resolvedPath,
      exists: true,
      status: 'broken',
      error: errorMessage(error),
    });
  } finally {
    try {
      db?.close();
    } catch {
      // Never hide the primary read-only diagnostic.
    }
  }
}

async function directoryContainsFile(root, { maxEntries = 4_096 } = {}) {
  const queue = [root];
  let visited = 0;
  while (queue.length > 0 && visited < maxEntries) {
    const current = queue.shift();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      if (entry.isFile()) return true;
      if (entry.isDirectory()) queue.push(join(current, entry.name));
      if (visited >= maxEntries) break;
    }
  }
  return false;
}

export async function inspectEmbeddingCache({ cacheDir }) {
  if (typeof cacheDir !== 'string' || cacheDir.trim().length === 0) {
    throw new TypeError('cacheDir must be a non-empty string');
  }
  const resolved = resolve(cacheDir);
  let exists = false;
  let nonEmpty = false;
  try {
    const info = await stat(resolved);
    exists = info.isDirectory();
    if (exists) nonEmpty = await directoryContainsFile(resolved);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return {
        status: 'degraded',
        exists: false,
        nonEmpty: false,
        cacheDir: resolved,
        remoteModelsAllowed: false,
        modelId: E5_MODEL_ID,
        modelRevision: E5_MODEL_REVISION,
        dimensions: E5_DIMENSIONS,
        error: errorMessage(error),
      };
    }
  }
  return {
    status: exists && nonEmpty ? 'ok' : 'degraded',
    exists,
    nonEmpty,
    cacheDir: resolved,
    remoteModelsAllowed: false,
    modelId: E5_MODEL_ID,
    modelRevision: E5_MODEL_REVISION,
    dimensions: E5_DIMENSIONS,
  };
}

export async function inspectEmbeddingWorker({
  socketPath = defaultEmbeddingIpcPath(),
  timeoutMs = 1_000,
  createClient = createEmbeddingIpcClient,
} = {}) {
  let ready = false;
  try {
    const client = createClient({
      socketPath,
      modelId: E5_MODEL_ID,
      modelRevision: E5_MODEL_REVISION,
      dimensions: E5_DIMENSIONS,
      timeoutMs,
    });
    const health = await client.health();
    ready = health?.ready === true;
    if (!ready) throw new Error('embedding worker health probe was not ready');
    const vector = await client.embedQuery('memory doctor health probe');
    const queryCanary = vector instanceof Float32Array
      && vector.length === E5_DIMENSIONS
      && [...vector].every(Number.isFinite);
    if (!queryCanary) throw new Error('embedding worker query canary returned an invalid vector');
    return {
      status: 'ok',
      ready: true,
      queryCanary: true,
      socketPath,
      modelId: E5_MODEL_ID,
      modelRevision: E5_MODEL_REVISION,
      dimensions: E5_DIMENSIONS,
      error: null,
    };
  } catch (error) {
    return {
      status: 'degraded',
      ready,
      queryCanary: false,
      socketPath,
      modelId: E5_MODEL_ID,
      modelRevision: E5_MODEL_REVISION,
      dimensions: E5_DIMENSIONS,
      error: errorMessage(error),
    };
  }
}

export async function inspectCodexIntegration({ codexHome, auditState = auditCodexState }) {
  try {
    const audit = await auditState({ codexHome });
    const hook = audit.agentHubHook;
    const critical = hook?.configured === true
      && hook?.userPromptSubmit === true
      && hook?.flags?.ignoreMemoryEnv === true
      && hook?.flags?.explicitMemoryRequests === true
      && hook?.flags?.hybridRecall === true;
    if (!critical || audit.hookReadError) {
      return {
        status: 'broken',
        hook,
        hookReadError: audit.hookReadError,
        reason: audit.hookReadError ? 'codex_hooks_unreadable' : 'agent_hub_hook_incomplete',
      };
    }
    if (hook.sessionStartLauncher !== true) {
      return {
        status: 'degraded',
        hook,
        hookReadError: null,
        reason: 'session_start_launcher_missing',
      };
    }
    return { status: 'ok', hook, hookReadError: null, reason: null };
  } catch (error) {
    return {
      status: 'broken',
      hook: null,
      hookReadError: errorMessage(error),
      reason: 'codex_state_audit_failed',
    };
  }
}

export async function inspectNativeCodexMemoryIsolation({
  codexHome,
  agentHubHookConfigured = true,
}) {
  if (agentHubHookConfigured !== true) {
    return { status: 'not_applicable', settings: null, reasons: [], error: null };
  }
  try {
    const configPath = join(resolve(codexHome), 'config.toml');
    let text = '';
    try {
      text = await readFile(configPath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const settings = inspectCodexNativeMemoryConfig(text);
    const reasons = [];
    if (settings.featureEnabled !== false) reasons.push('features.memories_not_false');
    if (settings.useMemories !== false) reasons.push('memories.use_memories_not_false');
    if (settings.generateMemories !== false) reasons.push('memories.generate_memories_not_false');
    return {
      status: reasons.length === 0 ? 'isolated' : 'broken',
      settings,
      reasons,
      error: null,
    };
  } catch (error) {
    return { status: 'broken', settings: null, reasons: [], error: errorMessage(error) };
  }
}

export function evaluateMemoryDoctorStatus(checks) {
  const statuses = (checks ?? []).map((check) => check?.status);
  if (statuses.includes('broken')) return 'broken';
  if (statuses.includes('degraded')) return 'degraded';
  return 'healthy';
}

function restoreRecoveryStatus(transaction) {
  if (transaction?.status === 'none') {
    return {
      status: 'ok',
      transactionStatus: 'none',
      recoverable: false,
      reason: null,
    };
  }

  if (transaction?.status === 'active') {
    return {
      status: 'degraded',
      transactionStatus: 'active',
      recoverable: false,
      reason: 'restore_in_progress',
      transaction,
    };
  }

  if (transaction?.status === 'stale') {
    return {
      status: 'broken',
      transactionStatus: 'stale',
      recoverable: transaction.recoverable === true,
      reason: 'stale_restore_transaction',
      transaction,
    };
  }

  return {
    status: 'broken',
    transactionStatus: transaction?.status ?? 'invalid',
    recoverable: false,
    reason: 'invalid_restore_transaction',
    transaction,
  };
}

function recallStatus(database) {
  if (database?.status === 'broken') {
    return {
      status: 'broken',
      lexicalCoverageComplete: null,
      semanticCoverageComplete: null,
      reason: 'database_unavailable',
    };
  }
  if (database?.claims === 0) {
    return {
      status: 'not_applicable',
      lexicalCoverageComplete: true,
      semanticCoverageComplete: true,
      reason: 'no_claims_in_current_scope',
    };
  }
  const lexical = database?.lexicalCoverageComplete;
  const semantic = database?.semanticCoverageComplete;
  if (lexical === false || semantic === false) {
    return {
      status: 'degraded',
      lexicalCoverageComplete: lexical,
      semanticCoverageComplete: semantic,
      reason: 'derived_recall_state_incomplete',
    };
  }
  return {
    status: 'ok',
    lexicalCoverageComplete: lexical,
    semanticCoverageComplete: semantic,
    reason: null,
  };
}

export async function runMemoryDoctor({
  cwd = process.cwd(),
  dbPath = defaultCodexMemoryDbPath(),
  cacheDir = defaultCodexEmbeddingCacheDir(),
  codexHome = defaultCodexHome(),
  dependencies = {},
} = {}) {
  const resolveScope = dependencies.resolveScope || (({ cwd: currentCwd }) => resolveCodexProjectScope({
    event: { cwd: currentCwd },
    config: { projectId: null, repoIdentity: null },
  }));
  const resolveGit = dependencies.resolveGitContext || defaultResolveGitContext;
  const inspectDatabase = dependencies.inspectDatabase || inspectMemoryDatabase;
  const inspectCache = dependencies.inspectCache || inspectEmbeddingCache;
  const inspectWorker = dependencies.inspectWorker || inspectEmbeddingWorker;
  const inspectCodex = dependencies.inspectCodex || inspectCodexIntegration;
  const inspectNativeIsolation = dependencies.inspectNativeIsolation || inspectNativeCodexMemoryIsolation;
  const inspectRestoreTransaction = dependencies.inspectRestoreTransaction || inspectMemoryRestoreTransaction;

  let scope = null;
  let git = null;
  let context;
  try {
    scope = await resolveScope({ cwd });
    git = await resolveGit({ cwd });
    context = {
      status: 'ok',
      cwd,
      repoPath: git.repoPath,
      projectId: scope.projectId,
      branch: git.branch,
      revisionSha: git.revisionSha,
    };
  } catch (error) {
    context = {
      status: 'broken',
      cwd,
      repoPath: git?.repoPath ?? null,
      projectId: scope?.projectId ?? null,
      branch: git?.branch ?? null,
      revisionSha: git?.revisionSha ?? null,
      error: errorMessage(error),
    };
  }

  const restoreTransaction = await inspectRestoreTransaction({ dbPath });
  const restoreRecovery = restoreRecoveryStatus(restoreTransaction);

  const database = await inspectDatabase({
    dbPath,
    projectId: context.projectId,
    branch: context.branch,
  });
  const cache = await inspectCache({ cacheDir });
  const worker = await inspectWorker();
  const codex = await inspectCodex({ codexHome });
  const nativeCodexMemory = await inspectNativeIsolation({
    codexHome,
    agentHubHookConfigured: codex?.hook?.configured === true,
  });
  const recall = recallStatus(database);

  const status = evaluateMemoryDoctorStatus([
    context,
    database,
    cache,
    worker,
    recall,
    codex,
    nativeCodexMemory,
    restoreRecovery,
  ]);

  return {
    type: 'agent_hub_memory_doctor',
    status,
    readOnly: true,
    context,
    database,
    embedding: {
      modelId: E5_MODEL_ID,
      modelRevision: E5_MODEL_REVISION,
      dimensions: E5_DIMENSIONS,
      remoteModelsAllowed: false,
      cache,
      worker,
    },
    recall,
    codex,
    nativeCodexMemory,
    restoreRecovery,
    safety: {
      databaseReadOnly: true,
      checkpoint: false,
      reindex: false,
      workerLaunch: false,
      remoteModelDownload: false,
      configMutation: false,
      memoryMutation: false,
    },
  };
}