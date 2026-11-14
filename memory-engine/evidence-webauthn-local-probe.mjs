import {
  createHash, createPublicKey, randomBytes, timingSafeEqual, verify,
} from 'node:crypto';

const SHA = value => createHash('sha256').update(value).digest('hex');
const HEX40 = /^[0-9a-f]{40}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const REF = /^E~[0-9a-f]{10}$/u;
const ID = /^[A-Za-z0-9_-]{32}$/u;
const B64 = /^[A-Za-z0-9_-]+$/u;
const PROTOCOL = 'agenthub-evidence-bound-uv-v1';
const LIMIT = 16;
const TTL_MS = 300_000;

function decode(value, limit = 8192) {
  if (typeof value !== 'string' || value.length === 0
      || value.length > limit * 2 || !B64.test(value)) {
    throw new Error('probe_invalid_base64url');
  }
  const bytes = Buffer.from(value, 'base64url');
  if (!bytes.length || bytes.length > limit
      || bytes.toString('base64url') !== value) {
    throw new Error('probe_invalid_base64url');
  }
  return bytes;
}

function checkedClientData(value, { challenge, origin, type }) {
  const bytes = decode(value, 8192);
  const data = JSON.parse(bytes.toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || data.type !== type || data.origin !== origin
      || data.challenge !== challenge
      || data.crossOrigin === true || Object.hasOwn(data, 'topOrigin')) {
    throw new Error('probe_client_data_mismatch');
  }
  return bytes;
}

function meaningChallenge(meaning, nonce) {
  if (nonce.length !== 32) throw new Error('probe_nonce_invalid');
  const parts = [
    PROTOCOL, meaning.projectId, meaning.branch, meaning.revisionSha,
    meaning.proposalRef, meaning.reviewSnapshotSha256,
    meaning.canonicalFactSha256, meaning.decision,
  ];
  // Exact ReviewChallengeCore.ComputeChallenge UTF-8 wire shape:
  // JSON array, NUL byte, 32-byte random nonce, SHA-256, base64url.
  return createHash('sha256')
    .update(JSON.stringify(parts), 'utf8')
    .update(Buffer.from([0]))
    .update(nonce)
    .digest('base64url');
}

function validateMeaning(m) {
  if (!m || typeof m !== 'object'
      || !/^[A-Za-z0-9._:/~-]{1,256}$/.test(m.projectId ?? '')
      || !/^[A-Za-z0-9._:/~-]{1,128}$/.test(m.branch ?? '')
      || !HEX40.test(m.revisionSha ?? '')
      || !REF.test(m.proposalRef ?? '')
      || !HEX64.test(m.reviewSnapshotSha256 ?? '')
      || !HEX64.test(m.canonicalFactSha256 ?? '')
      || typeof m.canonicalFact !== 'string'
      || !m.canonicalFact.trim() || m.canonicalFact.length > 4000
      || SHA(m.canonicalFact) !== m.canonicalFactSha256
      || !['confirm', 'reject'].includes(m.decision)) {
    throw new TypeError('exact_real_proposal_meaning_required');
  }
}

/**
 * Ephemeral, read-only browser WebAuthn hardware probe for one real E~ proposal.
 * Enrollment is only pinned in Node process memory, not protected or trusted.
 * A malicious same-account process can enroll a software key: therefore no
 * outcome is authorization and this NEVER writes pending or approved Claims.
 */
export class EvidenceWebAuthnLocalProbe {
  #sessions = new Map();
  #now;
  #random;
  constructor({ now = () => Date.now(), random = randomBytes } = {}) {
    this.#now = now;
    this.#random = random;
  }

  #prune() {
    for (const [id, session] of this.#sessions) {
      if (this.#now() > session.expires) this.#sessions.delete(id);
    }
  }

