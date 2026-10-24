import {
  hashP14GrantPayload,
  verifyP14SignedGrant,
} from './p14-authority-enrollment-grant.mjs';

export const P14_EVIDENCE_HEAD = '43fd2adf9e73749b03283f7ae7c6e700bd383b35';
export const P14_EVIDENCE_SHA256 = '610f9f832d994e565fe6912e3aa1e25d5fe5b549fa08f1a48f477ee9b3956393';

const ACTIVATION_FLAG = 'REFERENCE_GRAPH_QUICK_RUNTIME';
const ACTIVATION_VALUE = 'graph';
const LEGACY_SOURCE = 'legacy-control';
const GRAPH_SOURCE = 'reference-graph';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function requireDate(value, name) {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError(`${name} must return a valid Date`);
  }
  return value;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function validPreState(value) {
  return exactKeys(value, [
    'production_source',
    'quick_graph_enabled',
    'repository_default_graph_enabled',
  ])
    && value.production_source === LEGACY_SOURCE
    && value.quick_graph_enabled === false
    && value.repository_default_graph_enabled === false;
}

function validConsumption(value) {
  if (!exactKeys(value, ['consumed', 'consumption_id'])) return false;
  if (value.consumed === false) return value.consumption_id === null;
  return value.consumed === true
    && typeof value.consumption_id === 'string'
    && value.consumption_id.length > 0;
}

function validChange(value, action) {
  return exactKeys(value, [action, 'change_id'])
    && value[action] === true
    && typeof value.change_id === 'string'
    && value.change_id.length > 0;
}

function validGraphProbe(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.quick?.authoritative_source === GRAPH_SOURCE
    && value.quick?.record_exact === true
    && value.quick?.pattern_exact === true
    && value.standard?.authoritative_source === LEGACY_SOURCE
    && value.deep?.authoritative_source === LEGACY_SOURCE;
}

function validLegacyProbe(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.quick?.authoritative_source === LEGACY_SOURCE
    && value.standard?.authoritative_source === LEGACY_SOURCE
    && value.deep?.authoritative_source === LEGACY_SOURCE;
}

function unsignedGrant(grant) {
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) {
    throw new TypeError('grant must be an object');
  }
  const { signature_base64: _signature, ...payload } = grant;
  return payload;
}

function baseResult() {
  return {
    status: 'blocked',
    grant_verified: false,
    activation_authorized: false,
    grant_consumed: false,
    consumption_id: null,
    activation_performed: false,
    activation_change_id: null,
    rollback_performed: false,
    rollback_verified: false,
    rollback_change_id: null,
    production_source: LEGACY_SOURCE,
    retry_requires_new_grant: false,
    request_hash: null,
    authority_hash: null,
    grant_payload_hash: null,
    blocker: null,
  };
}

function verificationResult({ verification, grantPayloadHash }) {
  return {
    ...baseResult(),
    status: verification.grantVerified ? 'authorized' : 'blocked',
    grant_verified: verification.grantVerified,
    activation_authorized: verification.activationAuthorized,
    request_hash: verification.requestHash ?? null,
    authority_hash: verification.authorityHash ?? null,
    grant_payload_hash: grantPayloadHash,
    blocker: verification.grantVerified ? null : 'grant-verification-failed',
  };
}

async function rollbackAndVerify({
  current,
  rollbackActivation,
  probeRuntime,
}) {
  let rollback;
  try {
    rollback = await rollbackActivation({
      activation_flag: ACTIVATION_FLAG,
      activation_change_id: current.activation_change_id,
      consumption_id: current.consumption_id,
      grant_nonce: current.grant_nonce,
      grant_payload_hash: current.grant_payload_hash,
    });
  } catch {
    return {
      ...current,
      status: 'rollback-unverified',
      activation_performed: false,
      rollback_performed: true,
      rollback_verified: false,
      production_source: 'unknown',
      retry_requires_new_grant: true,
      blocker: 'rollback-failed',
    };
  }

  if (!validChange(rollback, 'rolled_back')) {
    return {
      ...current,
      status: 'rollback-unverified',
      activation_performed: false,
      rollback_performed: true,
      rollback_verified: false,
      production_source: 'unknown',
      retry_requires_new_grant: true,
      blocker: 'rollback-result-invalid',
    };
  }

  let rollbackProbe;
  try {
    rollbackProbe = await probeRuntime();
  } catch {
    rollbackProbe = null;
  }
  if (!validLegacyProbe(rollbackProbe)) {
    return {
      ...current,
      status: 'rollback-unverified',
      activation_performed: false,
      rollback_performed: true,
      rollback_verified: false,
      rollback_change_id: rollback.change_id,
      production_source: 'unknown',
      retry_requires_new_grant: true,
      blocker: 'rollback-verification-failed',
    };
  }

  return {
    ...current,
    status: 'rolled-back',
    activation_performed: false,
    rollback_performed: true,
    rollback_verified: true,
    rollback_change_id: rollback.change_id,
    production_source: LEGACY_SOURCE,
    retry_requires_new_grant: true,
    blocker: 'post-activation-verification-failed',
  };
}

