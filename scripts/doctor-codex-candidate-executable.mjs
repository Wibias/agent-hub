#!/usr/bin/env node
/**
 * Verify that the Codex executable can start without any model request.
 * No memory database, auth contents, prompts, or arbitrary provider output.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveCodexCandidateLaunch } from '../memory-engine/codex-candidate-launch.mjs';
import { codexCandidateFailureCode } from '../memory-engine/codex-candidate-process-error.mjs';

const KNOWN_ERRORS = new Set([
  'CODEX_NOT_FOUND', 'CODEX_NPM_ENTRYPOINT_MISSING',
  'CODEX_WINDOWS_LAUNCH_UNSUPPORTED', 'ENOENT', 'EACCES', 'EPERM',
]);

export function verifyCodexCandidateExecutable({
  resolveLaunch = resolveCodexCandidateLaunch,
  spawnProcess = spawnSync,
} = {}) {
  let launch;
  try {
    launch = resolveLaunch();
  } catch (error) {
    return {
      status: 'failed',
      stage: 'resolution',
      issue: KNOWN_ERRORS.has(error?.code) ? error.code : 'unknown',
    };
  }
  let result;
  try {
    result = spawnProcess(launch.command, [...launch.prefixArgs, '--version'], {
      encoding: 'utf8', timeout: 10_000, windowsHide: true, shell: false,
    });
  } catch {
    return { status: 'failed', stage: 'execution', launchKind: launch.kind, issue: 'spawn_failed' };
  }
  if (result?.error) {
    return {
      status: 'failed',
      stage: 'execution',
      launchKind: launch.kind,
      issue: KNOWN_ERRORS.has(result.error.code) ? result.error.code : 'spawn_failed',
    };
  }
  if (result?.status !== 0) {
    return {
      status: 'failed',
      stage: 'execution',
      launchKind: launch.kind,
      issue: codexCandidateFailureCode({
        stderr: result?.stderr,
        stdout: result?.stdout,
      }),
      exitCode: Number.isInteger(result?.status) ? result.status : null,
    };
  }
  return { status: 'ok', launchKind: launch.kind, versionCommandSucceeded: true };
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (import.meta.url === entryUrl) {
  const result = verifyCodexCandidateExecutable();
  console.log(JSON.stringify({
    type: 'agent_hub_codex_candidate_executable_probe_v1',
    memoryDatabaseAccessed: false,
    modelInvocations: 0,
    ...result,
  }, null, 2));
  if (result.status !== 'ok') process.exitCode = 1;
}
