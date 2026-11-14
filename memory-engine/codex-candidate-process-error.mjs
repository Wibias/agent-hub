/**
 * Fail-closed subprocess error normalization.
 * Never retain Codex stdout/stderr in canonical or operational memory ledgers.
 * These labels describe observed text, not independently verified provider state.
 */
export function codexCandidateFailureCode({ stderr = '', stdout = '' } = {}) {
  const text = String(stderr ?? '') + '\n' + String(stdout ?? '');
  if (/missing optional dependency|cannot find module.*codex-win32/iu.test(text)) return 'missing_platform_dependency';
  if (/\busage limit\b|usage[_ -]?limit[_ -]?(?:reached|exceeded)/iu.test(text)) return 'usage_limit_reached_possible';
  if (/\binsufficient_quota\b|quota exceeded|out of credits/iu.test(text)) return 'insufficient_quota';
  if (/\b429\b|rate[ _-]?limit|too many requests/iu.test(text)) return 'rate_limit';
  if (/\b401\b|unauthori[sz]ed|authentication failed|invalid api key/iu.test(text)) return 'authentication';
  if (/\b403\b|permission denied|forbidden/iu.test(text)) return 'authorization';
  if (/invalid model format|model not found|unknown model|unsupported model/iu.test(text)) return 'model_configuration';
  if (/\b502\b|\b503\b|\b504\b|bad gateway|service unavailable|gateway timeout/iu.test(text)) return 'provider_unavailable';
  if (/econnreset|econnrefused|connection reset|stream disconnected/iu.test(text)) return 'connection';
  return 'unknown';
}

export function summarizeCodexCandidateProcessExit(result) {
  const exitCode = Number.isInteger(result?.code) && result.code >= 0
    ? String(result.code) : 'unknown';
  const hint = codexCandidateFailureCode(result);
  return 'codex candidate judge failed with exit ' + exitCode + ': ' + hint;
}

/** Normalize spawn exceptions without revealing their messages or paths. */
export function codexCandidateLaunchFailureCode(error) {
  if (error?.code === 'ENOENT') return 'executable_not_found';
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'permission_denied';
  if (error?.code === 'ETIMEDOUT'
    || /timed out after [0-9]+ms/u.test(String(error?.message ?? ''))) {
    return 'timeout';
  }
  return 'unknown';
}
