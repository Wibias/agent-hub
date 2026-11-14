import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { isAbsolute } from 'node:path';
import { resolveGitContext } from '../git-freshness.mjs';
import {
  loadGlobalMemoryScope, describeGlobalMemoryProject, samePath,
} from './codex-global-memory-scope.mjs';

export const PROTECTED_LAB_PIPE = '\\\\.\\pipe\\AgentHubMemoryReviewLab-ReadV1';
export const PROTECTED_LAB_PROTOCOL = 'agenthub-protected-lab-read-v1';
export const PROTECTED_LAB_PROJECT = 'github.com/example/lab-fixture';
export const PROTECTED_LAB_BRANCH = 'main';

const SHA256 = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const CLAIM_REF = /^C~[0-9a-f]{24}$/u;
const NONCE = /^[A-Za-z0-9_-]{43}$/u;
const ALLOWED_STATUS = new Set(['found_lab_only', 'no_match_lab_only']);
const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);

/**
 * Verify the service-signed raw payload, not reconstructed JSON. The pin file
 * MUST be installed with an Administrator-owned ACL denying user writes.
 * Passing an agent-selected pin or trusting a key returned by the pipe would
 * defeat origin authentication.
 *
 * Every Claim is deliberately a synthetic fixture, never human approved.
 */
export function verifyProtectedLabReadEnvelope({
  envelope, pinnedPublicKeyPem, expectedNonce, projectId, branch,
} = {}) {
  const deny = () => { throw new Error('protected_read_unverified'); };
  if (!NONCE.test(expectedNonce ?? '')
      || projectId !== PROTECTED_LAB_PROJECT || branch !== PROTECTED_LAB_BRANCH
      || !isRecord(envelope) || envelope.protocol !== PROTECTED_LAB_PROTOCOL
      || typeof envelope.payload_b64 !== 'string'
      || typeof envelope.signature_b64 !== 'string'
      || typeof pinnedPublicKeyPem !== 'string') deny();
  let raw, signature, payload;
  try {
    raw = Buffer.from(envelope.payload_b64, 'base64');
    signature = Buffer.from(envelope.signature_b64, 'base64');
    if (raw.length === 0 || raw.length > 12_000
        || signature.length < 64 || signature.length > 96
        || raw.toString('base64') !== envelope.payload_b64
        || signature.toString('base64') !== envelope.signature_b64) deny();
    const key = createPublicKey(pinnedPublicKeyPem);
    if (key.asymmetricKeyType !== 'ec'
        || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
        || !verify('sha256', raw, key, signature)) deny();
    payload = JSON.parse(raw.toString('utf8'));
  } catch { deny(); }
  if (!isRecord(payload)
      || payload.protocol !== PROTECTED_LAB_PROTOCOL
      || payload.nonce !== expectedNonce
      || payload.project_id !== projectId
      || payload.branch !== branch
      || !ALLOWED_STATUS.has(payload.status)
      || payload.read_only !== true
      || payload.service_signed !== true
      || payload.human_approval_verified !== false
      || !Array.isArray(payload.items)
      || payload.items.length > 10
      || (payload.status === 'found_lab_only') !== (payload.items.length > 0)) deny();
  const seen = new Set();
  for (const item of payload.items) {
    if (!isRecord(item)
        || !CLAIM_REF.test(item.claim_id)
        || seen.has(item.claim_id)
        || item.project_id !== projectId
        || item.branch !== branch
        || !REVISION.test(item.revision_sha)
        || !SHA256.test(item.fact_sha256)
        || !SHA256.test(item.evidence_sha256)
        || !['knowledge', 'preference'].includes(item.kind)
        || typeof item.value !== 'string'
        || item.value.length < 1 || item.value.length > 4000
        || createHash('sha256').update(item.value, 'utf8').digest('hex') !== item.fact_sha256
        || item.provenance !== 'synthetic_disposable_lab'
        || item.human_approval_verified !== false) deny();
    seen.add(item.claim_id);
  }
  return Object.freeze({
    ...payload,
    signed_response_verified: true,
    real_human_approval_verified: false,
    trusted_for_production_recall: false,
  });
}

