import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createIsolatedCodexEnv,
  MEMORY_BEHAVIORAL_CASES,
  prepareIsolatedCodexHome,
  runMemoryBehavioralCases,
} from '../memory-engine/codex-memory-behavioral-eval.mjs';
import { createCodexMemoryHookAdapter } from '../memory-engine/adapters/codex-hooks.mjs';
import { createE5Embedder } from '../memory-engine/e5-embedder.mjs';
import { HybridMemoryRetriever } from '../memory-engine/hybrid-retrieval.mjs';
import { MemoryEngine } from '../memory-engine/index.mjs';

const PROJECT_ID = 'memory-behavioral-eval';
const BRANCH = 'main';
const REVISION_SHA = 'a'.repeat(40);
const FIXTURE_MEMORY =
  'memory: widget telemetry for compliance audits is retained for 37 days';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function runProcess(command, args, {
  cwd,
  env,
  input = null,
  timeoutMs = 120_000,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGTERM');
      } catch {}
      reject(new Error(
        `${command} timed out after ${timeoutMs}ms`,
      ));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout,
        stderr,
      });
    });

    if (input === null) child.stdin.end();
    else child.stdin.end(input);
  });
}

async function initializeIsolatedWorkspace(workspace, env) {
  await mkdir(workspace, { recursive: true });
  await writeFile(
    join(workspace, 'README.md'),
    '# Isolated memory behavioral evaluation\n',
  );

  const result = await runProcess('git', ['init', '-b', 'main'], {
    cwd: workspace,
    env,
    timeoutMs: 30_000,
  });
  if (result.code !== 0) {
    throw new Error(
      `failed to initialize isolated git workspace: ${result.stderr.trim()}`,
    );
  }
}

function ingestFixtureMemory(memory) {
  memory.registerProject({
    projectId: PROJECT_ID,
    repoIdentity: PROJECT_ID,
  });
  memory.ingest({
    evidence: {
      id: 'e-widget-compliance',
      projectId: PROJECT_ID,
      harness: 'codex',
      sessionId: 'memory-behavioral-eval',
      sourceKind: 'session',
      sourceRef: 'session:memory-behavioral-eval',
      capturedAt: '2026-10-01T00:00:00Z',
      branch: BRANCH,
      commitSha: null,
      path: null,
      blobOid: null,
      content: FIXTURE_MEMORY,
      authorityClass: 'user_direct',
      metadata: {
        fixture: 'codex-memory-behavioral-eval',
      },
    },
    claim: {
      id: 'c-widget-compliance',
      kind: 'user_direct',
      subject: 'user memory',
      predicate: 'states',
      value: FIXTURE_MEMORY,
      branchScope: BRANCH,
      createdAt: '2026-10-01T00:00:00Z',
    },
  });
}

function createHybridProtocol(hybrid) {
  return {
    async handle(request) {
      if (request?.operation !== 'recall') {
        throw new Error(
          `behavioral protocol only supports recall, received ${request?.operation}`,
        );
      }

      const payload = request.payload ?? {};
      const result = await hybrid.recall({
        projectId: payload.project_id,
        branch: payload.branch,
        revisionSha: payload.revision_sha ?? null,
        query: payload.query,
        mode: 'current',
        maxItems: payload.max_items ?? 10,
        maxSerializedBytes: payload.max_serialized_bytes ?? 16_384,
      });

      return {
        protocol: 'memory.protocol.v1',
        request_id: request.request_id,
        ok: true,
        result,
      };
    },
  };
}

