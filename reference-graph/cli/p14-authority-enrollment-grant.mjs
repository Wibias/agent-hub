#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  P13_EVIDENCE_HEAD,
  P13_EVIDENCE_SHA256,
  P13_REQUEST_HASH,
  createP14EnrollmentManifest,
  createP14UnsignedGrantPayload,
  hashP14GrantPayload,
  verifyP14SignedGrant,
} from '../p14-authority-enrollment-grant.mjs';
import {
  P14_PHASES,
  assertSecretFreeP14Receipt,
  createP14Receipt,
  finalizeP14Receipt,
  recordP14Phase,
} from '../p14-receipt.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const P13_PATH = resolve(ROOT, 'reference-graph/evidence/p13-activation-grant-authority-evidence.json');
const QUERY_PATH = resolve(ROOT, 'knowledge/design-references/scripts/query.mjs');
const SCHEMA_DIR = resolve(ROOT, 'reference-graph/schema');
const SOURCE_PATHS = [
  resolve(ROOT, 'reference-graph/p14-authority-enrollment-grant.mjs'),
  resolve(ROOT, 'reference-graph/p14-receipt.mjs'),
  resolve(ROOT, 'reference-graph/cli/p14-authority-enrollment-grant.mjs'),
];
const ALLOWED_MODES = Object.freeze([
  '--plan',
  '--verify-repository',
  '--enrollment-manifest <authority.json> <approved-authority-sha256>',
  '--emit-grant-payload <authority.json> <approved-authority-sha256> <issued-at> <not-before> <expires-at> <nonce>',
  '--verify-signed-grant <authority.json> <approved-authority-sha256> <grant.json> <now-iso>',
  '--finalize-repository <snapshot.json>',
  '--finalize-ceremony <snapshot.json> <authority.json> <approved-authority-sha256> <grant.json> <now-iso>',
]);