/** One bounded request to the disposable Windows SCM host. */
export async function requestProtectedLabClaims({
  projectId, branch, query, maxItems = 5, pinPath,
  pipePath = PROTECTED_LAB_PIPE, timeoutMs = 2500,
} = {}) {
  if (process.platform !== 'win32')
    return { status: 'unsupported_platform', items: [], read_only: true };
  if (projectId !== PROTECTED_LAB_PROJECT || branch !== PROTECTED_LAB_BRANCH
      || typeof query !== 'string' || query.length < 1 || query.length > 500
      || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 10
      || typeof pinPath !== 'string' || !isAbsolute(pinPath)
      || typeof pipePath !== 'string' || !pipePath.startsWith('\\\\.\\pipe\\')
      || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) {
    throw new Error('protected_lab_input_invalid');
  }
  const pinnedPublicKeyPem = readFileSync(pinPath, 'utf8');
  const nonce = randomBytes(32).toString('base64url');
  const request = JSON.stringify({
    protocol: PROTECTED_LAB_PROTOCOL, op: 'recall', nonce,
    projectId, branch, query, maxItems,
  }) + '\n';
  const text = await new Promise((resolve, reject) => {
    const client = createConnection(pipePath);
    let output = '';
    const fail = (error) => { client.destroy(); reject(error); };
    client.setTimeout(timeoutMs, () => fail(new Error('protected_pipe_timeout')));
    client.on('error', fail);
    client.on('connect', () => client.write(request));
    client.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.length > 16_384) return fail(new Error('protected_pipe_too_large'));
      if (output.includes('\n')) { client.destroy(); resolve(output.split('\n')[0]); }
    });
    client.on('end', () => {
      if (!output.includes('\n')) reject(new Error('protected_pipe_incomplete'));
    });
  });
  return verifyProtectedLabReadEnvelope({
    envelope: JSON.parse(text), pinnedPublicKeyPem, expectedNonce: nonce,
    projectId, branch,
  });
}

/**
 * An explicitly opt-in lab-only implementation of the EXISTING memory_recall
 * tool. The global Codex project scope is still resolved from the actual
 * process CWD, never MCP tool input. No canonical SQLite fallback on errors.
 *
 * A signed synthetic result is not a human-approved Memory Claim and MUST
 * NOT enter production recall or automatic decision-making.
 */
export async function readScopedProtectedLabMemory({
  cwd, scopePath, pinPath, query, maxItems = 5,
  describe = describeGlobalMemoryProject,
  scopeLoader = loadGlobalMemoryScope,
  gitResolver = resolveGitContext,
  request = requestProtectedLabClaims,
} = {}) {
  const denied = (status) => Object.freeze({
    status, items: [], read_only: true,
    real_human_approval_verified: false,
    trusted_for_production_recall: false,
  });
  if (typeof cwd !== 'string' || !isAbsolute(cwd)
      || typeof scopePath !== 'string' || !isAbsolute(scopePath)
      || typeof pinPath !== 'string' || !isAbsolute(pinPath))
    return denied('protected_lab_invalid_scope');
  if (typeof query !== 'string' || query.length < 1 || query.length > 500
      || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 10)
    return denied('invalid_tool_input');

  let manifest, current, git;
  try {
    manifest = scopeLoader(scopePath);
    if (!manifest) return denied('scope_not_configured');
    current = describe({ cwd });
    const enrolled = manifest.projects.find(p => samePath(p.root, current.root));
    if (!enrolled) return denied('project_not_approved');
    if (current.project_id !== enrolled.project_id
        || current.repo_identity !== enrolled.repo_identity)
      return denied('project_identity_changed');
    git = gitResolver({ cwd: current.root });
  } catch { return denied('project_context_unavailable'); }
  if (current.project_id !== PROTECTED_LAB_PROJECT
      || git.branch !== PROTECTED_LAB_BRANCH)
    return denied('protected_lab_scope_not_enrolled');
  try {
    return await request({
      projectId: current.project_id, branch: git.branch,
      query, maxItems, pinPath,
    });
  } catch {
    return denied('protected_lab_read_unverified');
  }
}