  #require(sessionId, expectedStage) {
    this.#prune();
    if (!ID.test(sessionId ?? '')) throw new Error('probe_session_invalid');
    const session = this.#sessions.get(sessionId);
    if (!session || session.stage !== expectedStage) {
      throw new Error('probe_session_missing_or_consumed');
    }
    return session;
  }

  begin({ meaning, origin, blockers = [] } = {}) {
    validateMeaning(meaning);
    if (!/^http:\/\/localhost:\d{1,5}$/.test(origin ?? '')
        || !Array.isArray(blockers) || blockers.length > 25) {
      throw new TypeError('localhost_probe_origin_required');
    }
    this.#prune();
    if (this.#sessions.size >= LIMIT) throw new Error('probe_session_capacity');
    const sessionId = this.#random(24).toString('base64url');
    const enrollChallenge = this.#random(32).toString('base64url');
    const userId = this.#random(32).toString('base64url');
    this.#sessions.set(sessionId, {
      meaning: { ...meaning }, origin, enrollChallenge,
      stage: 'enroll', expires: this.#now() + TTL_MS,
    });
    return {
      type: 'agenthub_readonly_webauthn_evidence_probe_v1',
      sessionId, meaning, blockers,
      trustedSourceEstablished: false,
      reviewAuthorityEstablished: false,
      claimWritten: false,
      publicKey: {
        challenge: enrollChallenge,
        rp: { id: 'localhost', name: 'AgentHub Memory local read-only probe' },
        user: { id: userId, name: 'local-operator', displayName: 'Local operator' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          userVerification: 'required', residentKey: 'discouraged',
        },
        attestation: 'none',
        timeout: 90_000,
      },
    };
  }

  enroll({ sessionId, credentialId, publicKeySpki, clientDataJSON } = {}) {
    const session = this.#require(sessionId, 'enroll');
    // One attempt: fail closed even if clientData/key is malformed.
    session.stage = 'consumed';
    const client = checkedClientData(clientDataJSON, {
      challenge: session.enrollChallenge,
      origin: session.origin, type: 'webauthn.create',
    });
    if (!client.length) throw new Error('probe_enroll_invalid');
    const id = decode(credentialId, 1024);
    const publicKey = createPublicKey({
      key: decode(publicKeySpki, 1024), format: 'der', type: 'spki',
    });
    if (publicKey.asymmetricKeyType !== 'ec'
        || publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('probe_credential_must_be_es256');
    }
    session.credentialId = Buffer.from(id);
    session.publicKey = publicKey;
    session.stage = 'registered';
    return {
      status: 'ephemeral_credential_registered_only',
      persistentEnrollment: false,
      humanApprovalVerified: false,
      claimsCreated: 0,
    };
  }

  challenge({ sessionId } = {}) {
    const session = this.#require(sessionId, 'registered');
    const nonce = this.#random(32);
    const challenge = meaningChallenge(session.meaning, nonce);
    session.assertChallenge = challenge;
    session.stage = 'assertion';
    session.expires = Math.min(session.expires, this.#now() + 90_000);
    return {
      type: 'agenthub_readonly_webauthn_assertion_probe_v1',
      sessionId,
      meaning: { ...session.meaning },
      publicKey: {
        challenge, rpId: 'localhost',
        allowCredentials: [{
          type: 'public-key',
          id: session.credentialId.toString('base64url'),
        }],
        userVerification: 'required',
        timeout: 90_000,
      },
      protectedApproval: false,
    };
  }

  peekMeaning(sessionId) {
    const session = this.#require(sessionId, 'assertion');
    return { ...session.meaning };
  }

  async finish({
    sessionId, credentialId, clientDataJSON, authenticatorData,
    signature, freshMeaning,
  } = {}) {
    const session = this.#require(sessionId, 'assertion');
    session.stage = 'consumed'; // consumed BEFORE any verification
    const fail = (status) => ({
      status, browserUserVerificationObserved: false,
      protectedApproval: false, claimsCreated: 0,
      claimWritten: false, readOnly: true,
    });
    try {
      const id = decode(credentialId, 1024);
      if (id.length !== session.credentialId.length
          || !timingSafeEqual(id, session.credentialId)) {
        return fail('probe_credential_mismatch');
      }
      const client = checkedClientData(clientDataJSON, {
        challenge: session.assertChallenge, origin: session.origin,
        type: 'webauthn.get',
      });
      const auth = decode(authenticatorData, 1024);
      const sig = decode(signature, 256);
      if (auth.length !== 37
          || !timingSafeEqual(auth.subarray(0, 32), createHash('sha256')
            .update('localhost').digest())
          || (auth[32] & 0x05) !== 0x05
          || (auth[32] & 0xe2) !== 0
          || ((auth[32] & 0x10) && !(auth[32] & 0x08))) {
        return fail('probe_authenticator_flags_or_origin_invalid');
      }
      const signed = Buffer.concat([
        auth, createHash('sha256').update(client).digest(),
      ]);
      if (!verify('sha256', signed, session.publicKey, sig)) {
        return fail('probe_signature_invalid');
      }
      // Freshness is independently resolved by the caller on the server from
      // its pinned Git root and read-only E~ preflight, not by a browser flag.
      const m = session.meaning;
      if (!freshMeaning || Object.keys(m).some(k => m[k] !== freshMeaning[k])) {
        return fail('probe_evidence_changed');
      }
      return {
        status: 'browser_webauthn_uv_observed_not_approved',
        proposalRef: m.proposalRef,
        decision: m.decision,
        revisionSha: m.revisionSha,
        canonicalFactSha256: m.canonicalFactSha256,
        browserUserVerificationObserved: true,
        credentialEnrollmentTrusted: false,
        humanApprovalVerified: false,
        protectedApproval: false,
        claimWritten: false,
        claimsCreated: 0,
        readOnly: true,
      };
    } catch {
      return fail('probe_invalid_assertion');
    }
  }
}

export { meaningChallenge as computeEvidenceWebAuthnProbeChallenge };
