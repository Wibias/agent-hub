/**
 * Isolated, non-deployed WebAuthn ES256 assertion verifier for Evidence-Bound
 * review. No HTTP route, key enrollment, hook, DB write, service, or permission
 * to promote Claims is provided by this module.
 *
 * The host MUST secure enrolled public keys and one-time challenges separately
 * from same-user agent-writable files before using this for real authorization.
 */
import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

export const EVIDENCE_BOUND_WEBAUTHN_POLICY = 'agenthub-evidence-bound-uv-v1';
const B64URL = /^[A-Za-z0-9_-]+$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA64 = /^[0-9a-f]{64}$/u;
const REF = /^E~[0-9a-f]{10}$/u;
const sha256 = data => createHash('sha256').update(data).digest();
const encoded = bytes => Buffer.from(bytes).toString('base64url');

function required(value, label) {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new TypeError(label + ' required');
  }
  return value;
}
function base64url(value, maxBytes, label) {
  if (typeof value !== 'string' || !B64URL.test(value)
    || value.length > Math.ceil(maxBytes * 4 / 3) + 4) {
    throw new Error(label + '_invalid');
  }
  const bytes = Buffer.from(value, 'base64url');
  if (!bytes.length || bytes.length > maxBytes || encoded(bytes) !== value) {
    throw new Error(label + '_noncanonical');
  }
  return bytes;
}
function challengeParts(input) {
  if (!input || typeof input !== 'object'
    || !required(input.projectId, 'project')
    || !required(input.branch, 'branch')
    || !SHA40.test(input.revisionSha ?? '')
    || !REF.test(input.proposalRef ?? '')
    || !SHA64.test(input.reviewSnapshotSha256 ?? '')
    || !SHA64.test(input.canonicalFactSha256 ?? '')
    || !['confirm', 'reject'].includes(input.decision)) {
    throw new TypeError('exact Evidence-Bound review context required');
  }
  return [
    EVIDENCE_BOUND_WEBAUTHN_POLICY,
    input.projectId,
    input.branch,
    input.revisionSha,
    input.proposalRef,
    input.reviewSnapshotSha256,
    input.canonicalFactSha256,
    input.decision,
  ];
}

/**
 * A freshly generated 32+ byte nonce must come from the protected host; never
 * accept nonce material from a Codex message or a model.
 * The host must persist the challenge as one-use, expiring, exact-review state.
 */
export function buildEvidenceBoundWebAuthnChallenge({
  projectId, branch, revisionSha, proposalRef, reviewSnapshotSha256,
  canonicalFactSha256, decision, nonce,
} = {}) {
  const parts = challengeParts({
    projectId, branch, revisionSha, proposalRef,
    reviewSnapshotSha256, canonicalFactSha256, decision,
  });
  if (!Buffer.isBuffer(nonce) || nonce.length < 32 || nonce.length > 64) {
    throw new TypeError('server-generated nonce with 32-64 bytes required');
  }
  const payload = Buffer.concat([
    Buffer.from(JSON.stringify(parts), 'utf8'),
    Buffer.from([0]),
    nonce,
  ]);
  return encoded(sha256(payload));
}

/**
 * Checks a single browser WebAuthn assertion against an already enrolled,
 * host-pinned P-256 credential and exact stored one-time challenge.
 * Does not itself enroll credentials, consume challenges, validate caller
 * identity, or grant final review authority.
 */
export function verifyEvidenceBoundWebAuthnAssertion({
  assertion, credentialId, credentialPublicKeyPem,
  expectedChallenge, expectedOrigin, previousSignCount = 0,
} = {}) {
  const fail = code => { throw new Error('webauthn_' + code); };
  if (!assertion || typeof assertion !== 'object'
    || typeof credentialPublicKeyPem !== 'string'
    || !Number.isSafeInteger(previousSignCount) || previousSignCount < 0) {
    fail('inputs_invalid');
  }
  const expectedId = base64url(credentialId, 1024, 'credential');
  const receivedId = base64url(assertion.id, 1024, 'credential');
  if (expectedId.length !== receivedId.length
    || !timingSafeEqual(expectedId, receivedId)) fail('credential_mismatch');
  if (assertion.type !== 'public-key') fail('credential_type');
  if (assertion.response?.userHandle != null) {
    // User-handle/account mapping is not part of this single-credential protocol.
    fail('unexpected_user_handle');
  }
  const challenge = base64url(expectedChallenge, 64, 'challenge');
  if (challenge.length !== 32) fail('challenge_length');
  const origin = new URL(required(expectedOrigin, 'expected origin'));
  // No remotely hosted RP or 127.0.0.1 ambiguity in this v1 local-only lane.
  if (origin.hostname !== 'localhost'
    || !['http:', 'https:'].includes(origin.protocol)
    || origin.pathname !== '/' || origin.search || origin.hash
    || origin.origin !== expectedOrigin) fail('origin_not_localhost');

  const clientBytes = base64url(assertion.response?.clientDataJSON, 8192, 'client_data');
  let clientData;
  try { clientData = JSON.parse(clientBytes.toString('utf8')); } catch { fail('client_json'); }
  if (!clientData || typeof clientData !== 'object' || Array.isArray(clientData)
    || clientData.type !== 'webauthn.get'
    || clientData.origin !== expectedOrigin
    || clientData.crossOrigin === true
    || clientData.topOrigin != null) fail('client_origin_or_type');
  const receivedChallenge = base64url(clientData.challenge, 64, 'client_challenge');
  if (receivedChallenge.length !== challenge.length
    || !timingSafeEqual(receivedChallenge, challenge)) fail('challenge_mismatch');

  const authenticatorData = base64url(
    assertion.response?.authenticatorData, 1024, 'authenticator_data',
  );
  // V1 deliberately rejects unsolicited extensions and attested data on get().
  if (authenticatorData.length !== 37) fail('authenticator_data_length');
  const rpHash = sha256(Buffer.from('localhost', 'utf8'));
  if (!timingSafeEqual(authenticatorData.subarray(0, 32), rpHash)) {
    fail('rp_id_hash');
  }
  const flags = authenticatorData[32];
  if ((flags & 0x01) === 0 || (flags & 0x04) === 0) {
    fail('user_presence_or_verification_missing');
  }
  if ((flags & 0xe2) !== 0 || ((flags & 0x10) !== 0 && (flags & 0x08) === 0)) {
    fail('unsupported_authenticator_flags');
  }
  const signCount = authenticatorData.readUInt32BE(33);
  if (previousSignCount !== 0 && signCount !== 0 && signCount <= previousSignCount) {
    fail('sign_counter_replay');
  }
  // A zero counter is allowed by WebAuthn; it offers NO clone/replay signal.
  const counterVerifiable = previousSignCount !== 0 && signCount !== 0;

  let key;
  try { key = createPublicKey(credentialPublicKeyPem); } catch { fail('public_key_invalid'); }
  if (key.asymmetricKeyType !== 'ec'
    || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    fail('unsupported_key');
  }
  const signature = base64url(assertion.response?.signature, 256, 'signature');
  const signedData = Buffer.concat([
    authenticatorData,
    sha256(clientBytes),
  ]);
  if (!verify('sha256', signedData, key, signature)) fail('signature_invalid');
  return {
    verified: true,
    userPresence: true,
    userVerification: true,
    signCount,
    counterVerifiable,
    approvedReviewDecision: false,
    hostCredentialProtectionVerified: false,
    challengeConsumed: false,
  };
}
