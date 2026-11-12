#!/usr/bin/env node
/**
 * One synthetic, explicitly opted-in Codex candidate Judge model call.
 * Reuses the actual production Judge factory/isolated Codex home and
 * disposable Git workspace. Does not open or mutate canonical Memory SQLite.
 * Only fixed status codes are printed; never print raw stderr, tokens or model text.
 */
import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANDIDATE_JUDGE_POLICY_VERSION,
  parseMemoryCandidateJudgment,
} from '../memory-engine/memory-candidate-judge.mjs';
import { createCodexMemoryCandidateJudge } from './judge-memory-candidates.mjs';
import { resolveCodexJudgeExecutable } from '../memory-engine/codex-judge-executable.mjs';
import { createIsolatedCodexEnv, prepareIsolatedCodexHome } from '../memory-engine/codex-memory-behavioral-eval.mjs';

export const SYNTHETIC_CANDIDATE = Object.freeze({
  proposed_value: 'We chose a temporary implementation detail.',
  proposed_type: 'decision',
  source_authority: 'user_direct',
  policy_version: CANDIDATE_JUDGE_POLICY_VERSION,
});

export function classifyCodexJudgeSmokeFailure(error) {
  // The process error embeds untrusted CLI stdout/stderr. Inspect it locally
  // but return ONLY fixed, non-sensitive codes. Never return excerpts,
  // usernames, file paths, provider responses, account details or reset times.
  const raw = String(error instanceof Error ? error.message : error ?? '');
  const message = raw.toLowerCase();

  if (/codex_judge_cli_not_found|spawn codex enoent/.test(message)) {
    return 'cli_not_resolved';
  }
  if (/auth\.json|authenticated codex home/.test(message)) {
    return 'auth_file_missing_or_invalid';
  }

  // OpenAI Codex distinguishes subscription usage windows, credit depletion
  // and workspace spend caps. Check these before generic HTTP 429/rate limit:
  // an exhausted 5-hour or weekly budget can also produce a 429 response.
  if (/\b(?:you['’]ve|you have)\s+(?:hit|reached)\s+your\s+usage\s+limit\b|\b(?:usage[_ -]?limit[_ -]?(?:reached|exceeded)|(?:hit|reached|exceeded)\s+(?:your\s+)?(?:weekly\s+|daily\s+|five.hour\s+|5.hour\s+)?usage limit)\b/.test(message)) {
    return 'usage_limit_reached_possible';
  }
  if (/\b(?:workspace|account|organization|your)\s+(?:is\s+)?out of credits\b|\b(?:out of|no remaining|zero)\s+credits\b|\bcredits?\s+(?:are\s+)?(?:exhausted|depleted)\b|\binsufficient[_ -]credits?\b|\b(?:workspace_owner_credits_depleted|workspace_member_credits_depleted)\b/.test(message)) {
    return 'credits_exhausted_possible';
  }
  if (/\b(?:you\s+hit\s+your|(?:hit|reached|exceeded)\s+(?:your\s+)?(?:workspace\s+)?|increase\s+your\s+)(?:spend|spending)\s+cap\b|\bbilling[_ -]?hard[_ -]?limit[_ -]?reached\b|\b(?:workspace_owner_usage_limit_reached)\b/.test(message)) {
    return 'spend_cap_reached_possible';
  }
  if (/\bquota\s+(?:exceeded|exhausted|depleted|reached)\b|\b(?:insufficient[_ -]?quota|quota[_ -]?exceeded|resource_exhausted)\b/.test(message)) {
    return 'quota_exceeded_possible';
  }
  if (/\b(?:http\s*)?429\b|\b(?:rate[_ -]?limit(?:ed|ing)?(?:\s+exceeded)?|too many requests|requests per minute|tokens per minute)\b/.test(message)) {
    return 'rate_limited_possible';
  }
  if (/\b(?:unauthorized|unauthenticated|not logged in|authentication failed|invalid api key|token expired|login required|401)\b/.test(message)) {
    return 'authentication_rejected_possible';
  }
  if (/(?:model).*(?:not found|not available|does not exist|unsupported|unknown model|not supported)|unsupported.*model/.test(message)) {
    return 'model_unavailable_possible';
  }
  if (/\b(?:failed to (?:load|parse) config|invalid configuration|invalid config\.toml|unknown configuration key|unexpected argument|unrecognized option|unexpected argument|unknown option)\b/.test(message)) {
    return 'cli_configuration_or_arguments_possible';
  }
  if (/\b(?:dns lookup failed|connection refused|network is unreachable|failed to connect|could not resolve host|tls handshake failed)\b/.test(message)) {
    return 'network_unavailable_possible';
  }
  if (/timed out|timeout/.test(message)) {
    return 'timeout';
  }
  if (/eacces|eperm|permission denied/.test(message)) {
    return 'process_permission_denied';
  }
  if (/judgment response must be json|json.*parse|unexpected end of json|non-empty json/.test(message)) {
    return 'invalid_judge_json';
  }
  if (/unexpected field in memory candidate judgment|missing field in memory candidate judgment|must be one of|requires durability=/.test(message)) {
    return 'invalid_judge_schema';
  }
  if (/codex candidate judge failed with exit/.test(message)) {
    return 'codex_exec_nonzero_unclassified';
  }
  return 'judge_failure_unclassified';
}

export function sanitizedCodexJudgeExitCode(error) {
  const message = String(error instanceof Error ? error.message : error ?? '');
  const match = message.match(/\bcodex candidate judge failed with exit (\d{1,3})\b/i);
  if (!match) return null;
  const code = Number(match[1]);
  return Number.isInteger(code) && code > 0 && code <= 255 ? code : null;
}

export async function runCodexJudgeSmoke({
  runModel = false,
  cwd = process.cwd(),
  createJudge = createCodexMemoryCandidateJudge,
  parseJudgment = parseMemoryCandidateJudgment,
} = {}) {
  if (runModel !== true) {
    return {
      status: 'opt_in_required',
      model_call_attempted: false,
      memory_db_modified: false,
      instruction: 'Run with --run-model to make one synthetic Codex Judge model call.',
    };
  }

  let resource = null;
  let modelCallAttempted = false;
  try {
    resource = await createJudge({ cwd });
    if (!resource || typeof resource.judge !== 'function'
      || typeof resource.close !== 'function') {
      throw new TypeError('judge resource missing required interface');
    }

    modelCallAttempted = true;
    const raw = await resource.judge(SYNTHETIC_CANDIDATE);
    // Exact same parser/validation as the normal candidate importance stage.
    parseJudgment(raw);
    return {
      status: 'judge_usable',
      model_call_attempted: true,
      memory_db_modified: false,
      judgement_schema_valid: true,
    };
  } catch (error) {
    return {
      status: 'judge_failed',
      model_call_attempted: modelCallAttempted,
      memory_db_modified: false,
      failure_code: classifyCodexJudgeSmokeFailure(error),
      process_exit_code: sanitizedCodexJudgeExitCode(error),
    };
  } finally {
    if (resource?.close && typeof resource.close === 'function') {
      try { await resource.close(); } catch {}
    }
  }
}

// Only fixed CLI subcommands. No model, repository input, or user messages.
function runCodexOfflineCommand({ command, args, env, cwd, timeoutMs = 15_000 }) {
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd, env, shell: false, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolveResult({ status: 'launch_failed', exitCode: null, stdout: '' });
      return;
    }
    let finished = false;
    let stdout = '';
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolveResult(result);
    };
    const timeout = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ status: 'timeout', exitCode: null, stdout: '' });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      // Only --help/--version output is parsed; never returned to callers.
      if (stdout.length < 65_536) stdout += String(chunk).slice(0, 65_536 - stdout.length);
    });
    // Drain stderr without capturing it; login status can reveal account info.
    child.stderr.on('data', () => {});
    child.on('error', () => finish({
      status: 'launch_failed', exitCode: null, stdout: '',
    }));
    child.on('close', (code) => finish({
      status: 'completed',
      exitCode: Number.isInteger(code) && code >= 0 && code <= 255 ? code : null,
      stdout,
    }));
  });
}

