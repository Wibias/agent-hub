import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';
const MAX_BODY = 256 * 1024;
const REPO = /^github\.com\/[a-z0-9][a-z0-9_.-]{0,99}\/[a-z0-9][a-z0-9_.-]{0,99}$/u;
const SHA = /^[a-f0-9]{40}$/u;

async function getJson(path, fetchImpl, signal) {
  const response = await fetchImpl(API + path, {
    method: 'GET', redirect: 'error', signal,
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'AgentHub-scope-observation',
      'x-github-api-version': '2022-11-28', 'cache-control': 'no-cache' },
  });
  if (response.status !== 200 || response.redirected || !response.body) {
    await response.body?.cancel();
    throw new Error('remote_scope_response_unavailable');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let length = 0;
  let raw = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY) throw new Error('remote_scope_response_too_large');
      raw += decoder.decode(value, { stream: true });
    }
    return JSON.parse(raw + decoder.decode());
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/** Observes a public remote ref without attesting the host or local checkout. */
export async function observePublicRepositoryScope({ projectId, repositoryId, branch, revisionSha,
  fetchImpl = fetch } = {}) {
  if (typeof projectId !== 'string' || !REPO.test(projectId)
    || projectId.split('/').slice(1).some(s => s === '.' || s === '..')
    || !Number.isSafeInteger(repositoryId) || repositoryId <= 0
    || typeof branch !== 'string' || branch.length > 128
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch)
    || branch.includes('..') || branch.endsWith('.') || branch.split('/').some(s => !s || s.startsWith('.') || /\.lock$/i.test(s))
    || typeof revisionSha !== 'string' || !SHA.test(revisionSha)) {
    throw new TypeError('exact public repository ID, scope and revision required');
  }
  const name = projectId.slice('github.com/'.length);
  const base = '/repos/' + name;
  const signal = AbortSignal.timeout(12000);
  const requireRepo = repo => {
    if (repo?.id !== repositoryId || typeof repo.full_name !== 'string'
      || repo.full_name.toLowerCase() !== name || repo.private !== false
      || repo.visibility !== 'public') throw new Error('remote_repository_identity_mismatch');
  };
  requireRepo(await getJson(base, fetchImpl, signal));
  const ref = await getJson(base + '/git/ref/heads/' + branch.split('/').map(encodeURIComponent).join('/'), fetchImpl, signal);
  if (ref?.ref !== 'refs/heads/' + branch || ref.object?.type !== 'commit'
    || typeof ref.object.sha !== 'string' || !SHA.test(ref.object.sha)) {
    throw new Error('remote_branch_identity_invalid');
  }
  requireRepo(await getJson(base, fetchImpl, signal));
  return {
    status: ref.object.sha === revisionSha ? 'observed_remote_head_matches' : 'observed_remote_head_differs',
    projectId, repositoryId, branch, revisionSha, observedHeadSha: ref.object.sha,
    observedAtUtc: new Date().toISOString(),
    canonicalScopeVerified: false, localCheckoutVerified: false, claimAuthorized: false,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const [projectId, id, branch, revisionSha, ...extra] = process.argv.slice(2);
    if (extra.length || !/^[1-9][0-9]*$/u.test(id ?? '')) throw new Error('invalid arguments');
    const report = await observePublicRepositoryScope({ projectId, repositoryId: Number(id), branch, revisionSha });
    console.log(JSON.stringify(report));
    if (report.status !== 'observed_remote_head_matches') process.exitCode = 2;
  } catch {
    console.error('remote_scope_observation_denied');
    process.exitCode = 2;
  }
}