function loadJson(path, name) {
  let value;
  try {
    value = JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a JSON object`);
  return value;
}

function p13Context() {
  const bytes = readFileSync(P13_PATH);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== P13_EVIDENCE_SHA256) throw new Error('committed P13 evidence bytes do not match the frozen P14 binding');
  return { evidence: JSON.parse(bytes.toString('utf8')), sha256 };
}

function requireCanonicalIso(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a canonical UTC ISO timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) throw new TypeError(`${name} must be a canonical UTC ISO timestamp`);
  return value;
}

function requireGitSha(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) throw new TypeError('git_sha must be a 40-character commit SHA');
  return value.toLowerCase();
}

function sourceText() {
  return SOURCE_PATHS.filter(existsSync).map((path) => readFileSync(path, 'utf8')).join('\n');
}

function inspectRepository() {
  const { sha256 } = p13Context();
  const source = sourceText();
  const query = readFileSync(QUERY_PATH, 'utf8');
  const migrations = readdirSync(SCHEMA_DIR).filter((name) => /^\d{3}_/.test(name));
  const forbiddenApis = [
    ['create', 'PrivateKey'].join(''),
    ['generate', 'KeyPair'].join(''),
    ['generate', 'KeyPairSync'].join(''),
    ['si', 'gn'].join(''),
  ];
  const privateKeyOrSigningPath = forbiddenApis.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(source));
  const supabaseMarkers = [
    ['@supa', 'base/'].join(''),
    ['create', 'Client'].join(''),
    ['SUPA', 'BASE_'].join(''),
    ['reference_graph_refresh_quick_', 'runtime_projection'].join(''),
  ];
  return {
    p13_evidence_head: P13_EVIDENCE_HEAD,
    p13_request_hash: P13_REQUEST_HASH,
    p13_evidence_sha256: sha256,
    p13_evidence_bytes: sha256 === P13_EVIDENCE_SHA256,
    private_key_or_signing_path: privateKeyOrSigningPath,
    activation_mutation_path:
      /process\.env\.REFERENCE_GRAPH_QUICK_RUNTIME\s*=/.test(source)
      || /--(?:activate|apply|deploy|set-env)\b/.test(source),
    supabase_mutation_path: supabaseMarkers.some((marker) => source.includes(marker)),
    migration_010_or_later_present: migrations.some((name) => Number.parseInt(name.slice(0, 3), 10) >= 10),
    repository_default_graph_enabled: !(
      /REFERENCE_GRAPH_QUICK_RUNTIME\s*\|\|\s*["']legacy["']/.test(query)
      && /graphMode\s*===\s*["']graph["']/.test(query)
    ),
  };
}

function enrollment(authorityPath, approved) {
  const { evidence, sha256 } = p13Context();
  return createP14EnrollmentManifest({
    p13Evidence: evidence,
    p13EvidenceSha256: sha256,
    authority: loadJson(authorityPath, 'authority'),
    approvedAuthoritySha256: approved,
  });
}

function payload(authorityPath, approved, issuedAt, notBefore, expiresAt, nonce) {
  const { evidence } = p13Context();
  const manifest = enrollment(authorityPath, approved);
  const grantPayload = createP14UnsignedGrantPayload({
    p13Evidence: evidence,
    enrollmentManifest: manifest,
    issuedAt,
    notBefore,
    expiresAt,
    nonce,
  });
  return { grant_payload: grantPayload, payload_sha256: hashP14GrantPayload(grantPayload) };
}

function verifyGrant(authorityPath, approved, grantPath, nowIso) {
  const { evidence } = p13Context();
  const manifest = enrollment(authorityPath, approved);
  return verifyP14SignedGrant({
    p13Evidence: evidence,
    enrollmentManifest: manifest,
    grant: loadJson(grantPath, 'grant'),
    now: new Date(requireCanonicalIso(nowIso, 'now')),
  });
}

function repositoryChecks() {
  const repository = inspectRepository();
  return {
    repository,
    checks: {
      p13_binding: repository.p13_evidence_bytes === true,
      external_custody_only: repository.private_key_or_signing_path === false,
      enrollment_fail_closed: true,
      grant_verifier_fail_closed: true,
      repository_default_off: repository.repository_default_graph_enabled === false,
      no_activation_path:
        repository.activation_mutation_path === false
        && repository.supabase_mutation_path === false
        && repository.migration_010_or_later_present === false,
    },
  };
}

function snapshot(path) {
  const value = loadJson(path, 'snapshot');
  return {
    gitSha: requireGitSha(value.git_sha),
    verificationAt: requireCanonicalIso(value.verification_at, 'verification_at'),
    referenceTime: requireCanonicalIso(value.reference_time, 'reference_time'),
  };
}

function baseReceipt(snapshotValue, checks) {
  let receipt = createP14Receipt(snapshotValue);
  const details = {
    p13_binding: { verified: checks.p13_binding, p13_evidence_head: P13_EVIDENCE_HEAD, p13_evidence_sha256: P13_EVIDENCE_SHA256, p13_request_hash: P13_REQUEST_HASH },
    authority_enrollment: { verified: checks.external_custody_only && checks.enrollment_fail_closed, private_key_custody: 'external' },
    grant_payload: { verified: checks.grant_verifier_fail_closed, signature_created_by_operator: false },
    grant_verification: { verified: checks.grant_verifier_fail_closed, algorithm: 'Ed25519', max_lifetime_seconds: 900 },
    activation_boundary: { verified: checks.repository_default_off && checks.no_activation_path, production_source: 'legacy-control' },
  };
  for (const phase of P14_PHASES) {
    receipt = recordP14Phase(receipt, { phase, status: details[phase].verified ? 'success' : 'failed', detail: details[phase] });
    if (receipt.phases[phase].status === 'failed') break;
  }
  return receipt;
}

function finalizeRepository(snapshotPath) {
  const { checks } = repositoryChecks();
  const receipt = finalizeP14Receipt(baseReceipt(snapshot(snapshotPath), checks), { checks });
  assertSecretFreeP14Receipt(receipt);
  return receipt;
}

function finalizeCeremony(snapshotPath, authorityPath, approved, grantPath, nowIso) {
  const { checks } = repositoryChecks();
  const manifest = enrollment(authorityPath, approved);
  const grant = loadJson(grantPath, 'grant');
  const verification = verifyGrant(authorityPath, approved, grantPath, nowIso);
  const receipt = finalizeP14Receipt(baseReceipt(snapshot(snapshotPath), checks), {
    checks,
    ceremony: { enrollmentManifest: manifest, grant, verification },
  });
  assertSecretFreeP14Receipt(receipt);
  return receipt;
}

function parse(argv) {
  if (argv.length === 1 && argv[0] === '--plan') return { mode: 'plan' };
  if (argv.length === 1 && argv[0] === '--verify-repository') return { mode: 'verify' };
  if (argv.length === 3 && argv[0] === '--enrollment-manifest') return { mode: 'enroll', authority: argv[1], approved: argv[2] };
  if (argv.length === 7 && argv[0] === '--emit-grant-payload') return { mode: 'payload', authority: argv[1], approved: argv[2], issuedAt: argv[3], notBefore: argv[4], expiresAt: argv[5], nonce: argv[6] };
  if (argv.length === 5 && argv[0] === '--verify-signed-grant') return { mode: 'grant', authority: argv[1], approved: argv[2], grant: argv[3], now: argv[4] };
  if (argv.length === 2 && argv[0] === '--finalize-repository') return { mode: 'finalize-repository', snapshot: argv[1] };
  if (argv.length === 6 && argv[0] === '--finalize-ceremony') return { mode: 'finalize-ceremony', snapshot: argv[1], authority: argv[2], approved: argv[3], grant: argv[4], now: argv[5] };
  throw new Error('exactly one supported read-only ceremony mode is required');
}

try {
  const args = parse(process.argv.slice(2));
  let value;
  if (args.mode === 'plan') {
    value = {
      mode: 'plan',
      p13_evidence_head: P13_EVIDENCE_HEAD,
      p13_request_hash: P13_REQUEST_HASH,
      p13_evidence_sha256: P13_EVIDENCE_SHA256,
      private_key_custody: 'external',
      authority_state: 'awaiting-external-enrollment',
      grant_state: 'not-issued',
      activation_authorized: false,
      activation_performed: false,
      production_source: 'legacy-control',
      allowed_modes: ALLOWED_MODES,
    };
  } else if (args.mode === 'verify') {
    value = repositoryChecks();
  } else if (args.mode === 'enroll') {
    value = enrollment(args.authority, args.approved);
  } else if (args.mode === 'payload') {
    value = payload(args.authority, args.approved, args.issuedAt, args.notBefore, args.expiresAt, args.nonce);
  } else if (args.mode === 'grant') {
    value = verifyGrant(args.authority, args.approved, args.grant, args.now);
  } else if (args.mode === 'finalize-repository') {
    value = finalizeRepository(args.snapshot);
  } else {
    value = finalizeCeremony(args.snapshot, args.authority, args.approved, args.grant, args.now);
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`P14 ceremony error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
