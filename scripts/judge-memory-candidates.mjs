#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildMemoryCandidateJudgePrompt,
  CANDIDATE_JUDGE_POLICY_VERSION,
  evaluatePendingMemoryCandidates,
} from '../memory-engine/memory-candidate-judge.mjs';
import {
  createIsolatedCodexEnv,
  prepareIsolatedCodexHome,
} from '../memory-engine/codex-memory-behavioral-eval.mjs';
import {
  defaultCodexMemoryDbPath,
  resolveCodexProjectScope,
} from '../memory-engine/adapters/codex-hook-cli.mjs';
import { resolveGitContext } from '../memory-engine/git-freshness.mjs';
import { MemoryEngine } from '../memory-engine/index.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parsePositiveInt(value, name, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(name + ' must be an integer between 1 and ' + max);
  }
  return parsed;
}

export function parseMemoryCandidateJudgeArgs(
  argv = [],
  defaultCwd = process.cwd(),
) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');

  const options = {
    cwd: defaultCwd,
    dbPath: null,
    limit: 10,
    apply: false,
    model: null,
    reasoningEffort: 'medium',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    if ([
      '--cwd',
      '--db-path',
      '--limit',
      '--model',
      '--reasoning-effort',
    ].includes(arg)) {
      const value = argv[index + 1];
      if (!nonEmpty(value)) {
        throw new Error(arg + ' requires a value');
      }
      index += 1;

      if (arg === '--cwd') options.cwd = resolve(value);
      else if (arg === '--db-path') options.dbPath = resolve(value);
      else if (arg === '--limit') {
        options.limit = parsePositiveInt(value, '--limit', 20);
      } else if (arg === '--model') options.model = value.trim();
      else {
        const normalized = value.trim().toLowerCase();
        if (!['low', 'medium', 'high'].includes(normalized)) {
          throw new Error('--reasoning-effort must be low, medium, or high');
        }
        options.reasoningEffort = normalized;
      }
      continue;
    }

    throw new Error('unknown argument: ' + arg);
  }

  return options;
}

