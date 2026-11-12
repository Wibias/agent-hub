#!/usr/bin/env node
/**
 * One synthetic, explicitly opted-in Codex candidate Judge model call.
 * Reuses the actual production Judge factory/isolated Codex home and
 * disposable Git workspace. Does not open or mutate canonical Memory SQLite.
 * Only fixed status codes are printed; never print raw stderr, tokens or model text.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANDIDATE_JUDGE_POLICY_VERSION,
  parseMemoryCandidateJudgment,
} from '../memory-engine/memory-candidate-judge.mjs';
import { createCodexMemoryCandidateJudge } from './judge-memory-candidates.mjs';

export const SYNTHETIC_CANDIDATE = Object.freeze({
  proposed_value: 'We chose a temporary implementation detail.',
  proposed_type: 'decision',
  source_authority: 'user_direct',
  policy_version: CANDIDATE_JUDGE_POLICY_VERSION,
});

export function classifyCodexJudgeSmokeFailure(error) {
  const raw = String(error instanceof Error ? error.message : error ?? '');
  const message = raw.toLowerCase();
  if (/codex_judge_cli_not_found|spawn codex enoent/.test(message)) {
    return 'cli_not_resolved';
  }
  if (/auth\.json|authenticated codex home/.test(message)) {
    return 'auth_file_missing_or_invalid';
  }
  if (/429|rate limit|too many requests/.test(message)) {
    return 'rate_limited_possible';
  }
  if (/quota exceeded|insufficient quota|credits exhausted/.test(message)) {
    return 'quota_exceeded_possible';
  }
  if (/unauthorized|unauthenticated|not logged in|authentication failed|401|invalid api key|token expired/.test(message)) {
    return 'authentication_rejected_possible';
  }
  if (/(?:model).*(?:not found|not available|does not exist|unsupported|unknown model)/.test(message)) {
    return 'model_unavailable_possible';
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
    };
  } finally {
    if (resource?.close && typeof resource.close === 'function') {
      try { await resource.close(); } catch {}
    }
  }
}

export function parseSmokeArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  if (argv.length === 0) return { runModel: false };
  if (argv.length === 1 && argv[0] === '--run-model') return { runModel: true };
  throw new Error('usage: node scripts/smoke-codex-memory-judge.mjs [--run-model]');
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const result = await runCodexJudgeSmoke(parseSmokeArgs(process.argv.slice(2)));
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
