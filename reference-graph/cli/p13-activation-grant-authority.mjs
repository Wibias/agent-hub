#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  P12_BINDING_HASH,
  P12_EVIDENCE_HEAD,
  createP13GrantRequest,
  hashP13GrantRequest,
  verifyP13ActivationGrant,
} from '../p13-activation-grant-authority.mjs';
import {
  P13_PHASES,
  assertSecretFreeP13Receipt,
  createP13Receipt,
  finalizeP13Receipt,
  recordP13Phase,
} from '../p13-receipt.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const P12_EVIDENCE_PATH = resolve(ROOT, 'reference-graph/evidence/p12-activation-authority-evidence.json');
const QUERY_PATH = resolve(ROOT, 'knowledge/design-references/scripts/query.mjs');
const SCHEMA_DIR = resolve(ROOT, 'reference-graph/schema');
const PRODUCTION_AUTHORITY_PATH = resolve(ROOT, 'reference-graph/p13-production-authority.json');
const P13_SOURCE_PATHS = [
  resolve(ROOT, 'reference-graph/p13-activation-grant-authority.mjs'),
  resolve(ROOT, 'reference-graph/p13-receipt.mjs'),
  resolve(ROOT, 'reference-graph/cli/p13-activation-grant-authority.mjs'),
];
const ALLOWED_MODES = Object.freeze([
  '--plan',
  '--emit-request',
  '--verify-repository',
  '--verify-grant <grant.json> <authority.json> <trusted-authority-sha256> <now-iso>',
  '--finalize-repository <snapshot.json>',
]);

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function loadJson(path, name) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name} is not valid JSON: ${message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must contain a JSON object`);
  }
  return value;
}

function requireTimestamp(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a canonical UTC ISO timestamp`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new TypeError(`${name} must be a canonical UTC ISO timestamp`);
  }
  return value;
}

function requireGitSha(value, name) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new TypeError(`${name} must be a 40-character commit SHA`);
  }
  return value.toLowerCase();
}

function productionSource() {
  return P13_SOURCE_PATHS
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
}

function createRequestFromRepository() {
  const p12Receipt = loadJson(P12_EVIDENCE_PATH, 'P12 evidence');
  const p12EvidenceSha256 = sha256File(P12_EVIDENCE_PATH);
  const grantRequest = createP13GrantRequest({ p12Receipt, p12EvidenceSha256 });
  return { p12Receipt, p12EvidenceSha256, grantRequest };
}