function runProcess(command, args, {
  cwd,
  env,
  input = null,
  timeoutMs = 120_000,
} = {}) {
  return new Promise((resolvePromise, reject) => {
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
        command + ' timed out after ' + timeoutMs + 'ms',
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
      resolvePromise({
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

async function initializeEmptyWorkspace(workspace, env) {
  await mkdir(workspace, { recursive: true });
  await writeFile(
    join(workspace, 'README.md'),
    '# Isolated Agent Hub memory candidate judge\n',
    'utf8',
  );

  const initialized = await runProcess(
    'git',
    ['init', '-b', 'main'],
    {
      cwd: workspace,
      env,
      timeoutMs: 30_000,
    },
  );
  if (initialized.code !== 0) {
    throw new Error(
      'failed to initialize isolated judge workspace: '
      + initialized.stderr.trim(),
    );
  }
}

export function resolveMemoryCandidateJudgeRuntime({
  cwd,
  dbPath,
  env = process.env,
} = {}) {
  const git = resolveGitContext({ cwd });
  const scope = resolveCodexProjectScope({
    event: { cwd },
    config: {
      projectId: null,
      repoIdentity: null,
    },
  });

  return {
    cwd: git.repoPath,
    dbPath: dbPath ?? defaultCodexMemoryDbPath({ env }),
    projectId: scope.projectId,
    branch: git.branch,
    revisionSha: git.revisionSha,
  };
}

export async function createCodexMemoryCandidateJudge({
  cwd,
  model = null,
  reasoningEffort = 'medium',
  env = process.env,
  timeoutMs = Number.parseInt(
    process.env.MEMORY_CANDIDATE_JUDGE_TIMEOUT_MS ?? '120000',
    10,
  ),
  sourceCodexHome = (
    process.env.MEMORY_CANDIDATE_JUDGE_SOURCE_CODEX_HOME
    || process.env.CODEX_HOME
    || join(homedir(), '.codex')
  ),
} = {}) {
  if (!nonEmpty(cwd)) throw new TypeError('cwd must be a non-empty string');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('timeoutMs must be a positive integer');
  }

  const root = await mkdtemp(
    join(tmpdir(), 'agent-hub-memory-candidate-judge-'),
  );
  const isolatedCodexHome = join(root, 'codex-home');
  const workspace = join(root, 'workspace');

  try {
    const isolation = await prepareIsolatedCodexHome({
      sourceCodexHome,
      isolatedCodexHome,
    });
    if (!isolation.authCopied) {
      throw new Error(
        'candidate judge requires an authenticated Codex home containing auth.json',
      );
    }

    const isolatedEnv = createIsolatedCodexEnv(env, isolatedCodexHome);
    await initializeEmptyWorkspace(workspace, isolatedEnv);

    const evaluatorId = [
      'codex',
      model || 'default',
      CANDIDATE_JUDGE_POLICY_VERSION,
    ].join(':');

    let sequence = 0;
    const judge = async (candidate) => {
      sequence += 1;
      const resultPath = join(root, 'result-' + sequence + '.json');
      const prompt = buildMemoryCandidateJudgePrompt(candidate);
      const args = [
        'exec',
        '--cd',
        workspace,
        '--ephemeral',
        '--output-last-message',
        resultPath,
        '-c',
        'model_reasoning_effort="' + reasoningEffort + '"',
      ];
      if (model) args.push('--model', model);
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
            'codex candidate judge failed with exit ' + executed.code,
            executed.stderr.trim(),
            executed.stdout.trim(),
          ].filter(Boolean).join(': '),
        );
      }

      return readFile(resultPath, 'utf8');
    };

    return {
      judge,
      evaluatorId,
      isolation: {
        freshCodexHome: true,
        copiedAuthOnly: true,
        inheritedHooks: false,
        inheritedConfig: false,
        inheritedLegacyMemory: false,
        emptyWorkspace: true,
      },
      async close() {
        await rm(root, {
          recursive: true,
          force: true,
        });
      },
    };
  } catch (error) {
    await rm(root, {
      recursive: true,
      force: true,
    }).catch(() => {});
    throw error;
  }
}

export async function runMemoryCandidateJudgeCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  log = console.log,
  dependencies = {},
} = {}) {
  const options = parseMemoryCandidateJudgeArgs(argv, cwd);
  const resolveRuntime = dependencies.resolveRuntime
    || resolveMemoryCandidateJudgeRuntime;
  const createMemory = dependencies.createMemory
    || (({ dbPath }) => new MemoryEngine({ dbPath }));
  const evaluateCandidates = dependencies.evaluateCandidates
    || evaluatePendingMemoryCandidates;
  const createJudge = dependencies.createJudge
    || createCodexMemoryCandidateJudge;

  const runtime = resolveRuntime({
    cwd: options.cwd,
    dbPath: options.dbPath,
  });
  const memory = createMemory({ dbPath: runtime.dbPath });

  let judgeResource = null;
  try {
    judgeResource = await createJudge({
      cwd: runtime.cwd,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
    });

    const judge = typeof judgeResource === 'function'
      ? judgeResource
      : judgeResource.judge;
    if (typeof judge !== 'function') {
      throw new TypeError('candidate judge factory must return a judge function');
    }

    const evaluatorId = (
      typeof judgeResource === 'object'
      && nonEmpty(judgeResource?.evaluatorId)
    )
      ? judgeResource.evaluatorId
      : [
          'codex',
          options.model || 'default',
          CANDIDATE_JUDGE_POLICY_VERSION,
        ].join(':');

    const summary = await evaluateCandidates({
      memory,
      projectId: runtime.projectId,
      branch: runtime.branch,
      apply: options.apply,
      limit: options.limit,
      evaluatorId,
      judge,
    });

    const output = {
      type: 'agent_hub_memory_candidate_judge',
      mode: options.apply ? 'apply' : 'dry-run',
      projectId: runtime.projectId,
      branch: runtime.branch,
      evaluatorId,
      policyVersion: CANDIDATE_JUDGE_POLICY_VERSION,
      summary,
      isolation: (
        typeof judgeResource === 'object'
          ? judgeResource.isolation ?? null
          : null
      ),
    };

    log(JSON.stringify(output));
    return output;
  } finally {
    if (
      judgeResource
      && typeof judgeResource === 'object'
      && typeof judgeResource.close === 'function'
    ) {
      await judgeResource.close().catch(() => {});
    }
    if (memory && typeof memory.close === 'function') {
      memory.close();
    }
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  runMemoryCandidateJudgeCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
