#!/usr/bin/env node
/**
 * One benign Codex candidate-judge probe. Uses the exact isolated candidate
 * judge runtime without opening, modifying, or reading a Memory database.
 * Prints bounded status metadata only, never prompts, auth or provider output.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createCodexMemoryCandidateJudge,
} from './judge-memory-candidates.mjs';
import {
  parseMemoryCandidateJudgment,
} from '../memory-engine/memory-candidate-judge.mjs';
import {
  classifyCaptureFailure,
  classifyCaptureFailureOrigin,
} from '../memory-engine/memory-capture-diagnostics.mjs';

const PROBE_CANDIDATE = Object.freeze({
  id: 'read-only-judge-probe',
  proposed_type: 'constraint',
  proposed_value: 'For the temporary example project, keep all filenames lowercase.',
  source_authority: 'user_direct',
  policy_version: 'diagnostic-probe',
});

export function parseJudgeProbeArgs(argv = []) {
  const options = { model: null, reasoningEffort: 'medium' };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('options require non-empty values');
    }
    if (flag === '--model' && options.model === null) options.model = value.trim();
    else if (flag === '--reasoning-effort' && options.reasoningEffort === 'medium' && ['low','medium','high'].includes(value)) {
      options.reasoningEffort = value;
    } else throw new Error('supported options: --model NAME --reasoning-effort low|medium|high');
  }
  return options;
}

export function summarizeJudgeProbeFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  const exit = message.match(/^codex candidate judge failed with exit (\d+)\b/u);
  const origin = classifyCaptureFailureOrigin(message);
  const category = classifyCaptureFailure(message);
  return {
    status: 'failed',
    origin,
    category,
    ...(exit ? { exitCode: Number(exit[1]) } : {}),
  };
}

export async function runCodexCandidateJudgeProbe({
  model = null,
  reasoningEffort = 'medium',
  createJudge = createCodexMemoryCandidateJudge,
  parseJudgment = parseMemoryCandidateJudgment,
} = {}) {
  let resource = null;
  try {
    resource = await createJudge({
      cwd: process.cwd(),
      model,
      reasoningEffort,
    });
    const raw = await resource.judge(PROBE_CANDIDATE);
    try {
      parseJudgment(raw);
      return { status: 'ok', executionSucceeded: true, judgeResponseValid: true };
    } catch (error) {
      return { ...summarizeJudgeProbeFailure(error), executionSucceeded: true, judgeResponseValid: false };
    }
  } catch (error) {
    return { ...summarizeJudgeProbeFailure(error), executionSucceeded: false };
  } finally {
    if (resource && typeof resource.close === 'function') {
      await resource.close().catch(() => {});
    }
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  try {
    const output = await runCodexCandidateJudgeProbe(parseJudgeProbeArgs(process.argv.slice(2)));
    console.log(JSON.stringify({
      type: 'agent_hub_codex_candidate_judge_probe_v1',
      memoryDatabaseAccessed: false,
      ...output,
    }, null, 2));
    if (output.status !== 'ok') process.exitCode = 1;
  } catch {
    console.error('Candidate judge probe could not start (no diagnostics disclosed).');
    process.exitCode = 1;
  }
}
