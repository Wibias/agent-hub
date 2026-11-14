import {
  createHash, createPublicKey, randomBytes, verify,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { isAbsolute } from 'node:path';

export const OPERATOR_UV_PIPE = '\\\\.\\pipe\\AgentHubMemoryReviewLab-OperatorV1';
export const OPERATOR_UV_PROTOCOL = 'agenthub-operator-uv-service-v1';

const nonceRe = /^[A-Za-z0-9_-]{43}$/u;
const sha = /^[0-9a-f]{64}$/u;
const revision = /^[0-9a-f]{40}$/u;
const ref = /^E~[0-9a-f]{10}$/u;
const b64url = /^[A-Za-z0-9_-]+$/u;
const record = o => o !== null && typeof o === 'object' && !Array.isArray(o);

function reject() { throw new Error('operator_proof_service_unverified'); }
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Validate the exact service-signed payload bytes. No local field from
 * caller or untrusted canonical Memory SQLite substitutes for the original
 * protected LocalService meaning. A pin is only trusted if independently
 * installed Admin-owned and non-writable by the current ordinary user.
 */
export function verifyOperatorProofEnvelope({
  envelope, pinnedPublicKeyPem, expectedNonce, expectedOp,
  expectedScope = null,
} = {}) {
  if (!record(envelope) || envelope.protocol !== OPERATOR_UV_PROTOCOL
      || !nonceRe.test(expectedNonce ?? '')
      || !['begin','complete'].includes(expectedOp)
      || typeof pinnedPublicKeyPem !== 'string'
      || typeof envelope.payload_b64 !== 'string'
      || typeof envelope.signature_b64 !== 'string') reject();
  let payload;
  try {
    const bytes = Buffer.from(envelope.payload_b64, 'base64');
    const signature = Buffer.from(envelope.signature_b64, 'base64');
    if (!bytes.length || bytes.length > 12_000
        || signature.length < 64 || signature.length > 96
        || bytes.toString('base64') !== envelope.payload_b64
        || signature.toString('base64') !== envelope.signature_b64) reject();
    const key = createPublicKey(pinnedPublicKeyPem);
    if (key.asymmetricKeyType !== 'ec'
        || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
        || !verify('sha256', bytes, key, signature)) reject();
    payload = JSON.parse(bytes.toString('utf8'));
  } catch { reject(); }
  if (!record(payload) || payload.protocol !== OPERATOR_UV_PROTOCOL
      || payload.op !== expectedOp || payload.nonce !== expectedNonce
      || payload.service_signed !== true
      || payload.human_approval_verified !== false
      || payload.claim_written !== false) reject();
  if (expectedOp === 'begin') {
    const m = payload.meaning;
    if (payload.status !== 'operator_service_uv_challenge_not_approval'
        || !record(m) || !ref.test(m.proposalRef ?? '')
        || !revision.test(m.revisionSha ?? '')
        || !sha.test(m.reviewSnapshotSha256 ?? '')
        || !sha.test(m.canonicalFactSha256 ?? '')
        || !sha.test(payload.evidence_sha256 ?? '')
        || !['confirm','reject'].includes(m.decision)
        || !['knowledge','preference'].includes(payload.kind)
        || payload.source_origin !== 'operator_pinned_unverified_evidence_v1'
        || typeof m.canonicalFact !== 'string'
        || m.canonicalFact.length < 1 || m.canonicalFact.length > 4000
        || sha256(m.canonicalFact) !== m.canonicalFactSha256
        || typeof m.projectId !== 'string' || !m.projectId
        || typeof m.branch !== 'string' || !m.branch
        || typeof payload.request_id !== 'string' || !payload.request_id
        || typeof payload.ticket_id !== 'string' || !b64url.test(payload.ticket_id)
        || typeof payload.challenge !== 'string'
        || !nonceRe.test(payload.challenge)
        || !b64url.test(payload.credential_id ?? '')
        || !/^http:\/\/localhost:\d{1,5}$/.test(payload.expected_origin ?? '')
        || !Number.isFinite(Date.parse(payload.expires_utc ?? ''))
        || (expectedScope && (
          expectedScope.projectId !== m.projectId
          || expectedScope.branch !== m.branch
          || expectedScope.proposalRef !== m.proposalRef))) reject();
  } else if (typeof payload.status !== 'string'
      || typeof payload.signature_verified !== 'boolean'
      || (payload.signature_verified === true
          && payload.status !== 'operator_webauthn_uv_verified_not_approved')) reject();
  return Object.freeze({
    ...payload,
    service_signature_verified: true,
    trusted_human_approval: false,
    production_claim_authorized: false,
  });
}

async function pipeRequest({ operation, params, pinPath, pipePath, timeoutMs }) {
  if (process.platform !== 'win32'
      || typeof pinPath !== 'string' || !isAbsolute(pinPath)
      || typeof pipePath !== 'string' || !pipePath.startsWith('\\\\.\\pipe\\')
      || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000)
    throw new Error('operator_proof_platform_or_pin_invalid');
  const nonce = randomBytes(32).toString('base64url');
  const request = JSON.stringify({
    protocol: OPERATOR_UV_PROTOCOL, op: operation, nonce, ...params,
  }) + '\n';
  const pinnedPublicKeyPem = readFileSync(pinPath, 'utf8');
  const raw = await new Promise((resolve, rejectPromise) => {
    const client = createConnection(pipePath);
    let output = '';
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      client.destroy();
      rejectPromise(error);
    };
    client.setTimeout(timeoutMs, () => fail(new Error('operator_proof_pipe_timeout')));
    client.on('error', fail);
    client.on('connect', () => client.write(request));
    client.on('data', chunk => {
      if (settled) return;
      output += chunk.toString('utf8');
      if (output.length > 17_000)
        return fail(new Error('operator_proof_pipe_response_too_large'));
      if (output.includes('\n')) {
        settled = true;
        client.destroy();
        resolve(output.split('\n')[0]);
      }
    });
    client.on('end', () => {
      if (!settled) fail(new Error('operator_proof_pipe_incomplete'));
    });
  });
  return { envelope: JSON.parse(raw), pinnedPublicKeyPem, nonce };
}

export async function beginOperatorServiceWebAuthnProof({
  projectId, branch, proposalRef, pinPath,
  pipePath = OPERATOR_UV_PIPE, timeoutMs = 3000,
} = {}) {
  if (typeof projectId !== 'string' || !projectId
      || typeof branch !== 'string' || !branch
      || !ref.test(proposalRef ?? ''))
    throw new Error('operator_proof_invalid_scope');
  const response = await pipeRequest({
    operation: 'begin', params: { projectId, branch, proposalRef },
    pinPath, pipePath, timeoutMs,
  });
  return verifyOperatorProofEnvelope({
    ...response, expectedNonce: response.nonce, expectedOp: 'begin',
    expectedScope: { projectId, branch, proposalRef },
  });
}

export async function completeOperatorServiceWebAuthnProof({
  ticketId, assertion, pinPath,
  pipePath = OPERATOR_UV_PIPE, timeoutMs = 3000,
} = {}) {
  if (typeof ticketId !== 'string' || !b64url.test(ticketId)
      || !record(assertion)
      || ['credentialId','type','clientDataJSON','authenticatorData','signature']
        .some(key => typeof assertion[key] !== 'string' || !assertion[key]))
    throw new Error('operator_proof_invalid_assertion');
  const response = await pipeRequest({
    operation: 'complete', params: { ticketId, assertion },
    pinPath, pipePath, timeoutMs,
  });
  return verifyOperatorProofEnvelope({
    ...response, expectedNonce: response.nonce, expectedOp: 'complete',
  });
}
