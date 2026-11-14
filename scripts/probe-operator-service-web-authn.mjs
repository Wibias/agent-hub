#!/usr/bin/env node
/**
 * Windows GitHub Actions disposable-service E2E only. A real Browser /
 * Windows Hello supplies the ES256 signature in actual deployment.
 * Here the private key is a GENERATED SOFTWARE TEST KEY, used to assert
 * the exact service challenge transport and protected SQLite read/write.
 */
import { createHash, randomBytes, sign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import {
  beginOperatorServiceWebAuthnProof,
  completeOperatorServiceWebAuthnProof,
} from '../memory-engine/adapters/operator-webauthn-probe-pipe.mjs';

const pinPath = process.argv[2];
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.RUNNER_OS !== 'Windows' || process.argv.length !== 3
    || typeof pinPath !== 'string' || !isAbsolute(pinPath)) {
  process.stderr.write('Disposable Windows SCM operator UV probe only.\n');
  process.exit(2);
}
const privatePath = join(process.env.RUNNER_TEMP ?? '',
  'AgentHubMemoryReviewLab-TestOperatorPrivateKey.pem');
if (!existsSync(privatePath)) {
  process.stderr.write('Synthetic CI operator fixture key unavailable.\n');
  process.exit(2);
}
const projectId = 'github.com/example/operator-evidence';
const branch = 'main';
const proposalRef = 'E~' + createHash('sha256')
  .update('actual-canonical-evidence-proposal-id').digest('hex').slice(0, 10);
const expectedFact =
  'This real-schema E~ proposal has linked Evidence but no human approval.';
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForOffer() {
  for (let attempt = 0; attempt < 16; attempt++) {
    try {
      return await beginOperatorServiceWebAuthnProof({
        projectId, branch, proposalRef, pinPath, timeoutMs: 3000,
      });
    } catch (error) {
      if (attempt === 15) throw error;
      await sleep(180);
    }
  }
  throw new Error('operator_service_offer_missing');
}

function signedAssertion(offer, counter) {
  const client = Buffer.from(JSON.stringify({
    type: 'webauthn.get', challenge: offer.challenge,
    origin: offer.expected_origin, crossOrigin: false,
  }), 'utf8');
  const auth = Buffer.alloc(37);
  createHash('sha256').update('localhost').digest().copy(auth);
  auth[32] = 0x05;
  auth.writeUInt32BE(counter, 33);
  const signedBytes = Buffer.concat([
    auth, createHash('sha256').update(client).digest(),
  ]);
  const privateKey = readFileSync(privatePath, 'utf8');
  return {
    credentialId: offer.credential_id,
    type: 'public-key',
    clientDataJSON: b64(client),
    authenticatorData: b64(auth),
    signature: b64(sign('sha256', signedBytes, privateKey)),
  };
}

try {
  const begin = await waitForOffer();
  if (!begin.service_signature_verified || begin.human_approval_verified
      || begin.claim_written || begin.trusted_human_approval
      || begin.production_claim_authorized
      || begin.meaning?.canonicalFact !== expectedFact
      || begin.meaning.projectId !== projectId
      || begin.meaning.branch !== branch
      || begin.meaning.proposalRef !== proposalRef
      || begin.meaning.decision !== 'confirm') {
    throw new Error('signed protected offer meaning or authority invalid');
  }
  const complete = await completeOperatorServiceWebAuthnProof({
    ticketId: begin.ticket_id, pinPath,
    assertion: signedAssertion(begin, 1),
  });
  if (!complete.service_signature_verified
      || complete.status !== 'operator_webauthn_uv_verified_not_approved'
      || complete.signature_verified !== true
      || complete.human_approval_verified || complete.claim_written
      || complete.trusted_human_approval || complete.production_claim_authorized) {
    throw new Error('protected service operator UV response invalid');
  }

  // New valid one-time challenge signed with the SAME nonzero hardware-like
  // counter must fail after the service persisted counter=1 in SQLite.
  const second = await waitForOffer();
  const denied = await completeOperatorServiceWebAuthnProof({
    ticketId: second.ticket_id, pinPath,
    assertion: signedAssertion(second, 1),
  });
  if (!denied.service_signature_verified || denied.signature_verified
      || denied.status !== 'operator_proof_scope_or_counter_denied'
      || denied.human_approval_verified || denied.claim_written) {
    throw new Error('protected service accepted replayed signing counter');
  }
  process.stdout.write(JSON.stringify({
    status: 'operator_real_E_source_uv_service_bridge_test_pass',
    exact_service_signed_fact_verified: true,
    service_generated_challenge_verified: true,
    protected_operator_credential_counter_persisted: true,
    stale_nonzero_counter_denied: true,
    human_approval_verified: false,
    claim_written: false,
    production_no_go: true,
  }) + '\n');
} catch (error) {
  process.stderr.write('Protected operator service UV E2E unavailable: '
    + String(error?.message ?? 'unknown') + '\n');
  process.exitCode = 2;
}