/**
 * Shell-free, model-free inspection inside a disposable copy of the *same*
 * auth-only CODEX_HOME used by the production candidate Judge.
 * All process output stays local and is discarded after narrow parsing.
 */
export async function inspectCodexJudgeOffline({
  env = process.env,
  sourceCodexHome = env.MEMORY_CANDIDATE_JUDGE_SOURCE_CODEX_HOME
    || env.CODEX_HOME || join(homedir(), '.codex'),
  resolveJudge = resolveCodexJudgeExecutable,
  prepareHome = prepareIsolatedCodexHome,
  runCommand = runCodexOfflineCommand,
} = {}) {
  const base = {
    status: 'offline_checks_incomplete',
    model_call_attempted: false,
    memory_db_modified: false,
    executable_kind: null,
    cli_version: null,
    version_command: 'not_run',
    isolated_login_status: 'not_run',
    exec_flags: 'not_checked',
    source_config_file: 'not_checked',
    isolated_config_copied: false,
    note: 'Login status only verifies saved CLI authentication, not model access, network, tokens remaining or Codex Desktop hook execution.',
  };
  let root = null;
  try {
    let executable = resolveJudge({ env });
    if (!executable || !['native', 'npm_js', 'node_js', 'path_command'].includes(executable.kind)) {
      return { ...base, status: 'cli_not_resolved' };
    }
    const configPath = join(sourceCodexHome, 'config.toml');
    let sourceConfig = 'absent';
    try {
      const st = lstatSync(configPath);
      sourceConfig = st.isFile() && !st.isSymbolicLink() ? 'present_unread' : 'not_regular_file';
    } catch (error) {
      sourceConfig = error?.code === 'ENOENT' ? 'absent' : 'unavailable';
    }
    root = await mkdtemp(join(tmpdir(), 'agenthub-judge-offline-'));
    const isolatedHome = join(root, 'codex-home');
    const prepared = await prepareHome({
      sourceCodexHome, isolatedCodexHome: isolatedHome,
    });
    if (!prepared.authCopied) {
      return {
        ...base, status: 'auth_file_missing',
        executable_kind: executable.kind, source_config_file: sourceConfig,
      };
    }
    const isolatedEnv = createIsolatedCodexEnv(env, isolatedHome);
    const call = (args) => runCommand({
      command: executable.command, args: [...(executable.prefixArgs ?? []), ...args],
      env: isolatedEnv, cwd: root,
    });

    // Each call is an offline CLI mode. Login status never sends a model prompt.
    const version = await call(['--version']);
    const login = await call(['login', 'status']);
    const help = await call(['exec', '--help']);

    const versionMatch = version.exitCode === 0
      ? version.stdout.match(/\bcodex(?:-cli)?\s+(\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][a-z0-9.-]+)?)/i)
      : null;
    const flagsSupported = help.exitCode === 0
      && ['--cd', '--ephemeral', '--output-last-message']
        .every((flag) => help.stdout.includes(flag));
    return {
      ...base,
      status: version.exitCode === 0 && login.exitCode === 0 && flagsSupported
        ? 'offline_checks_passed'
        : 'offline_checks_incomplete',
      executable_kind: executable.kind,
      cli_version: versionMatch?.[1] ?? null,
      version_command: version.exitCode === 0 ? 'ok' : 'failed',
      isolated_login_status: login.exitCode === 0
        ? 'accepted_by_cli_unverified' : 'not_accepted_or_unavailable',
      exec_flags: flagsSupported ? 'supported' : 'missing_or_unavailable',
      source_config_file: sourceConfig,
    };
  } catch {
    return { ...base, status: 'offline_check_failed' };
  } finally {
    if (root) {
      try { await rm(root, { recursive: true, force: true }); } catch {}
    }
  }
}

export function parseSmokeArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  if (argv.length === 0) return { runModel: false };
  if (argv.length === 1 && argv[0] === '--run-model') return { runModel: true };
  if (argv.length === 1 && argv[0] === '--inspect-cli') return { inspectCli: true };
  throw new Error('usage: node scripts/smoke-codex-memory-judge.mjs [--inspect-cli|--run-model]');
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const options = parseSmokeArgs(process.argv.slice(2));
    const result = options.inspectCli
      ? await inspectCodexJudgeOffline()
      : await runCodexJudgeSmoke(options);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.status === 'judge_failed') process.exitCode = 2;
  } catch {
    process.stdout.write(JSON.stringify({
      status: 'invalid_invocation',
      model_call_attempted: false,
      memory_db_modified: false,
    }) + '\n');
    process.exitCode = 2;
  }
}
