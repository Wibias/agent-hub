import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createIsolatedCodexEnv,
  prepareIsolatedCodexHome,
} from '../memory-engine/codex-memory-behavioral-eval.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
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
      reject(new Error(command + ' timed out after ' + timeoutMs + 'ms'));
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

async function initializeWorkspace(workspace, env, label) {
  await mkdir(workspace, { recursive: true });
  await writeFile(
    join(workspace, 'README.md'),
    '# Isolated Agent Hub ' + label + '\n',
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

export async function createIsolatedCodexJsonJudge({
  workspaceLabel,
  policyVersion,
  model = null,
  reasoningEffort = 'medium',
  env = process.env,
  timeoutMs = 120_000,
  sourceCodexHome = (
    process.env.CODEX_HOME
    || join(homedir(), '.codex')
  ),
  executable = process.env.CODEX_BIN || 'codex',
} = {}) {
  if (!nonEmpty(workspaceLabel)) {
    throw new TypeError('workspaceLabel must be a non-empty string');
  }
  if (!nonEmpty(policyVersion)) {
    throw new TypeError('policyVersion must be a non-empty string');
  }
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
    throw new TypeError('reasoningEffort must be low, medium, or high');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('timeoutMs must be a positive integer');
  }
  if (!nonEmpty(executable)) {
    throw new TypeError('executable must be a non-empty string');
  }

  const root = await mkdtemp(
    join(tmpdir(), 'agent-hub-' + workspaceLabel.replace(/[^a-z0-9-]+/gi, '-') + '-'),
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
        'isolated memory judge requires an authenticated Codex home containing auth.json',
      );
    }

    const isolatedEnv = createIsolatedCodexEnv(env, isolatedCodexHome);
    await initializeWorkspace(workspace, isolatedEnv, workspaceLabel);

    const evaluatorId = [
      'codex',
      model || 'default',
      policyVersion,
    ].join(':');

    let sequence = 0;
    const judge = async (prompt) => {
      if (!nonEmpty(prompt)) {
        throw new TypeError('judge prompt must be a non-empty string');
      }
      sequence += 1;
      const resultPath = join(root, 'result-' + sequence + '.json');
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

      const executed = await runProcess(executable, args, {
        cwd: workspace,
        env: isolatedEnv,
        input: prompt,
        timeoutMs,
      });
      if (executed.code !== 0) {
        throw new Error(
          [
            'codex isolated memory judge failed with exit ' + executed.code,
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
