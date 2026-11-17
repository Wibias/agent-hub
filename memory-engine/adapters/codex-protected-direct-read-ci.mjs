import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { isAbsolute } from 'node:path';

export const DIRECT_CI_PIPE = '\\\\.\\pipe\\AgentHubMemoryReviewLab-DirectReadCiV1';
export const DIRECT_CI_PROTOCOL = 'agenthub-protected-direct-read-ci-v1';
export const DIRECT_USER_CI_PIPE = '\\\\.\\pipe\\AgentHubMemoryReviewLab-UserReadCiV1';
export const DIRECT_USER_CI_PROTOCOL = 'agenthub-protected-user-read-ci-v1';
export const DIRECT_CI_PROJECT = 'github.com/example/operator-evidence';
export const DIRECT_CI_BRANCH = 'main';
export const DIRECT_CI_REVISION_FORMAT = /^[0-9a-f]{40}$/u;

const NONCE = /^[A-Za-z0-9_-]{43}$/u;
const SID = /^S-1-5-21-(?:[0-9]+-){2,}[0-9]+$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const CLAIM = /^C~[0-9a-f]{24}$/u;
const isRecord = value => value !== null && typeof value === 'object'
  && !Array.isArray(value);
const sameKeys = (value, keys) => isRecord(value)
  && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));

/**
 * Independent signed CI-only verification. This is NEVER fed into normal
 * Codex memory_recall. A service signature proves payload integrity, NOT
 * physical human consent or current repo authorization.
 */
export function verifySignedDirectCiEnvelope({
  envelope, pinnedPublicKeyPem, expectedNonce, expectedSid,
  projectId, branch, revisionSha, query, maxItems,
  expectedProtocol = DIRECT_CI_PROTOCOL,
} = {}) {
  const deny = () => { throw new Error('direct_ci_read_unverified'); };
  if (![DIRECT_CI_PROTOCOL, DIRECT_USER_CI_PROTOCOL].includes(expectedProtocol)) deny();
  if (!NONCE.test(expectedNonce ?? '') || !SID.test(expectedSid ?? '')
    || projectId !== DIRECT_CI_PROJECT || branch !== DIRECT_CI_BRANCH
    || !DIRECT_CI_REVISION_FORMAT.test(revisionSha ?? '')
    || typeof query !== 'string' || query.length < 1 || query.length > 500
    || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 3
    || typeof pinnedPublicKeyPem !== 'string'
    || !sameKeys(envelope, ['protocol', 'payload_b64', 'signature_b64'])
    || envelope.protocol !== expectedProtocol) deny();
  let payload;
  try {
    const raw = Buffer.from(envelope.payload_b64, 'base64');
    const signature = Buffer.from(envelope.signature_b64, 'base64');
    if (raw.length < 50 || raw.length > 32768
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
    || payload.protocol !== expectedProtocol
    || payload.nonce !== expectedNonce
    || payload.principal_sid !== expectedSid
    || payload.project_id !== projectId || payload.branch !== branch
    || payload.revision_sha !== revisionSha
    || payload.query !== query || payload.max_items !== maxItems
    || payload.service_signed !== true || payload.read_only !== true
    || payload.ci_simulation_only !== true
    || payload.trusted_for_production_recall !== false
    || payload.physical_human_approval_verified !== false
    || payload.published_to_codex !== false
    || !['found_direct_ci_only', 'no_match_direct_ci_only'].includes(payload.status)
    || !Array.isArray(payload.items) || payload.items.length > maxItems
    || (payload.status === 'found_direct_ci_only') !== (payload.items.length > 0))
    deny();

  const seen = new Set();
  for (const item of payload.items) {
    if (!isRecord(item) || !CLAIM.test(item.claim_id)
      || seen.has(item.claim_id)
      || item.project_id !== projectId
      || item.branch !== branch || item.revision_sha !== revisionSha
      || !SHA256.test(item.fact_sha256)
      || !SHA256.test(item.historical_evidence_sha256)
      || !['knowledge', 'preference'].includes(item.kind)
      || typeof item.value !== 'string'
      || item.value.length < 1 || item.value.length > 4000
      || !item.value.toLowerCase().includes(query.toLowerCase())
      || createHash('sha256').update(item.value).digest('hex') !== item.fact_sha256
      || item.provenance !== 'user_direct_reaffirmed_and_published_v1'
      || item.historical_source_origin !==
        'operator_pinned_unverified_evidence_v1'
      || item.historical_evidence_verified !== false
      || item.physical_human_approval_verified !== false
      || item.published_to_codex !== false)
      deny();
    seen.add(item.claim_id);
  }
  return Object.freeze({
    ...payload,
    signed_response_verified: true,
    authorized_production_memory: false,
    physical_human_approval_verified: false,
    trusted_for_production_recall: false,
  });
}

/** CI-only private host transport. Explicitly NOT a default MCP provider. */
export async function requestSignedDirectCi(args = {}) {
  return requestSignedCiTransport(args, false);
}
export async function requestSignedUserCi(args = {}) {
  return requestSignedCiTransport(args, true);
}

async function requestSignedCiTransport({
  pinPath, expectedSid, projectId = DIRECT_CI_PROJECT,
  branch = DIRECT_CI_BRANCH, revisionSha,
  query, maxItems = 3, timeoutMs = 3000,
} = {}, userMode) {
  const protocol = userMode ? DIRECT_USER_CI_PROTOCOL : DIRECT_CI_PROTOCOL;
  const pipePath = userMode ? DIRECT_USER_CI_PIPE : DIRECT_CI_PIPE;
  const operation = userMode ? 'read_user_ci' : 'read_direct_ci';
  if (process.platform !== 'win32'
    || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.RUNNER_OS !== 'Windows')
    throw new Error('direct_ci_only');
  if (typeof pinPath !== 'string' || !isAbsolute(pinPath)
    || !SID.test(expectedSid ?? '')
    || projectId !== DIRECT_CI_PROJECT || branch !== DIRECT_CI_BRANCH
    || !DIRECT_CI_REVISION_FORMAT.test(revisionSha ?? '')
    || typeof query !== 'string' || query.length < 1 || query.length > 500
    || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 3
    || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000)
    throw new Error('direct_ci_scope_invalid');

  // The CI fixture verifies this pin's owner and ACL independently.
  const pinnedPublicKeyPem = readFileSync(pinPath, 'utf8');
  const nonce = randomBytes(32).toString('base64url');
  const request = JSON.stringify({
    protocol, op: operation, nonce,
    projectId, branch, revisionSha, query, maxItems,
  }) + '\n';
  const text = await new Promise((resolve, reject) => {
    const client = createConnection(pipePath);
    let response = '';
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      client.destroy();
      reject(error);
    };
    client.setTimeout(timeoutMs, () => fail(new Error('direct_ci_pipe_timeout')));
    client.on('error', fail);
    client.on('connect', () => client.write(request));
    client.on('data', chunk => {
      if (settled) return;
      response += chunk.toString('utf8');
      if (response.length > 49152)
        return fail(new Error('direct_ci_response_too_large'));
      if (response.includes('\n')) {
        settled = true;
        client.destroy();
        resolve(response.split('\n')[0]);
      }
    });
    client.on('end', () => {
      if (!settled) fail(new Error('direct_ci_response_missing'));
    });
  });
  return verifySignedDirectCiEnvelope({
    envelope: JSON.parse(text), pinnedPublicKeyPem,
    expectedNonce: nonce, expectedSid, projectId, branch,
    revisionSha, query, maxItems,
    expectedProtocol: protocol,
  });
}
