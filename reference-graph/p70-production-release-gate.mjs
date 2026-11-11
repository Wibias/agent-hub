import { createHash, createPublicKey, verify } from 'node:crypto';
import { evaluateP62ReleaseReviewRecord } from './p62-release-review-preflight.mjs';
import { runP11RuntimeQuery } from './p11-runtime-router.mjs';

const PROJECT = 'vrznfnxzlxaavpqbzbzd';
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HOST = /^[A-Za-z0-9_.:-]{8,128}$/;
const REQS = ['schema_version','repository_sha','project_ref','operator_host_id',
  'profiles','canary_percent','not_before','expires_at','release_review','witness_sha256',
  'runtime_artifact_sha256'];
const SIGNED = ['payload_json','owner_signature_base64','reviewer_signature_base64'];
const PIN_KEYS = ['owner','reviewer','coordinator'];
function exact(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}
function iso(v) {
  if (typeof v !== 'string') return null;
  const n = Date.parse(v);
  return Number.isFinite(n) && new Date(n).toISOString() === v ? n : null;
}
function keyWithPin(pem,pin) {
  if (!HEX64.test(pin ?? '')) return null;
  try {
    const k=createPublicKey(pem);
    const sha=createHash('sha256')
      .update(k.export({type:'spki',format:'der'})).digest('hex');
    return k.asymmetricKeyType === 'ed25519' && sha === pin ? k : null;
  } catch { return null; }
}
function sigValid(key, signature, bytes) {
  if (!key || typeof signature !== 'string'
    || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return false;
  const raw=Buffer.from(signature,'base64');
  return raw.length===64 && raw.toString('base64')===signature
    && verify(null,bytes,key,raw);
}

/**
 * This verifies only signed release *claims*, not the independent origin of
 * the referenced evidence files. A P62 record by itself is non-authorizing.
 *
 * Production must pin two separately enrolled public keys in trusted runtime
 * source, never take them from the user request or release bundle itself.
 */
export function verifyP70ProductionRelease({
  envelope, ownerPem, ownerPin, reviewerPem, reviewerPin,
  expectedRepositorySha, expectedHostId, expectedRuntimeDigest, requestProfile,
  now=new Date(),
}={}) {
  const denied={authorized:false, reason:'missing-trusted-production-release'};
  try {
    if (!HEX40.test(expectedRepositorySha ?? '') || !HOST.test(expectedHostId ?? '')
      || !HEX64.test(expectedRuntimeDigest ?? '')
      || !['standard','deep'].includes(requestProfile)
      || !(now instanceof Date) || !Number.isFinite(now.valueOf())
      || !exact(envelope,SIGNED) || typeof envelope.payload_json !== 'string'
      || Buffer.byteLength(envelope.payload_json)>16_384) return denied;
    const owner=keyWithPin(ownerPem,ownerPin);
    const reviewer=keyWithPin(reviewerPem,reviewerPin);
    if (!owner || !reviewer || ownerPin===reviewerPin) return denied;
    const bytes=Buffer.from(envelope.payload_json,'utf8');
    if (!sigValid(owner,envelope.owner_signature_base64,bytes)
      || !sigValid(reviewer,envelope.reviewer_signature_base64,bytes)) return denied;
    const grant=JSON.parse(envelope.payload_json);
    if (!exact(grant,REQS)
      || grant.schema_version!=='reference-graph.p70-production-release.v1'
      || grant.repository_sha!==expectedRepositorySha
      || grant.project_ref!==PROJECT || grant.operator_host_id!==expectedHostId
      || !HEX64.test(grant.witness_sha256 ?? '')
      || grant.runtime_artifact_sha256!==expectedRuntimeDigest
      || !Array.isArray(grant.profiles) || grant.profiles.length<1
      || grant.profiles.length>2 || new Set(grant.profiles).size!==grant.profiles.length
      || grant.profiles.some(p=>!['standard','deep'].includes(p))
      || !grant.profiles.includes(requestProfile)
      || !Number.isInteger(grant.canary_percent)
      || grant.canary_percent<1 || grant.canary_percent>5) return denied;
    const start=iso(grant.not_before), end=iso(grant.expires_at);
    if (start===null || end===null || end<=start || end-start>3_600_000
      || now.valueOf()<start || now.valueOf()>=end) return denied;
    if (grant.release_review?.operator_host_id!==expectedHostId
      || grant.release_review?.repository_sha!==expectedRepositorySha
      || grant.release_review?.project_ref!==PROJECT
      || grant.release_review?.not_before!==grant.not_before
      || grant.release_review?.expires_at!==grant.expires_at
      || grant.release_review?.canary_percent!==grant.canary_percent
      || !Array.isArray(grant.release_review?.profiles)
      || JSON.stringify([...grant.release_review.profiles].sort())
        !==JSON.stringify([...grant.profiles].sort())) return denied;

    const review=evaluateP62ReleaseReviewRecord({
      record:grant.release_review,expectedRepositorySha,now,
    });
    // P62 is intentionally non-authorizing. Its valid shape must be jointly
    // signed by both independent authorities, never used as proof by itself.
    if (review.contract_valid!==true) return denied;
    return {authorized:true,reason:'two-trusted-signatures-and-scope-verified',
      repository_sha:grant.repository_sha,operator_host_id:grant.operator_host_id,
      canary_percent:grant.canary_percent,profiles:[...grant.profiles],
      expires_at:grant.expires_at,witness_sha256:grant.witness_sha256,
      runtime_artifact_sha256:grant.runtime_artifact_sha256};
  } catch { return denied; }
}

/**
 * Only trusted host-side code can call this gate. The actual P67/P68
 * candidate-built Graph runtime is invoked *only* after two independent,
 * pinned production approvals. No state or approval from P68 lab satisfies it.
 *
 * If auth is absent, return null so caller uses unchanged P69/P11 Legacy.
 * If P67 itself fails or the production coordinator is OFF, its existing
 * fail-closed Legacy result is returned. This function never mints permits.
 */
export async function runP70ApprovedProfile({
  envelope, ownerPem, ownerPin, reviewerPem, reviewerPin,
  expectedRepositorySha, expectedHostId, expectedRuntimeDigest, coordinatorPin,
  coordinatorPem, stateEndpoint, stateReadToken, stateFetchImpl,
  serviceKey, getWitness, profileFetchImpl, fetchCandidates,
  records,patterns,request,requestKey,now=new Date(),
  recordUsageEnabled=true,usageLogPath,recordUsageFn,
  factory=null,
}={}) {
  const approval=verifyP70ProductionRelease({
    envelope,ownerPem,ownerPin,reviewerPem,reviewerPin,
    expectedRepositorySha,expectedHostId,expectedRuntimeDigest,
    requestProfile:request?.profile,now,
  });
  if (!approval.authorized || !HEX64.test(coordinatorPin??'')
    || !keyWithPin(coordinatorPem,coordinatorPin)
    || coordinatorPin===ownerPin || coordinatorPin===reviewerPin
    || typeof stateEndpoint!=='string' || typeof stateReadToken!=='string'
    || typeof serviceKey!=='string' || !serviceKey.startsWith('sb_secret_')
    || typeof getWitness!=='function'
    || typeof factory!=='function') return null;
  // Separate production coordinator. The installed P68 local lab host is
  // deliberately excluded even if its signer was valid for local OFF.
  let endpoint;
  try { endpoint=new URL(stateEndpoint); } catch { return null; }
  if (endpoint.protocol!=='https:' || endpoint.hostname==='127.0.0.1'
    || endpoint.hostname==='localhost'
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname!=='/state') return null;
  let legacyControl=null;
  try {
    // The existing Windows P69 installation contains no draft P67/P68
    // libraries. Only load them AFTER separate trusted release approval.
    const effectiveFactory=factory ??
      (await import('./p68-server-host.mjs')).createP68TrustedServerHost;
    if(typeof effectiveFactory!=='function') return null;
    const runtime=effectiveFactory({
      repositorySha:expectedRepositorySha,
      trustedPublicKeyPem:coordinatorPem,
      trustedPublicKeySha256:coordinatorPin,
      stateEndpoint,stateReadToken,serviceKey,getWitness,
      legacyRunner:async args=>{
        // A failed graph attempt must not double-record local usage.
        const control=await runP11RuntimeQuery({
          ...args,...(recordUsageFn?{recordUsageFn}:{}),
        });
        legacyControl=control;
        return control;
      },
      ...(stateFetchImpl?{stateFetchImpl}:{}),
      ...(profileFetchImpl?{profileFetchImpl}:{}),
      ...(fetchCandidates?{fetchCandidates}:{}),
      clock:()=>now,
    });
    const response=await runtime.run({
      records,patterns,request,requestKey,now,recordUsageEnabled,usageLogPath,
    });
    if (response?.routing?.authoritative_source!=='reference-graph'
      && response?.routing?.authoritative_source!=='legacy-control') {
      return legacyControl;
    }
    return response;
  } catch { return legacyControl; }
}

// No production trust anchors have been enrolled. These NULL values are
// deliberate. An installation must ship a separately reviewed and pinned
// release build before this real Graph path becomes eligible.
export const P70_ENROLLED_PRODUCTION_PINS=Object.freeze({
  owner:null, reviewer:null, coordinator:null,
});