function inspectRepository() {
  const { p12EvidenceSha256 } = createRequestFromRepository();
  const querySource = readFileSync(QUERY_PATH, 'utf8');
  const source = productionSource();
  const migrations = readdirSync(SCHEMA_DIR)
    .filter((name) => /^\d{3}_/.test(name));
  const queryDefaultsLegacy = /REFERENCE_GRAPH_QUICK_RUNTIME\s*\|\|\s*["']legacy["']/.test(querySource);
  const queryRequiresExactGraph = /graphMode\s*===\s*["']graph["']/.test(querySource);

  const signingApiNames = [
    ['create', 'PrivateKey'].join(''),
    ['generate', 'KeyPair'].join(''),
    ['generate', 'KeyPairSync'].join(''),
    ['si', 'gn'].join(''),
  ];
  const signingPrivateKeyPath = signingApiNames.some((name) => (
    new RegExp(`\\b${name}\\s*\\(`).test(source)
  ));
  const supabaseMarkers = [
    ['@supa', 'base/'].join(''),
    ['create', 'Client'].join(''),
    ['SUPA', 'BASE_'].join(''),
    ['reference_graph_refresh_quick_', 'runtime_projection'].join(''),
  ];
  const supabaseMutationPath = supabaseMarkers.some((marker) => source.includes(marker));

  return {
    p12_evidence_contract: true,
    p12_evidence_sha256: p12EvidenceSha256,
    repository_default_graph_enabled: !(queryDefaultsLegacy && queryRequiresExactGraph),
    migration_010_or_later_present: migrations.some((name) => Number.parseInt(name.slice(0, 3), 10) >= 10),
    production_authority_descriptor_present: existsSync(PRODUCTION_AUTHORITY_PATH),
    signing_private_key_path: signingPrivateKeyPath,
    activation_mutation_path:
      /process\.env\.REFERENCE_GRAPH_QUICK_RUNTIME\s*=/.test(source)
      || /--(?:activate|apply|deploy|set-env|sign|issue)\b/.test(source),
    supabase_mutation_path: supabaseMutationPath,
    external_trust_required:
      /trustedAuthoritySha256/.test(source)
      && /trusted_authority_match/.test(source),
    ed25519_verify_only:
      /verifySignature/.test(source)
      && !signingPrivateKeyPath,
  };
}

function planOutput() {
  return {
    mode: 'plan',
    p12_evidence_head: P12_EVIDENCE_HEAD,
    p12_binding_hash: P12_BINDING_HASH,
    profile: 'quick',
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    authority_state: 'unconfigured',
    trusted_authority_sha256: null,
    grant_state: 'not-issued',
    grant_verified: false,
    activation_authorized: false,
    activation_performed: false,
    repository_default_graph_enabled: false,
    production_source: 'legacy-control',
    allowed_modes: ALLOWED_MODES,
  };
}

function emitRequestOutput() {
  const { grantRequest } = createRequestFromRepository();
  return {
    mode: 'emit-request',
    grant_request: grantRequest,
    request_hash: hashP13GrantRequest(grantRequest),
    authority_state: 'unconfigured',
    grant_state: 'not-issued',
    activation_authorized: false,
    activation_performed: false,
    repository_default_graph_enabled: false,
    production_source: 'legacy-control',
  };
}

function verifyRepositoryOutput() {
  const { grantRequest } = createRequestFromRepository();
  const repository = inspectRepository();
  return {
    mode: 'verify-repository',
    repository,
    grant_request: grantRequest,
    request_hash: hashP13GrantRequest(grantRequest),
    authority_state: 'unconfigured',
    grant_state: 'not-issued',
    activation_authorized: false,
    activation_performed: false,
    repository_default_graph_enabled: false,
    production_source: 'legacy-control',
  };
}

function verifyGrantOutput(grantPath, authorityPath, trustedAuthoritySha256, nowIso) {
  const { grantRequest } = createRequestFromRepository();
  const grant = loadJson(resolve(grantPath), 'grant');
  const authority = loadJson(resolve(authorityPath), 'authority');
  const now = new Date(requireTimestamp(nowIso, 'now'));
  const result = verifyP13ActivationGrant({
    request: grantRequest,
    grant,
    authority,
    trustedAuthoritySha256,
    now,
  });
  return {
    mode: 'verify-grant',
    request_hash: result.requestHash,
    authority_hash: result.authorityHash,
    grant_verified: result.grantVerified,
    checks: result.checks,
    blockers: result.blockers,
    activation_authorized: false,
    activation_performed: false,
    repository_default_graph_enabled: false,
    production_source: 'legacy-control',
  };
}

function finalizeRepository(path) {
  if (!existsSync(path)) throw new Error('snapshot path does not exist');
  const snapshot = loadJson(path, 'repository snapshot');
  const gitSha = requireGitSha(snapshot.git_sha, 'git_sha');
  const verificationAt = requireTimestamp(snapshot.verification_at, 'verification_at');
  const referenceTime = requireTimestamp(snapshot.reference_time, 'reference_time');
  const { grantRequest, p12EvidenceSha256 } = createRequestFromRepository();
  const repository = inspectRepository();

  const checks = {
    p12_binding: repository.p12_evidence_contract === true,
    p12_evidence_bytes: grantRequest.p12_evidence_sha256 === p12EvidenceSha256,
    authority_requires_external_trust:
      repository.external_trust_required === true
      && repository.production_authority_descriptor_present === false,
    verifier_fail_closed:
      repository.ed25519_verify_only === true
      && repository.signing_private_key_path === false,
    repository_default_off: repository.repository_default_graph_enabled === false,
    no_activation_path:
      repository.activation_mutation_path === false
      && repository.supabase_mutation_path === false
      && repository.migration_010_or_later_present === false,
  };

  let receipt = createP13Receipt({
    grantRequest,
    gitSha,
    verificationAt,
    referenceTime,
  });
  const phaseDetails = {
    p12_binding: {
      verified: checks.p12_binding && checks.p12_evidence_bytes,
      p12_evidence_head: P12_EVIDENCE_HEAD,
      p12_binding_hash: P12_BINDING_HASH,
      p12_evidence_sha256: p12EvidenceSha256,
    },
    authority_policy: {
      verified: checks.authority_requires_external_trust,
      production_authority_enrolled: false,
    },
    grant_verifier: {
      verified: checks.verifier_fail_closed,
      algorithm: 'Ed25519',
      max_lifetime_seconds: 900,
    },
    activation_boundary: {
      verified: checks.repository_default_off && checks.no_activation_path,
      production_source: 'legacy-control',
    },
  };

  for (const phase of P13_PHASES) {
    receipt = recordP13Phase(receipt, {
      phase,
      status: phaseDetails[phase]?.verified === true ? 'success' : 'failed',
      detail: phaseDetails[phase],
    });
    if (receipt.phases[phase].status === 'failed') break;
  }
  receipt = finalizeP13Receipt(receipt, { checks });
  assertSecretFreeP13Receipt(receipt);
  return receipt;
}

function parseMode(argv) {
  if (argv.length === 1 && argv[0] === '--plan') return { mode: 'plan' };
  if (argv.length === 1 && argv[0] === '--emit-request') return { mode: 'request' };
  if (argv.length === 1 && argv[0] === '--verify-repository') return { mode: 'repository' };
  if (argv.length === 5 && argv[0] === '--verify-grant') {
    return {
      mode: 'grant',
      grantPath: argv[1],
      authorityPath: argv[2],
      trustedAuthoritySha256: argv[3],
      nowIso: argv[4],
    };
  }
  if (argv.length === 2 && argv[0] === '--finalize-repository' && argv[1]) {
    return { mode: 'finalize', path: argv[1] };
  }
  throw new Error('exactly one supported read-only mode is required');
}

try {
  const parsed = parseMode(process.argv.slice(2));
  const value = parsed.mode === 'plan'
    ? planOutput()
    : parsed.mode === 'request'
      ? emitRequestOutput()
      : parsed.mode === 'repository'
        ? verifyRepositoryOutput()
        : parsed.mode === 'grant'
          ? verifyGrantOutput(
            parsed.grantPath,
            parsed.authorityPath,
            parsed.trustedAuthoritySha256,
            parsed.nowIso,
          )
          : finalizeRepository(parsed.path);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`P13 grant authority error: ${message}\n`);
  process.exitCode = 1;
}