async function codexVersion({ env, cwd }) {
  const result = await runProcess('codex', ['--version'], {
    env,
    cwd,
    timeoutMs: 30_000,
  });
  if (result.code !== 0) {
    throw new Error(
      `codex --version failed: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result.stdout.trim() || result.stderr.trim();
}

async function main() {
  const e5CacheDir = process.env.MEMORY_E5_MODEL_CACHE;
  if (!nonEmptyString(e5CacheDir)) {
    throw new Error(
      'MEMORY_E5_MODEL_CACHE must point at the prepared pinned E5 cache',
    );
  }

  const root = await mkdtemp(
    join(tmpdir(), 'agent-hub-codex-memory-behavioral-'),
  );
  const dbPath = join(root, 'memory.sqlite3');
  const isolatedCodexHome = join(root, 'codex-home');
  const workspace = join(root, 'workspace');
  const sourceCodexHome = (
    process.env.MEMORY_BEHAVIORAL_SOURCE_CODEX_HOME
    || process.env.CODEX_HOME
    || join(homedir(), '.codex')
  );
  const requestedModel = process.env.MEMORY_BEHAVIORAL_MODEL?.trim() || null;
  const reasoningEffort = (
    process.env.MEMORY_BEHAVIORAL_REASONING_EFFORT?.trim() || 'low'
  );
  const timeoutMs = Number.parseInt(
    process.env.MEMORY_BEHAVIORAL_TIMEOUT_MS ?? '120000',
    10,
  );
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('MEMORY_BEHAVIORAL_TIMEOUT_MS must be a positive integer');
  }

  const memory = new MemoryEngine({
    dbPath,
    clock: () => '2026-10-01T00:00:00Z',
  });

  try {
    ingestFixtureMemory(memory);

    const embedder = await createE5Embedder({
      cacheDir: e5CacheDir,
      allowRemoteModels: false,
    });
    const hybrid = new HybridMemoryRetriever({
      memory,
      embedder,
    });
    const rebuild = await hybrid.rebuildSemanticIndex({
      projectId: PROJECT_ID,
      branch: BRANCH,
    });
    if (rebuild.indexed !== 1 || rebuild.failed !== 0) {
      throw new Error(
        `unexpected semantic rebuild result: ${JSON.stringify(rebuild)}`,
      );
    }

    const isolation = await prepareIsolatedCodexHome({
      sourceCodexHome,
      isolatedCodexHome,
    });
    if (!isolation.authCopied) {
      throw new Error(
        [
          'No auth.json was found in the source Codex home.',
          'The behavioral eval refuses to reuse the full existing CODEX_HOME because that would reintroduce legacy memory/config contamination.',
          'Set MEMORY_BEHAVIORAL_SOURCE_CODEX_HOME to an authenticated Codex home containing auth.json.',
        ].join(' '),
      );
    }

    const isolatedEnv = createIsolatedCodexEnv(
      process.env,
      isolatedCodexHome,
    );
    await initializeIsolatedWorkspace(workspace, isolatedEnv);

    const version = await codexVersion({
      env: isolatedEnv,
      cwd: workspace,
    });

    const adapter = createCodexMemoryHookAdapter({
      protocol: createHybridProtocol(hybrid),
      memory,
      projectId: PROJECT_ID,
      git: {
        resolveContext() {
          return {
            repoPath: workspace,
            branch: BRANCH,
            revisionSha: REVISION_SHA,
          };
        },
        refreshFreshness() {
          return 0;
        },
      },
    });

    const retrievalEvidence = new Map();

    const result = await runMemoryBehavioralCases({
      cases: MEMORY_BEHAVIORAL_CASES,

      async getAdditionalContext(caseSpec) {
        const diagnostic = await hybrid.diagnoseRecall({
          projectId: PROJECT_ID,
          branch: BRANCH,
          revisionSha: REVISION_SHA,
          query: caseSpec.question,
          mode: 'current',
          maxItems: 10,
        });
        const top = diagnostic.candidates[0] ?? null;
        retrievalEvidence.set(caseSpec.id, {
          mode: diagnostic.retrievalMode,
          fallback: diagnostic.fallbackReason,
          topClaimId: top?.item?.claim?.id ?? null,
          lexicalRank: top?.lexicalRank ?? null,
          semanticRank: top?.semanticRank ?? null,
          semanticSimilarity: top?.semanticSimilarity ?? null,
          finalRank: top?.finalRank ?? null,
          rrfScore: top?.rrfScore ?? null,
        });

        const output = await adapter.handle({
          session_id: 'memory-behavioral-eval',
          transcript_path: null,
          cwd: workspace,
          hook_event_name: 'UserPromptSubmit',
          model: requestedModel ?? 'default',
          permission_mode: 'default',
          turn_id: `turn-${caseSpec.id}`,
          prompt: caseSpec.question,
        });

        const additionalContext = (
          output?.hookSpecificOutput?.additionalContext
        );
        if (!nonEmptyString(additionalContext)) {
          throw new Error(
            `hook produced no additionalContext for ${caseSpec.id}`,
          );
        }
        return additionalContext;
      },

      async runCodex({ caseSpec, prompt, additionalContext }) {
        const resultPath = join(root, `${caseSpec.id}.last-message.txt`);
        const args = [
          'exec',
          '--cd',
          workspace,
          '--ephemeral',
          '--output-last-message',
          resultPath,
          '-c',
          `model_reasoning_effort="${reasoningEffort}"`,
        ];
        if (requestedModel) {
          args.push('--model', requestedModel);
        }
        args.push('-');

        const executed = await runProcess('codex', args, {
          cwd: workspace,
          env: isolatedEnv,
          input: prompt,
          timeoutMs,
        });
        if (executed.code !== 0) {
          throw new Error(
            [
              `codex exec failed for ${caseSpec.id} with exit ${executed.code}`,
              executed.stderr.trim(),
              executed.stdout.trim(),
            ].filter(Boolean).join(': '),
          );
        }

        const output = await readFile(resultPath, 'utf8');
        console.log(JSON.stringify({
          type: 'codex_memory_behavioral_case_runtime',
          id: caseSpec.id,
          context_sha256: sha256(additionalContext),
          retrieval: retrievalEvidence.get(caseSpec.id) ?? null,
        }));
        return output;
      },
    });

    for (const item of result.cases) {
      console.log(JSON.stringify({
        type: 'codex_memory_behavioral_case',
        ...item,
        retrieval: retrievalEvidence.get(item.id) ?? null,
      }));
    }

    console.log(JSON.stringify({
      type: 'codex_memory_behavioral_summary',
      pass: result.pass,
      total_cases: result.totalCases,
      passed_cases: result.passedCases,
      failed_cases: result.failedCases,
      codex_version: version,
      model: requestedModel ?? 'codex-default',
      reasoning_effort: reasoningEffort,
      e5_model_id: embedder.modelId,
      e5_model_revision: embedder.modelRevision,
      isolation: {
        fresh_codex_home: true,
        copied_auth_only: true,
        inherited_hooks: false,
        inherited_config: false,
        inherited_legacy_memory: false,
        ephemeral_workspace: true,
      },
    }));

    if (!result.pass) process.exitCode = 1;
  } finally {
    memory.close();
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