export async function executeP15Activation({
  p13Evidence,
  enrollmentManifest,
  grant,
  readActivationState,
  consumeGrantNonce,
  applyActivation,
  probeRuntime,
  rollbackActivation,
  now = () => new Date(),
} = {}) {
  requireFunction(readActivationState, 'readActivationState');
  requireFunction(consumeGrantNonce, 'consumeGrantNonce');
  requireFunction(applyActivation, 'applyActivation');
  requireFunction(probeRuntime, 'probeRuntime');
  requireFunction(rollbackActivation, 'rollbackActivation');
  requireFunction(now, 'now');

  let grantPayloadHash;
  try {
    grantPayloadHash = hashP14GrantPayload(unsignedGrant(grant));
  } catch {
    return { ...baseResult(), blocker: 'grant-payload-invalid' };
  }

  const firstNow = requireDate(now(), 'now');
  const firstVerification = verifyP14SignedGrant({
    p13Evidence,
    enrollmentManifest,
    grant,
    now: firstNow,
  });
  let result = verificationResult({ verification: firstVerification, grantPayloadHash });
  if (!firstVerification.grantVerified) return result;

  let preState;
  try {
    preState = await readActivationState();
  } catch {
    return { ...result, blocker: 'activation-state-unavailable' };
  }
  if (!validPreState(preState)) {
    return { ...result, status: 'blocked', blocker: 'activation-prestate-invalid' };
  }

  const consumeInput = {
    nonce: grant.nonce,
    grant_payload_hash: grantPayloadHash,
    request_hash: firstVerification.requestHash,
    authority_hash: firstVerification.authorityHash,
  };
  let consumption;
  try {
    consumption = await consumeGrantNonce(consumeInput);
  } catch {
    return { ...result, blocker: 'grant-nonce-consumption-failed' };
  }
  if (!validConsumption(consumption) || consumption.consumed !== true) {
    return { ...result, blocker: 'grant-nonce-not-consumed' };
  }

  result = {
    ...result,
    grant_consumed: true,
    consumption_id: consumption.consumption_id,
    retry_requires_new_grant: true,
  };

  const secondNow = requireDate(now(), 'now');
  const secondVerification = verifyP14SignedGrant({
    p13Evidence,
    enrollmentManifest,
    grant,
    now: secondNow,
  });
  if (!secondVerification.grantVerified) {
    return {
      ...result,
      status: 'authorized',
      grant_verified: false,
      activation_authorized: false,
      blocker: 'grant-not-valid-after-consumption',
    };
  }

  const activationInput = {
    activation_flag: ACTIVATION_FLAG,
    activation_value: ACTIVATION_VALUE,
    grant_nonce: grant.nonce,
    grant_payload_hash: grantPayloadHash,
    request_hash: secondVerification.requestHash,
    authority_hash: secondVerification.authorityHash,
    consumption_id: consumption.consumption_id,
  };

  let activation;
  try {
    activation = await applyActivation(activationInput);
  } catch {
    return rollbackAndVerify({
      current: {
        ...result,
        activation_change_id: null,
        grant_nonce: grant.nonce,
        blocker: 'activation-apply-failed',
      },
      rollbackActivation,
      probeRuntime,
    });
  }

  const current = {
    ...result,
    activation_change_id: validChange(activation, 'applied') ? activation.change_id : null,
    grant_nonce: grant.nonce,
  };
  if (!validChange(activation, 'applied')) {
    return rollbackAndVerify({
      current: { ...current, blocker: 'activation-result-invalid' },
      rollbackActivation,
      probeRuntime,
    });
  }

  let probe;
  try {
    probe = await probeRuntime();
  } catch {
    probe = null;
  }
  if (!validGraphProbe(probe)) {
    return rollbackAndVerify({
      current: { ...current, blocker: 'post-activation-verification-failed' },
      rollbackActivation,
      probeRuntime,
    });
  }

  return {
    ...current,
    status: 'activated',
    grant_verified: true,
    activation_authorized: true,
    activation_performed: true,
    rollback_performed: false,
    rollback_verified: false,
    production_source: GRAPH_SOURCE,
    retry_requires_new_grant: true,
    blocker: null,
  };
}
