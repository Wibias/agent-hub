#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  P14_EVIDENCE_HEAD,
  P14_EVIDENCE_SHA256,
} from '../p15-activation-executor.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const P14_EVIDENCE_PATH = resolve(ROOT, 'reference-graph/evidence/p14-authority-enrollment-grant-evidence.json');
const QUERY_PATH = resolve(ROOT, 'knowledge/design-references/scripts/query.mjs');
const SCHEMA_DIR = resolve(ROOT, 'reference-graph/schema');
const EXECUTOR_PATH = resolve(ROOT, 'reference-graph/p15-activation-executor.mjs');
const RECEIPT_PATH = resolve(ROOT, 'reference-graph/p15-receipt.mjs');
const CLI_PATH = resolve(ROOT, 'reference-graph/cli/p15-activation-executor.mjs');
const ALLOWED_MODES = Object.freeze(['--plan', '--verify-repository']);

function p14EvidenceSha256() {
  const bytes = readFileSync(P14_EVIDENCE_PATH);
  return createHash('sha256').update(bytes).digest('hex');
}

function productionSourceText() {
  return [EXECUTOR_PATH, RECEIPT_PATH]
    .filter(existsSync)
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
}

function operatorSourceText() {
  return readFileSync(CLI_PATH, 'utf8');
}

function repositoryDefaultGraphEnabled() {
  const query = readFileSync(QUERY_PATH, 'utf8');
  const defaultLegacy = /REFERENCE_GRAPH_QUICK_RUNTIME\s*\|\|\s*["']legacy["']/.test(query);
  const exactGraphOptIn = /graphMode\s*===\s*["']graph["']/.test(query);
  return !(defaultLegacy && exactGraphOptIn);
}

function productionPrivateKeyOrSigningPath() {
  const source = productionSourceText();
  const apiNames = [
    ['create', 'PrivateKey'].join(''),
    ['generate', 'KeyPair'].join(''),
    ['generate', 'KeyPairSync'].join(''),
    ['si', 'gn'].join(''),
  ];
  return apiNames.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(source));
}

function operatorActivationOrDeploymentPath() {
  const source = operatorSourceText();
  const mutationNames = ['activate', 'apply', 'deploy', 'set-env', 'finalize'];
  return /process\.env\.REFERENCE_GRAPH_QUICK_RUNTIME\s*=/.test(source)
    || mutationNames.some((name) => source.includes(`--${name}`));
}

function operatorSupabaseMutationPath() {
  const source = operatorSourceText();
  const markers = [
    ['@supa', 'base/'].join(''),
    ['create', 'Client'].join(''),
    ['SUPA', 'BASE_'].join(''),
  ];
  return markers.some((marker) => source.includes(marker));
}

function migration010OrLaterPresent() {
  return readdirSync(SCHEMA_DIR)
    .filter((name) => /^\d{3}_/.test(name))
    .some((name) => Number.parseInt(name.slice(0, 3), 10) >= 10);
}

function inspectRepository() {
  const actualP14Sha256 = p14EvidenceSha256();
  return {
    p14_evidence_head: P14_EVIDENCE_HEAD,
    p14_evidence_sha256: actualP14Sha256,
    p14_evidence_bytes: actualP14Sha256 === P14_EVIDENCE_SHA256,
    repository_default_graph_enabled: repositoryDefaultGraphEnabled(),
    migration_010_or_later_present: migration010OrLaterPresent(),
    production_private_key_or_signing_path: productionPrivateKeyOrSigningPath(),
    operator_activation_or_deployment_path: operatorActivationOrDeploymentPath(),
    operator_supabase_mutation_path: operatorSupabaseMutationPath(),
    p15_executor_present: existsSync(EXECUTOR_PATH),
    p15_receipt_present: existsSync(RECEIPT_PATH),
  };
}

function parse(argv) {
  if (argv.length === 1 && argv[0] === '--plan') return 'plan';
  if (argv.length === 1 && argv[0] === '--verify-repository') return 'verify-repository';
  throw new Error('P15 read-only operator requires exactly one supported mode');
}

function plan() {
  return {
    mode: 'plan',
    p14_evidence_head: P14_EVIDENCE_HEAD,
    p14_evidence_sha256: P14_EVIDENCE_SHA256,
    activation_flag: 'REFERENCE_GRAPH_QUICK_RUNTIME',
    activation_value: 'graph',
    grant_state: 'not-issued',
    activation_authorized: false,
    activation_performed: false,
    repository_default_graph_enabled: false,
    production_source: 'legacy-control',
    allowed_modes: ALLOWED_MODES,
  };
}

try {
  const mode = parse(process.argv.slice(2));
  const value = mode === 'plan' ? plan() : inspectRepository();
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`P15 operator error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
