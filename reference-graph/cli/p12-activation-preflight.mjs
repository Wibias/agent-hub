#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createP12ActivationBinding,
  evaluateP12ActivationPreflight,
  hashP12ActivationBinding,
} from '../p12-activation-authority.mjs';
import {
  P12_PHASES,
  assertSecretFreeP12Receipt,
  createP12Receipt,
  finalizeP12Receipt,
  recordP12Phase,
} from '../p12-receipt.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const QUERY_PATH = resolve(ROOT, 'knowledge/design-references/scripts/query.mjs');
const ROUTER_PATH = resolve(ROOT, 'reference-graph/p11-runtime-router.mjs');
const P11_EVIDENCE_PATH = resolve(ROOT, 'reference-graph/evidence/p11-quick-activation-evidence.json');
const SCHEMA_DIR = resolve(ROOT, 'reference-graph/schema');
const P11_EVIDENCE_HEAD = '541e9667ea28c75de5492b79d84edf89f9cac8ac';
const P11_IMPLEMENTATION_SHA = '849a8782be4081a5821bdb354e54c33b2e2b0fb9';
const TARGET = Object.freeze({
  purpose: 'agent-hub-reference-graph',
  project_ref: 'vrznfnxzlxaavpqbzbzd',
  project_name: 'agent-hub-reference-graph',
  region: 'eu-central-1',
});
const MODES = Object.freeze([
  '--plan',
  '--verify-repository',
  '--finalize-snapshot <path>',
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

function currentUtcDate(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new TypeError('now must be a valid Date');
  }
  return now.toISOString().slice(0, 10);
}

function inspectRepository() {
  const querySource = readFileSync(QUERY_PATH, 'utf8');
  const routerSource = readFileSync(ROUTER_PATH, 'utf8');
  const p11Evidence = loadJson(P11_EVIDENCE_PATH, 'P11 evidence');
  const migrationFiles = readdirSync(SCHEMA_DIR);

  const queryDefaultsLegacy = /REFERENCE_GRAPH_QUICK_RUNTIME\s*\|\|\s*["']legacy["']/.test(querySource);
  const queryRequiresExactGraph = /graphMode\s*===\s*["']graph["']/.test(querySource);
  const privilegedRuntimeReference = /service[_-]?role/i.test(`${querySource}\n${routerSource}`);

  return {
    p11_evidence_head_matches:
      p11Evidence.schema_version === 'reference-graph.p11-activation-readiness.v1'
      && p11Evidence.git_sha === P11_IMPLEMENTATION_SHA
      && p11Evidence.quick_activation_ready === true,
    query_source_sha256: sha256File(QUERY_PATH),
    router_source_sha256: sha256File(ROUTER_PATH),
    p11_evidence_sha256: sha256File(P11_EVIDENCE_PATH),
    repository_default_graph_enabled: !(queryDefaultsLegacy && queryRequiresExactGraph),
    migration_010_present: migrationFiles.some((name) => /^010(?:_|\.)/.test(name)),
    service_role_runtime_reference: privilegedRuntimeReference,
  };
}

function createBindingForDate(snapshotDate, repository = inspectRepository()) {
  return createP12ActivationBinding({
    p11EvidenceHead: P11_EVIDENCE_HEAD,
    p11ImplementationSha: P11_IMPLEMENTATION_SHA,
    target: TARGET,
    projectionSnapshotDate: snapshotDate,
    querySourceSha256: repository.query_source_sha256,
    routerSourceSha256: repository.router_source_sha256,
    p11EvidenceSha256: repository.p11_evidence_sha256,
  });
}

function planOutput() {
  return {
    mode: 'plan',
    profile: 'quick',
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    runtime_auth_mode: 'publishable',
    timeout_ms: 1500,
    grant_state: 'not-issued',
    activation_authorized: false,
    activation_performed: false,
    repository_default_graph_enabled: false,
    production_source: 'legacy-control',
    target: TARGET,
    expected_projection: {
      candidate_count: 275,
      metadata_complete_count: 275,
      unique_legacy_id_count: 275,
    },
    allowed_modes: MODES,
  };
}

function repositoryOutput(now = new Date()) {
  const repository = inspectRepository();
  const binding = createBindingForDate(currentUtcDate(now), repository);
  return {
    mode: 'verify-repository',
    repository,
    activation_binding: binding,
    binding_hash: hashP12ActivationBinding(binding),
    grant_state: 'not-issued',
    activation_authorized: false,
    activation_performed: false,
    production_source: 'legacy-control',
  };
}

function requireTimestamp(value, name) {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw new TypeError(`${name} must be an ISO timestamp`);
  }
  return new Date(value).toISOString();
}

function finalizeSnapshot(path) {
  if (!existsSync(path)) throw new Error('snapshot path does not exist');
  const snapshot = loadJson(path, 'live snapshot');
  const referenceTime = requireTimestamp(snapshot.reference_time, 'reference_time');
  const verificationAt = requireTimestamp(snapshot.verification_at, 'verification_at');
  if (typeof snapshot.git_sha !== 'string' || !/^[0-9a-f]{40}$/i.test(snapshot.git_sha)) {
    throw new TypeError('git_sha must be a 40-character commit SHA');
  }
  if (!snapshot.live_projection || typeof snapshot.live_projection !== 'object') {
    throw new TypeError('live_projection must be an object');
  }
  if (!snapshot.security || typeof snapshot.security !== 'object') {
    throw new TypeError('security must be an object');
  }

  const repository = inspectRepository();
  const binding = createBindingForDate(snapshot.live_projection.snapshot_date, repository);
  const p11Evidence = loadJson(P11_EVIDENCE_PATH, 'P11 evidence');
  const preflight = evaluateP12ActivationPreflight({
    binding,
    p11Evidence,
    liveProjection: snapshot.live_projection,
    security: snapshot.security,
    repository,
    now: new Date(referenceTime),
  });

  let receipt = createP12Receipt({
    binding,
    target: TARGET,
    baseSha: P11_EVIDENCE_HEAD,
    gitSha: snapshot.git_sha,
    verificationAt,
    referenceTime,
  });
  const phaseDetails = {
    binding: { verified: preflight.checks.binding_contract === true, binding_hash: preflight.bindingHash },
    repository: {
      verified:
        preflight.checks.repository_binding === true
        && preflight.checks.repository_default_off === true
        && preflight.checks.repository_no_migration_010 === true
        && preflight.checks.repository_no_service_role_runtime === true,
    },
    live_preflight: {
      verified:
        preflight.checks.live_target_healthy === true
        && preflight.checks.live_snapshot_current_utc_date === true
        && preflight.checks.live_projection_complete === true
        && preflight.checks.live_projection_identity_clean === true
        && preflight.checks.security_boundary === true,
      snapshot_date: snapshot.live_projection.snapshot_date,
      candidate_count: snapshot.live_projection.candidate_count,
    },
    rollback: {
      verified:
        p11Evidence.repository_default_graph_enabled === false
        && p11Evidence.profile_isolation?.standard_fetch_count === 0
        && p11Evidence.profile_isolation?.deep_fetch_count === 0,
      action: binding.rollback_action,
    },
  };

  for (const phase of P12_PHASES) {
    receipt = recordP12Phase(receipt, {
      phase,
      status: phaseDetails[phase]?.verified === true ? 'success' : 'failed',
      detail: phaseDetails[phase],
    });
    if (receipt.phases[phase].status === 'failed') break;
  }

  receipt = finalizeP12Receipt(receipt, { preflight });
  assertSecretFreeP12Receipt(receipt);
  return receipt;
}

function parseMode(argv) {
  if (argv.length === 1 && argv[0] === '--plan') return { mode: 'plan' };
  if (argv.length === 1 && argv[0] === '--verify-repository') return { mode: 'repository' };
  if (argv.length === 2 && argv[0] === '--finalize-snapshot' && argv[1]) {
    return { mode: 'snapshot', path: argv[1] };
  }
  throw new Error('exactly one supported read-only mode is required');
}

try {
  const parsed = parseMode(process.argv.slice(2));
  const value = parsed.mode === 'plan'
    ? planOutput()
    : parsed.mode === 'repository'
      ? repositoryOutput()
      : finalizeSnapshot(parsed.path);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`P12 preflight error: ${message}\n`);
  process.exitCode = 1;
}
