#!/usr/bin/env node
/**
 * Opt-in, one-shot Codex candidate judge health probe.
 * Uses an isolated Codex home and a synthetic, non-sensitive candidate.
 * Never opens any Memory database or emits a model response.
 *
 * This invokes the judge once. The Codex CLI may perform its own retries.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCodexMemoryCandidateJudge } from './judge-memory-candidates.mjs';
import { parseMemoryCandidateJudgment } from '../memory-engine/memory-candidate-judge.mjs';

const BENIGN_CANDIDATE = Object.freeze({
  id: 'synthetic-codex-probe',
  proposed_type: 'constraint',
  proposed_value: 'For the temporary synthetic test project, file names use lowercase letters.',
  source_authority: 'user_direct',
  policy_version: 'synthetic-probe',
});

const EXIT_HINTS = new Set([
  'insufficient_quota', 'rate_limit', 'authentication', 'authorization',
  'model_configuration', 'provider_unavailable', 'connection',
  'missing_platform_dependency', 'unknown',
]);
const LAUNCH_HINTS = new Set([
  'executable_not_found', 'permission_denied', 'timeout', 'unknown',
]);

export function parseLiveCandidateProbeArgs(argv = []) {
  const options = { model: null, reasoningEffort: 'medium' };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (typeof value !== 'string' || !value.trim() || seen.has(flag)) {
      throw new Error('Expected --model NAME or --reasoning-effort low|medium|high');
    }
    seen.add(flag);
    if (flag === '--model') options.model = value.trim();
    else if (flag === '--reasoning-effort' && ['low', 'medium', 'high'].includes(value)) {
      options.reasoningEffort = value;
    } else {
      throw new Error('Expected --model NAME or --reasoning-effort low|medium|high');
    }
  }
  return options;
}

export function summarizeLiveCandidateProbeError(error, stage) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (stage === 'setup') {
    const code = typeof error?.code === 'string' ? error.code : '';
    const issues = new Set([
      'CODEX_NOT_FOUND', 'CODEX_NPM_ENTRYPOINT_MISSING',
      'CODEX_WINDOWS_LAUNCH_UNSUPPORTED', 'ENOENT', 'EACCES', 'EPERM',
    ]);
    const issue = issues.has(code) ? code
      : message.startsWith('candidate judge requires an authenticated Codex home')
        ? 'auth_json_missing'
        : message.startsWith('failed to initialize isolated judge workspace')
          ? 'git_workspace_failed'
          : 'unknown';
    return { status: 'failed', failedStage: stage, issue };
  }
  if (stage === 'execution') {
    const exited = /^codex candidate judge failed with exit (\d+|unknown): ([a-z_]+)$/u.exec(message);
    if (exited) return {
      status: 'failed', failedStage: stage,
      issue: EXIT_HINTS.has(exited[2]) ? exited[2] : 'unknown',
      exitCode: exited[1] === 'unknown' ? null : Number(exited[1]),
    };
    const launched = /^codex candidate judge launch failed: ([a-z_]+)$/u.exec(message);
    return {
      status: 'failed', failedStage: stage,
      issue: launched && LAUNCH_HINTS.has(launched[1]) ? launched[1] : 'unknown',
    };
  }
  return { status: 'failed', failedStage: 'validation', issue: 'invalid_judge_response' };
}

export async function runLiveCandidateProbe({
  model = null,
  reasoningEffort = 'medium',
  createJudge = createCodexMemoryCandidateJudge,
  parseResponse = parseMemoryCandidateJudgment,
} = {}) {
  let judge = null;
  let stage = 'setup';
  try {
    judge = await createJudge({ cwd: process.cwd(), model, reasoningEffort });
    stage = 'execution';
    const response = await judge.judge(BENIGN_CANDIDATE);
    stage = 'validation';
    parseResponse(response);
    return { status: 'ok', judgeExecutionSucceeded: true, judgeResponseValid: true };
  } catch (error) {
    return { ...summarizeLiveCandidateProbeError(error, stage),
      judgeExecutionSucceeded: stage === 'validation' };
  } finally {
    if (judge && typeof judge.close === 'function') {
      try { await judge.close(); } catch {}
    }
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  let report;
  try {
    report = await runLiveCandidateProbe(parseLiveCandidateProbeArgs(process.argv.slice(2)));
  } catch {
    report = { status: 'failed', failedStage: 'arguments', issue: 'invalid_arguments' };
  }
  console.log(JSON.stringify({
    type: 'agent_hub_codex_candidate_live_probe_v1',
    memoryDatabaseAccessed: false,
    judgeInvocations: report.failedStage === 'setup' || report.failedStage === 'arguments' ? 0 : 1,
    ...report,
  }, null, 2));
  if (report.status !== 'ok') process.exitCode = 1;
}
