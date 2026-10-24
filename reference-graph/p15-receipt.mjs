import {
  P14_EVIDENCE_HEAD,
  P14_EVIDENCE_SHA256,
  executeP15Activation,
} from './p15-activation-executor.mjs';

const CREDENTIAL_KEY_RE = /^(?:authorization|password|access[_-]?token|bearer[_-]?token|secret(?:[_-]?key)?|private[_-]?key|signing[_-]?key|jwt|(?:.*[_-])?service[_-]?role(?:[_-](?:api[_-]?)?)?(?:key|secret|password|token))$/i;
const EXECUTION_KEYS = Object.freeze([
  'applyActivation',
  'consumeGrantNonce',
  'enrollmentManifest',
  'grant',
  'now',
  'p13Evidence',
  'probeRuntime',
  'readActivationState',
  'rollbackActivation',
]);

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function requireGitSha(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new TypeError('gitSha must be a 40-character commit SHA');
  }
  return value.toLowerCase();
}

function requireIso(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a canonical UTC ISO timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new TypeError(`${name} must be a canonical UTC ISO timestamp`);
  }
  return value;
}

function scanCredentialKeys(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanCredentialKeys(entry, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (CREDENTIAL_KEY_RE.test(key)) {
      throw new Error(`private, signing, credential, or secret field is forbidden in P15 receipt: ${[...path, key].join('.')}`);
    }
    scanCredentialKeys(entry, [...path, key]);
  }
}

function receiptState(result) {
  if (result.status === 'activated'
      && result.grant_verified === true
      && result.activation_authorized === true
      && result.grant_consumed === true
      && result.activation_performed === true
      && result.production_source === 'reference-graph') {
    return 'activated';
  }
  if (result.status === 'rolled-back'
      && result.grant_consumed === true
      && result.rollback_performed === true
      && result.rollback_verified === true
      && result.production_source === 'legacy-control') {
    return 'rolled-back';
  }
  if (result.status === 'authorized'
      && result.grant_verified === true
      && result.activation_authorized === true
      && result.activation_performed === false) {
    return 'authorized';
  }
  return 'blocked';
}

export function createP15Receipt({ gitSha, verificationAt } = {}) {
  return {
    schema_version: 'reference-graph.p15-activation-executor.v1',
    p14_evidence_head: P14_EVIDENCE_HEAD,
    p14_evidence_sha256: P14_EVIDENCE_SHA256,
    git_sha: requireGitSha(gitSha),
    verification_at: requireIso(verificationAt, 'verificationAt'),
    state: 'blocked',
    grant_state: 'not-issued',
    grant_verified: false,
    grant_consumed: false,
    consumption_id: null,
    activation_authorized: false,
    activation_performed: false,
    activation_change_id: null,
    rollback_performed: false,
    rollback_verified: false,
    rollback_change_id: null,
    retry_requires_new_grant: false,
    repository_default_graph_enabled: false,
    production_source: 'legacy-control',
    request_hash: null,
    authority_hash: null,
    grant_payload_hash: null,
    external_blocker: 'production-ed25519-authority-and-grant-not-provided',
    blockers: [],
    enrollment_manifest: null,
    grant: null,
  };
}

export async function finalizeP15Receipt(receipt, options = {}) {
  const base = requireObject(receipt, 'receipt');
  const value = requireObject(options, 'P15 finalization options');
  const optionKeys = Object.keys(value);
  if (optionKeys.length === 0) return structuredClone(base);
  if (!hasExactKeys(value, ['execution'])) {
    throw new Error('P15 finalization accepts exactly one execution artifact object and never caller activation claims');
  }
  if (!hasExactKeys(value.execution, EXECUTION_KEYS)) {
    throw new Error('P15 execution artifacts must contain the exact ceremony and actuator fields');
  }

  const executionResult = await executeP15Activation(value.execution);
  const state = receiptState(executionResult);
  const next = structuredClone(base);
  next.state = state;
  next.grant_state = executionResult.grant_verified === true || executionResult.grant_consumed === true
    ? 'issued'
    : 'not-issued';
  next.grant_verified = executionResult.grant_verified === true;
  next.grant_consumed = executionResult.grant_consumed === true;
  next.consumption_id = executionResult.consumption_id ?? null;
  next.activation_authorized = executionResult.activation_authorized === true;
  next.activation_performed = state === 'activated';
  next.activation_change_id = executionResult.activation_change_id ?? null;
  next.rollback_performed = executionResult.rollback_performed === true;
  next.rollback_verified = executionResult.rollback_verified === true;
  next.rollback_change_id = executionResult.rollback_change_id ?? null;
  next.retry_requires_new_grant = executionResult.retry_requires_new_grant === true;
  next.repository_default_graph_enabled = false;
  next.production_source = executionResult.production_source;
  next.request_hash = executionResult.request_hash ?? null;
  next.authority_hash = executionResult.authority_hash ?? null;
  next.grant_payload_hash = executionResult.grant_payload_hash ?? null;
  next.enrollment_manifest = null;
  next.grant = null;

  const safeTerminal = state === 'activated' || state === 'rolled-back';
  next.external_blocker = safeTerminal ? null : (executionResult.blocker ?? 'P15 execution did not reach a safe terminal state');
  next.blockers = executionResult.blocker && !safeTerminal ? [executionResult.blocker] : [];

  assertSecretFreeP15Receipt(next);
  return next;
}

export function assertSecretFreeP15Receipt(receipt, secrets = []) {
  scanCredentialKeys(receipt);
  const serialized = JSON.stringify(receipt);
  for (const secret of Array.isArray(secrets) ? secrets : [secrets]) {
    if (typeof secret === 'string' && secret.length > 0 && serialized.includes(secret)) {
      throw new Error('secret material is forbidden in P15 receipt');
    }
  }
  return true;
}
