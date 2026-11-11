import {
  createP67HttpsStateReader, createP67ServerProfileAdapter,
} from './p67-server-profile-adapter.mjs';

/**
 * Explicit trusted-server-host wiring for a P68 HTTPS state coordinator.
 * Never imported by the public P11/query CLI. No service can start from env.
 * All secrets, trust anchors and candidate transport are host-provisioned.
 */
export function createP68TrustedServerHost({
  repositorySha, trustedPublicKeyPem, trustedPublicKeySha256,
  stateEndpoint, stateReadToken, stateFetchImpl,
  serviceKey, getWitness, profileFetchImpl,
  fetchCandidates, legacyRunner, graphOutput, clock,
  timeoutMs, statePollMs, maxCanaryPercent,
} = {}) {
  const readSharedState = createP67HttpsStateReader({
    endpoint: stateEndpoint, readToken: stateReadToken,
    ...(stateFetchImpl ? { fetchImpl: stateFetchImpl } : {}),
  });
  return createP67ServerProfileAdapter({
    repositorySha, trustedPublicKeyPem, trustedPublicKeySha256,
    readSharedState, serviceKey, getWitness,
    ...(profileFetchImpl ? { fetchImpl: profileFetchImpl } : {}),
    ...(fetchCandidates ? { fetchCandidates } : {}),
    ...(legacyRunner ? { legacyRunner } : {}),
    ...(graphOutput ? { graphOutput } : {}),
    ...(clock ? { clock } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(statePollMs ? { statePollMs } : {}),
    ...(maxCanaryPercent ? { maxCanaryPercent } : {}),
  });
}
