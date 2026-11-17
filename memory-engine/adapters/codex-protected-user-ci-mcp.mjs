import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { resolveGitContext } from '../git-freshness.mjs';
import {
  loadGlobalMemoryScope, describeGlobalMemoryProject, samePath,
} from './codex-global-memory-scope.mjs';
import {
  DIRECT_CI_PROJECT, DIRECT_CI_BRANCH, DIRECT_CI_REVISION_FORMAT,
  requestSignedUserCi,
} from './codex-protected-direct-read-ci.mjs';

const SID = /^S-1-5-21-(?:[0-9]+-){2,}[0-9]+$/u;
const denied = status => Object.freeze({
  status, items: [], read_only: true, ci_simulation_only: true,
  trusted_for_production_recall: false, published_to_codex: false,
  physical_human_approval_verified: false,
});

export function currentWindowsAccountSid({
  exec = (args) => execFileSync('whoami', args, {
    encoding: 'utf8', windowsHide: true, timeout: 5_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
} = {}) {
  const output = String(exec(['/user', '/fo', 'csv', '/nh']));
  const sid = output.match(/S-1-5-21-(?:[0-9]+-){2,}[0-9]+/u)?.[0];
  if (!SID.test(sid ?? '')) throw new Error('ci_user_sid_unavailable');
  return sid;
}

/**
 * Deliberately separate from normal --global and --lab-protected-read.
 * Reads a SYNTHETIC CI direct Claim only. A local scope manifest is NOT
 * service authorization; server independently pins actual OS client SID
 * + fixed project/branch/revision before signing any result.
 */
export async function readScopedUserDirectCi({
  cwd, scopePath, pinPath, query, maxItems = 3,
  platform = process.platform, ciEnv = process.env,
  scopeLoader = loadGlobalMemoryScope,
  describe = describeGlobalMemoryProject,
  gitResolver = resolveGitContext,
  accountSid = currentWindowsAccountSid,
  request = requestSignedUserCi,
} = {}) {
  if (platform !== 'win32' || ciEnv.GITHUB_ACTIONS !== 'true'
      || ciEnv.RUNNER_OS !== 'Windows')
    return denied('user_direct_ci_only');
  if (typeof cwd !== 'string' || !isAbsolute(cwd)
      || typeof scopePath !== 'string' || !isAbsolute(scopePath)
      || typeof pinPath !== 'string' || !isAbsolute(pinPath))
    return denied('user_direct_ci_invalid_paths');
  if (typeof query !== 'string' || query.length < 1 || query.length > 500
      || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 10)
    return denied('invalid_tool_input');

  let current, revision, userSid;
  try {
    const scope = scopeLoader(scopePath);
    if (!scope) return denied('user_direct_ci_scope_not_configured');
    current = describe({ cwd });
    const approved = scope.projects.find(item => samePath(item.root, current.root));
    if (!approved) return denied('project_not_approved');
    if (approved.project_id !== current.project_id
      || approved.repo_identity !== current.repo_identity)
      return denied('project_identity_changed');
    revision = gitResolver({ cwd: current.root });
    userSid = accountSid();
  } catch { return denied('user_direct_ci_context_unavailable'); }

  if (current.project_id !== DIRECT_CI_PROJECT
      || revision.branch !== DIRECT_CI_BRANCH
      || !DIRECT_CI_REVISION_FORMAT.test(revision.revisionSha)
      || !SID.test(userSid))
    return denied('user_direct_ci_not_enrolled');

  try {
    const result = await request({
      pinPath, expectedSid: userSid, projectId: current.project_id,
      branch: revision.branch, revisionSha: revision.revisionSha,
      query, maxItems: Math.min(maxItems, 3),
    });
    if (result?.signed_response_verified !== true
      || result?.trusted_for_production_recall !== false
      || result?.published_to_codex !== false
      || result?.physical_human_approval_verified !== false
      || !['found_direct_ci_only', 'no_match_direct_ci_only'].includes(result.status))
      return denied('user_direct_ci_response_invalid');
    return result;
  } catch {
    // In particular NEVER fall back to canonical user-writable SQLite.
    return denied('user_direct_ci_signed_read_unverified');
  }
}
